import express from 'express';
import path from 'node:path';
import { config, modes } from './src/config.js';
import { products, publicProduct, getProduct } from './src/catalog.js';
import {
  createSession, getSession, cartAdd, sessionTotals, cartClear, getOrder, findOrderByPaypalId, updateOrder,
  commitStock, logEvent, listOrders, listSessions, resetAll, touch,
} from './src/store.js';
import { CURRENCIES, currencyFromLocale, fmt, fmtNgn, isCurrency, normCurrency } from './src/money.js';
import { familyMessage } from './src/family.js';
import { runAgent, addNote } from './src/agent/index.js';
import * as paypal from './src/paypal.js';
import { sellerStats, sellerInsight } from './src/insights.js';

const app = express();
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.resolve('public'), { extensions: ['html'] }));
// AG Grid (seller dashboard), served from our own server instead of a CDN.
app.use('/vendor/ag-grid', express.static(path.resolve('node_modules/ag-grid-community/dist'), { maxAge: '7d' }));
app.use('/vendor/ag-grid-styles', express.static(path.resolve('node_modules/ag-grid-community/styles'), { maxAge: '7d' }));

app.get('/healthz', (req, res) => res.json({ ok: true, ai: modes.ai, paypal: modes.paypal }));

/* ---------- helpers ---------- */

const MAX_MESSAGE = 1000;
const lastHit = new Map();

function requireSession(req, res) {
  const id = req.body?.sessionId || req.params.sessionId;
  const s = id && getSession(id);
  if (!s) {
    res.status(404).json({ error: 'Chat session not found. Refresh the page to start a new chat.' });
    return null;
  }
  return s;
}

function sellerOnly(req, res, next) {
  if (!config.sellerKey) return next();
  const key = req.get('x-seller-key') || req.query.key;
  if (key === config.sellerKey) return next();
  res.status(401).json({ error: 'Seller key required' });
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- buyer API ---------- */

app.get('/api/config', (req, res) => {
  res.json({
    store: { name: config.store.name, tagline: config.store.tagline, city: config.store.city, deliveryDays: config.store.deliveryDays },
    currencies: Object.entries(CURRENCIES).map(([code, c]) => ({ code, symbol: c.symbol, name: c.name, ngnPer: config.fx[code] })),
    modes,
    paypalClientId: modes.paypal === 'sandbox' ? config.paypal.clientId : null,
  });
});

app.post('/api/session', (req, res) => {
  // Overseas buyers see their own currency first (en-GB -> GBP); everyone else pays in USD.
  const s = createSession({ currency: currencyFromLocale(req.body?.locale), source: req.body?.source });
  logEvent('session', { sessionId: s.id, source: s.source, currency: s.currency });
  res.json({ sessionId: s.id, currency: s.currency });
});

/** Currency picker in the chat header. */
app.post('/api/currency', (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  if (!isCurrency(req.body.currency)) return res.status(400).json({ error: 'Unsupported currency' });
  s.currency = normCurrency(req.body.currency);
  touch();
  addNote(s, `The buyer switched their checkout currency to ${s.currency}.`);
  res.json({ currency: s.currency, cart: sessionTotals(s) });
});

app.get('/api/session/:sessionId', (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  res.json({ history: s.history.filter((h) => h.role !== 'note'), cart: sessionTotals(s), currency: s.currency, delivery: s.delivery });
});

app.post('/api/chat', wrap(async (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  const message = String(req.body.message || '').trim().slice(0, MAX_MESSAGE);
  if (!message) return res.status(400).json({ error: 'Empty message' });

  // Basic flood protection: one message per 700ms per chat.
  const now = Date.now();
  if (now - (lastHit.get(s.id) || 0) < 700) return res.status(429).json({ error: 'Slow down a little 🙂' });
  lastHit.set(s.id, now);

  const out = await runAgent(s, message);
  res.json(out);
}));

/** "Add to cart" button on a product card. */
app.post('/api/cart/add', (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  const p = getProduct(req.body.productId);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const r = cartAdd(s, p.id, 1);
  if (!r.ok) return res.status(400).json({ error: r.error });
  addNote(s, `The buyer tapped "Add to cart" on ${p.name} (${p.id}). It is now in the cart.`);
  res.json({ cart: sessionTotals(s) });
});

/** Called by the PayPal button after the buyer approves. Server captures and verifies. */
app.post('/api/paypal/capture', wrap(async (req, res) => {
  const s = requireSession(req, res);
  if (!s) return;
  const order = findOrderByPaypalId(req.body.paypalOrderId);
  if (!order || order.sessionId !== s.id) return res.status(404).json({ error: 'Order not found for this chat' });
  if (order.status === 'PAID') return res.json({ status: 'PAID', order, reply: 'This order is already paid. 🎉' });
  if (order.status !== 'AWAITING_PAYMENT') return res.status(409).json({ error: `This checkout is ${order.status.toLowerCase().replace('_', ' ')}. Ask Oja for a fresh checkout.` });

  const cap = await paypal.captureOrder(order.paypalOrderId);

  // Verify the money that actually moved matches what we expected.
  const amountOk = !cap.amount || (cap.amount.currency_code === order.currency && Number(cap.amount.value) === Number(order.total));
  if (cap.status !== 'COMPLETED' || !amountOk) {
    updateOrder(order.id, { status: 'PAYMENT_ISSUE', capture: cap });
    logEvent('payment_issue', { sessionId: s.id, orderId: order.id });
    return res.status(402).json({ error: 'PayPal did not complete the payment. Please try again or ask for an invoice.' });
  }

  const paid = updateOrder(order.id, { status: 'PAID', paidAt: Date.now(), captureId: cap.captureId, payer: cap.payer });
  commitStock(paid);
  cartClear(s);
  logEvent('paid', { sessionId: s.id, orderId: order.id, total: order.total });
  addNote(s, `PayPal payment CONFIRMED for order ${order.id}: ${fmt(order.total, order.currency)}, capture ${cap.captureId}. The cart has been emptied.`);

  // Buying for family back home: write the WhatsApp message the buyer forwards to them.
  let family = null;
  if (paid.delivery?.isGift) {
    family = await familyMessage(paid);
    if (family) updateOrder(order.id, { familyMessage: family.text });
    s.delivery = null; // next gift starts fresh
    touch();
  }

  const first = cap.payer?.name?.split(' ')[0];
  const naira = order.totalNgn ? ` (about ${fmtNgn(order.totalNgn)})` : '';
  const d = paid.delivery;
  const where = d ? ` ${config.store.name} will deliver to ${d.recipientName} in ${d.city} within ${config.store.deliveryDays}.` : ` ${config.store.name} will contact you about delivery.`;
  const reply = `Payment received${first ? `, ${first}` : ''}! 🎉 Order ${order.id} is confirmed — ${fmt(order.total, order.currency)}${naira} paid with PayPal.${where}${family ? ` Here's a message you can send ${d.recipientName.split(' ')[0]} on WhatsApp:` : ' Anything else?'}`;
  res.json({ status: 'PAID', order: getOrder(order.id), reply, family, cart: sessionTotals(s) });
}));

/** Lets the chat poll an invoice so it can celebrate when the buyer pays from email/QR. */
app.get('/api/order/:orderId', wrap(async (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order || order.sessionId !== req.query.sessionId) return res.status(404).json({ error: 'Not found' });
  if (order.status === 'INVOICE_SENT' && order.invoiceId) {
    const st = await paypal.getInvoiceStatus(order.invoiceId).catch(() => null);
    if (st === 'PAID' || st === 'MARKED_AS_PAID') {
      const paid = updateOrder(order.id, { status: 'PAID', paidAt: Date.now() });
      commitStock(paid);
      logEvent('paid', { sessionId: order.sessionId, orderId: order.id, total: order.total, via: 'invoice' });
      const s = getSession(order.sessionId);
      if (s) addNote(s, `Invoice for order ${order.id} has been PAID via PayPal.`);
    }
  }
  res.json({ order: getOrder(order.id) });
}));

