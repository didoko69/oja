import { config } from '../config.js';
import { categories, getProduct, publicProduct, resolveProduct, searchProducts } from '../catalog.js';
import {
  cartAdd, cartRemove, sessionTotals, createOrderRecord, getOrder, listOrders, logEvent, touch, updateOrder,
} from '../store.js';
import { CURRENCIES, fromNgn, isCurrency, normCurrency, toNgnFrom } from '../money.js';
import { findCity, findState, missingDelivery, normalisePhone } from '../nigeria.js';
import { normLanguage } from '../family.js';
import * as paypal from '../paypal.js';
import QRCode from 'qrcode';

/*
 * The agent's tools. Each tool returns:
 *   result -> what the AI model sees (compact JSON)
 *   ui     -> optional card the chat UI renders (product list, cart, PayPal checkout, invoice...)
 * Money is always computed here from the catalog, never taken from the model.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const lite = (p, cur) => ({
  id: p.id, name: p.name, price: fromNgn(p.priceNgn, cur), currency: cur, price_ngn: p.priceNgn,
  inStock: p.stock > 0, stockLeft: p.stock, rating: p.rating, summary: p.summary,
});
const pub = (session) => (p) => publicProduct(p, session.currency);

function resolveOrFail(ref) {
  const p = resolveProduct(ref);
  if (!p) throw new ToolError(`No product matches "${ref}". Use search_products to find valid product ids.`);
  return p;
}

export class ToolError extends Error {}

/** Budget in naira, from a naira limit or a limit in the buyer's currency (whichever is tighter). */
function maxNgn(session, args) {
  const cur = isCurrency(args.currency) ? args.currency : session.currency;
  const limits = [
    args.max_price_ngn,
    args.max_price != null ? toNgnFrom(args.max_price, cur) : null,
  ].filter((v) => v != null && !Number.isNaN(Number(v)));
  return limits.length ? Math.min(...limits.map(Number)) : undefined;
}

const deliveryView = (d) => (d ? {
  recipient_name: d.recipientName || null, recipient_phone: d.recipientPhone || null, address: d.address || null,
  city: d.city || null, state: d.state || null, is_gift: Boolean(d.isGift), relationship: d.relationship || null,
  sender_name: d.senderName || null, gift_note: d.giftNote || null, message_language: d.language || 'english',
} : null);