/* ---------- seller API ---------- */

app.get('/api/seller/stats', sellerOnly, (req, res) => res.json(sellerStats()));

app.post('/api/seller/insight', sellerOnly, wrap(async (req, res) => res.json(await sellerInsight())));

app.get('/api/seller/orders', sellerOnly, (req, res) => {
  res.json(listOrders().filter((o) => o.status !== 'REPLACED').slice(0, 100));
});

app.get('/api/seller/conversations', sellerOnly, (req, res) => {
  const orders = listOrders();
  res.json(
    listSessions()
      .filter((s) => s.history.some((h) => h.role === 'user'))
      .slice(0, 50)
      .map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        messages: s.history.filter((h) => h.role !== 'note').slice(-40),
        orders: orders.filter((o) => o.sessionId === s.id && o.status !== 'REPLACED').map((o) => ({ id: o.id, status: o.status, total: o.total })),
      })),
  );
});

app.get('/api/seller/products', sellerOnly, (req, res) => res.json(products.map(publicProduct)));

const DELIVERY_STEPS = ['NOT_STARTED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/** Seller updates delivery progress from the dashboard grid; the buyer's chat is told. */
app.post('/api/seller/orders/:orderId/delivery', sellerOnly, (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const status = String(req.body?.status || '');
  if (!DELIVERY_STEPS.includes(status)) return res.status(400).json({ error: `Status must be one of ${DELIVERY_STEPS.join(', ')}` });
  if (order.status !== 'PAID' && status !== 'NOT_STARTED') return res.status(409).json({ error: 'Only paid orders can be dispatched' });
  const updated = updateOrder(order.id, { deliveryStatus: status, [`${status.toLowerCase()}At`]: Date.now() });
  logEvent('delivery_update', { orderId: order.id, status });
  const s = getSession(order.sessionId);
  if (s) addNote(s, `Delivery update for order ${order.id}: ${status.replaceAll('_', ' ').toLowerCase()}.`);
  res.json(updated);
});

app.post('/api/seller/reset', sellerOnly, (req, res) => {
  resetAll();
  res.json({ ok: true });
});

/* ---------- errors ---------- */

app.use((err, req, res, next) => {
  console.error(err);
  const msg = err instanceof paypal.PayPalError ? 'PayPal is having trouble right now. Please try again in a moment.' : 'Something went wrong on our side. Please try again.';
  res.status(500).json({ error: msg });
});

app.listen(config.port, () => {
  console.log(`\n  Oja for ${config.store.name} is running`);
  console.log(`  Buyer chat:        http://localhost:${config.port}`);
  console.log(`  Seller dashboard:  http://localhost:${config.port}/seller`);
  console.log(`  AI:      ${modes.ai === 'gemini' ? `Gemini (${config.ai.geminiModel})` : 'offline demo brain (set GEMINI_API_KEY for real AI)'}`);
  console.log(`  PayPal:  ${modes.paypal === 'sandbox' ? 'sandbox' : 'mock (set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET for real sandbox payments)'}\n`);
});