export const tools = [
  {
    name: 'search_products',
    description:
      'Search the store catalog. Use for any product question before recommending. Supports a free-text query (needs, features, use cases like "content creation" or "power cuts") plus optional category and price filters. Results include stock status.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the buyer is looking for, in plain words.' },
        category: { type: 'string', enum: categories, description: 'Optional category filter.' },
        max_price: { type: 'number', description: 'Optional budget in a foreign currency (see currency). E.g. "about £120" -> 130 with currency GBP (allow ~10% headroom for "about").' },
        currency: { type: 'string', enum: Object.keys(CURRENCIES), description: 'Currency of max_price. Defaults to the buyer\'s checkout currency.' },
        max_price_ngn: { type: 'number', description: 'Optional maximum price in naira, when the buyer gives a naira budget (200k = 200000).' },
      },
      required: ['query'],
    },
    async run(session, args) {
      const found = searchProducts({
        query: args.query, category: args.category, maxPriceNgn: maxNgn(session, args), limit: 4,
      });
      logEvent('search', {
        sessionId: session.id, query: args.query, category: args.category || null, maxPriceNgn: maxNgn(session, args) ?? null,
        results: found.length, inStock: found.filter((p) => p.stock > 0).length,
        // The best match being out of stock is a lost sale the seller should know about.
        topOutOfStock: found[0] && found[0].stock <= 0 ? found[0].name : null,
      });
      session.lastShown = found.map((p) => p.id);
      return {
        result: { count: found.length, products: found.map((p) => lite(p, session.currency)) },
        ui: found.length ? { type: 'products', products: found.map(pub(session)) } : null,
      };
    },
  },

  {
    name: 'get_product',
    description: 'Get full details and specs for one product by id.',
    parameters: {
      type: 'object',
      properties: { product_id: { type: 'string' } },
      required: ['product_id'],
    },
    async run(session, args) {
      const p = resolveOrFail(args.product_id);
      session.lastShown = [p.id];
      return { result: pub(session)(p), ui: { type: 'products', products: [pub(session)(p)] } };
    },
  },

  {
    name: 'compare_products',
    description: 'Compare 2 to 4 products side by side (price, specs, rating, stock). Use when the buyer is deciding between options.',
    parameters: {
      type: 'object',
      properties: { product_ids: { type: 'array', items: { type: 'string' }, description: '2 to 4 product ids.' } },
      required: ['product_ids'],
    },
    async run(session, args) {
      const list = (args.product_ids || []).slice(0, 4).map(resolveOrFail);
      if (list.length < 2) throw new ToolError('Need at least 2 products to compare.');
      session.lastShown = list.map((p) => p.id);
      const rows = [...new Set(list.flatMap((p) => Object.keys(p.specs)))];
      return {
        result: { products: list.map(pub(session)) },
        ui: {
          type: 'comparison',
          products: list.map(pub(session)),
          rows,
        },
      };
    },
  },

  {
    name: 'add_to_cart',
    description: 'Add a product to the buyer\'s cart. Only call when the buyer clearly asked to add or buy that item.',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        quantity: { type: 'integer', description: 'Defaults to 1.' },
      },
      required: ['product_id'],
    },
    async run(session, args) {
      const p = resolveOrFail(args.product_id);
      const r = cartAdd(session, p.id, args.quantity || 1);
      if (!r.ok) throw new ToolError(r.error);
      const totals = sessionTotals(session);
      return { result: { added: p.name, cart: totals }, ui: { type: 'cart', totals, highlight: p.id } };
    },
  },

  {
    name: 'remove_from_cart',
    description: 'Remove a product (or reduce its quantity) from the cart.',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        quantity: { type: 'integer', description: 'How many to remove. Omit to remove the line entirely.' },
      },
      required: ['product_id'],
    },
    async run(session, args) {
      const p = resolveOrFail(args.product_id);
      const r = cartRemove(session, p.id, args.quantity);
      if (!r.ok) throw new ToolError(r.error);
      const totals = sessionTotals(session);
      return { result: { removed: p.name, cart: totals }, ui: { type: 'cart', totals } };
    },
  },

  {
    name: 'view_cart',
    description: 'Show the current cart with server-calculated subtotal, shipping and total.',
    parameters: { type: 'object', properties: {} },
    async run(session) {
      const totals = sessionTotals(session);
      return { result: totals, ui: totals.items.length ? { type: 'cart', totals } : null };
    },
  },

  {
    name: 'set_currency',
    description:
      'Set the currency the buyer pays in through PayPal (USD, GBP, EUR or CAD). Call as soon as you learn where an overseas buyer lives or which currency they use (e.g. "I\'m in London" -> GBP). Prices stay shown in naira too.',
    parameters: {
      type: 'object',
      properties: { currency: { type: 'string', enum: Object.keys(CURRENCIES) } },
      required: ['currency'],
    },
    async run(session, args) {
      if (!isCurrency(args.currency)) throw new ToolError(`Supported currencies: ${Object.keys(CURRENCIES).join(', ')}.`);
      session.currency = normCurrency(args.currency);
      touch();
      const totals = sessionTotals(session);
      return {
        result: { currency: session.currency, cart: totals },
        ui: { type: 'currency', currency: session.currency, totals },
      };
    },
  },

  {
    name: 'set_delivery',
    description:
      'Save or update who receives the order in Nigeria and where. Use for "buy for family back home" gifts (is_gift true) and for normal deliveries. Pass only the fields you learned; they merge with what was saved. Needs recipient name, Nigerian phone number, street address, city and state before checkout.',
    parameters: {
      type: 'object',
      properties: {
        recipient_name: { type: 'string' },
        recipient_phone: { type: 'string', description: 'Nigerian mobile number, any format (0803..., +234...).' },
        address: { type: 'string', description: 'Street address and area, without city/state.' },
        city: { type: 'string' },
        state: { type: 'string', description: 'Nigerian state, or FCT for Abuja.' },
        is_gift: { type: 'boolean', description: 'True when the buyer is buying for someone else (e.g. family back home).' },
        relationship: { type: 'string', description: 'e.g. mum, brother.' },
        sender_name: { type: 'string', description: 'The buyer\'s first name, used to sign the family message.' },
        gift_note: { type: 'string', description: 'Optional personal note to include in the family message.' },
        message_language: { type: 'string', enum: ['english', 'pidgin', 'yoruba', 'igbo', 'hausa'], description: 'Language for the WhatsApp message to the family.' },
      },
    },
    async run(session, args) {
      const d = { ...(session.delivery || {}) };
      if (args.recipient_name) d.recipientName = String(args.recipient_name).trim().slice(0, 80);
      if (args.recipient_phone) {
        const phone = normalisePhone(args.recipient_phone);
        if (!phone) throw new ToolError('That does not look like a Nigerian mobile number. Ask for one like 0803 123 4567.');
        d.recipientPhone = phone;
      }
      if (args.address) d.address = String(args.address).trim().slice(0, 160);
      if (args.city) {
        d.city = String(args.city).trim().slice(0, 60);
        if (!args.state && !d.state) d.state = findCity(d.city)?.state || null;
      }
      if (args.state) {
        const st = findState(args.state);
        if (!st) throw new ToolError(`"${args.state}" is not a Nigerian state. Ask which state.`);
        d.state = st;
      }
      if (args.is_gift != null) d.isGift = Boolean(args.is_gift);
      if (args.relationship) d.relationship = String(args.relationship).slice(0, 30);
      if (args.sender_name) d.senderName = String(args.sender_name).trim().slice(0, 40);
      if (args.gift_note) d.giftNote = String(args.gift_note).trim().slice(0, 300);
      if (args.message_language) d.language = normLanguage(args.message_language);
      session.delivery = d;
      touch();
      const missing = missingDelivery(d);
      return {
        result: { delivery: deliveryView(d), missing_fields: missing, complete: missing.length === 0 },
        ui: missing.length === 0 ? { type: 'delivery', delivery: d } : null,
      };
    },
  },

  {
    name: 'create_checkout',
    description:
      'Create a PayPal checkout for the current cart and show the PayPal pay buttons inside the chat. Call this when the buyer says they want to pay or check out. The buyer completes payment by clicking the button; payment is confirmed by the system, not by you.',
    parameters: { type: 'object', properties: {} },
    async run(session) {
      const totals = sessionTotals(session);
      if (!totals.items.length) throw new ToolError('The cart is empty. Ask what the buyer wants first.');
      if (session.delivery?.isGift || session.delivery) {
        const missing = missingDelivery(session.delivery);
        if (missing.length) throw new ToolError(`Delivery details are incomplete. Ask the buyer for: ${missing.join(', ')}.`);
      }
      for (const i of totals.items) {
        const p = getProduct(i.productId);
        if (!p || p.stock < i.qty) throw new ToolError(`${i.name} no longer has enough stock.`);
      }
      // Any earlier unpaid checkout in this chat is replaced by this one.
      for (const id of session.orderIds) {
        const o = getOrder(id);
        if (o?.status === 'AWAITING_PAYMENT' && o.method === 'checkout') updateOrder(id, { status: 'REPLACED' });
      }
      const order = createOrderRecord(session, totals, { method: 'checkout' });
      const pp = await paypal.createOrder({ totals, localOrderId: order.id, storeName: config.store.name, delivery: session.delivery });
      updateOrder(order.id, { paypalOrderId: pp.id });
      logEvent('checkout_created', { sessionId: session.id, orderId: order.id, total: totals.total });
      return {
        result: { order_id: order.id, paypal_order_id: pp.id, total: totals.total, currency: totals.currency, total_ngn: totals.totalNgn, delivers_to: deliveryView(session.delivery), status: 'AWAITING_PAYMENT' },
        ui: { type: 'checkout', orderId: order.id, paypalOrderId: pp.id, approveUrl: pp.approveUrl, totals, delivery: session.delivery || null },
      };
    },
  },

  {
    name: 'send_invoice',
    description:
      'Create and email a PayPal invoice for the current cart, with a pay link and QR code. Use when the buyer wants to pay later, pay from another device, or needs an invoice. Requires the buyer\'s email address — ask for it if you don\'t have it.',
    parameters: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Buyer email address.' },
        name: { type: 'string', description: 'Buyer full name, optional.' },
      },
      required: ['email'],
    },
    async run(session, args) {
      const email = String(args.email || '').trim();
      if (!EMAIL_RE.test(email)) throw new ToolError('That email address looks invalid. Ask the buyer for a valid email.');
      const totals = sessionTotals(session);
      if (!totals.items.length) throw new ToolError('The cart is empty, there is nothing to invoice.');
      session.buyerEmail = email;
      const order = createOrderRecord(session, totals, { method: 'invoice', buyerEmail: email });
      const inv = await paypal.createAndSendInvoice({
        totals, buyerEmail: email, buyerName: args.name, localOrderId: order.id, storeName: config.store.name,
      });
      if (!inv.qrPng && inv.payUrl) {
        // PayPal's own QR wasn't available: draw one from the invoice pay link.
        inv.qrPng = (await QRCode.toDataURL(inv.payUrl, { width: 240, margin: 1 })).split(',')[1];
      }
      updateOrder(order.id, { invoiceId: inv.id, invoiceUrl: inv.payUrl, status: 'INVOICE_SENT' });
      logEvent('invoice_sent', { sessionId: session.id, orderId: order.id, total: totals.total });
      return {
        result: { order_id: order.id, invoice_id: inv.id, invoice_number: inv.number, emailed_to: email, total: totals.total, status: 'INVOICE_SENT' },
        ui: { type: 'invoice', orderId: order.id, invoiceId: inv.id, number: inv.number, payUrl: inv.payUrl, qrPng: inv.qrPng, email, totals },
      };
    },
  },

  {
    name: 'check_order_status',
    description: 'Check the buyer\'s latest order (or a given order id): payment status and delivery progress. Use for "did my payment go through?", "has my invoice been paid?" or "has my mum received it?".',
    parameters: {
      type: 'object',
      properties: { order_id: { type: 'string', description: 'Optional. Defaults to the latest order in this chat.' } },
    },
    async run(session, args) {
      const id = args.order_id && session.orderIds.includes(args.order_id) ? args.order_id : session.orderIds.at(-1);
      const order = id ? getOrder(id) : null;
      if (!order) throw new ToolError('This buyer has no orders yet.');
      if (order.invoiceId && order.status === 'INVOICE_SENT') {
        const s = await paypal.getInvoiceStatus(order.invoiceId);
        if (s === 'PAID' || s === 'MARKED_AS_PAID') updateOrder(order.id, { status: 'PAID', paidAt: Date.now() });
      }
      const o = getOrder(order.id);
      return {
        result: {
          order_id: o.id, payment_status: o.status, delivery_status: o.deliveryStatus, total: o.total, currency: o.currency,
          method: o.method, items: o.items.map((i) => `${i.qty} x ${i.name}`), delivers_to: deliveryView(o.delivery),
        },
        ui: { type: 'order_status', order: { id: o.id, status: o.status, deliveryStatus: o.deliveryStatus, total: o.total, totalNgn: o.totalNgn, currency: o.currency, items: o.items, method: o.method, delivery: o.delivery } },
      };
    },
  },
];

export const toolMap = new Map(tools.map((t) => [t.name, t]));

/** Run one tool safely. Errors become a result the model can read and recover from. */
export async function runTool(session, name, args, uiSink) {
  const tool = toolMap.get(name);
  if (!tool) return { error: `Unknown tool ${name}` };
  try {
    const { result, ui } = await tool.run(session, args || {});
    if (ui) uiSink.push(ui);
    return result;
  } catch (err) {
    if (!(err instanceof ToolError)) console.error(`Tool ${name} failed:`, err);
    return { error: err instanceof ToolError ? err.message : `Something went wrong: ${err.message}` };
  }
}

/** Used by the seller dashboard. */
export function ordersForSession(sessionId) {
  return listOrders().filter((o) => o.sessionId === sessionId);
}
