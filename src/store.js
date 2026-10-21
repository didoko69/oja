import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { getProduct } from './catalog.js';
import { deliveryFeeNgn, fromNgn, normCurrency } from './money.js';

// Simple in-memory store, snapshotted to disk so a restart doesn't wipe the demo.
const DATA_DIR = path.resolve(process.env.OJA_DATA_DIR || 'data');
const FILE = path.join(DATA_DIR, 'state.json');

const state = { sessions: {}, orders: {}, events: [] };

try {
  Object.assign(state, JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch {
  /* first run */
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(state));
    } catch (err) {
      console.error('Could not save state:', err.message);
    }
  }, 300);
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

/* ---------- sessions ---------- */

export function createSession({ currency, source } = {}) {
  const id = newId('s');
  state.sessions[id] = {
    id,
    createdAt: Date.now(),
    history: [], // provider-neutral transcript: {role:'user'|'assistant'|'note', text}
    llmHistory: [], // provider-specific turns (Gemini contents) for tool-calling continuity
    cart: [], // [{productId, qty}]
    lastShown: [], // product ids last shown to the buyer, for "the first one", "the cheaper one"
    buyerEmail: null,
    orderIds: [],
    currency: normCurrency(currency),
    source: source ? String(source).slice(0, 40) : 'direct', // where the buyer came from (?src=whatsapp)
    delivery: null, // { recipientName, recipientPhone, address, city, state, isGift, relationship, senderName, giftNote, language }
  };
  save();
  return state.sessions[id];
}

export function getSession(id) {
  return state.sessions[id] || null;
}

export function touch() {
  save();
}

export function addTranscript(session, role, text) {
  session.history.push({ role, text, at: Date.now() });
  if (session.history.length > 200) session.history.splice(0, session.history.length - 200);
  save();
}

/* ---------- cart ---------- */

export function cartAdd(session, productId, qty = 1) {
  const p = getProduct(productId);
  if (!p) return { ok: false, error: `Unknown product ${productId}` };
  if (p.stock <= 0) return { ok: false, error: `${p.name} is out of stock` };
  qty = Math.max(1, Math.min(Number(qty) || 1, 10));
  const line = session.cart.find((l) => l.productId === productId);
  const newQty = (line?.qty || 0) + qty;
  if (newQty > p.stock) return { ok: false, error: `Only ${p.stock} ${p.name} left in stock` };
  if (line) line.qty = newQty;
  else session.cart.push({ productId, qty });
  logEvent('add_to_cart', { sessionId: session.id, productId, qty });
  save();
  return { ok: true };
}

export function cartRemove(session, productId, qty) {
  const line = session.cart.find((l) => l.productId === productId);
  if (!line) return { ok: false, error: 'That item is not in the cart' };
  if (qty && qty < line.qty) line.qty -= qty;
  else session.cart = session.cart.filter((l) => l.productId !== productId);
  save();
  return { ok: true };
}

export function cartClear(session) {
  session.cart = [];
  save();
}

/**
 * Prices and totals ALWAYS come from the catalog here — never from the AI.
 * Prices are stored in naira and converted to the checkout currency (whole units per item).
 */
export function cartTotals(cart, currency = config.defaultCurrency) {
  const cur = normCurrency(currency);
  const items = cart
    .map(({ productId, qty }) => {
      const p = getProduct(productId);
      if (!p) return null;
      const unit = fromNgn(p.priceNgn, cur);
      return { productId, name: p.name, unitPrice: unit, unitPriceNgn: p.priceNgn, qty, lineTotal: round(unit * qty), lineTotalNgn: p.priceNgn * qty };
    })
    .filter(Boolean);
  const subtotalNgn = items.reduce((s, i) => s + i.lineTotalNgn, 0);
  const shippingNgn = deliveryFeeNgn(subtotalNgn);
  const subtotal = round(items.reduce((s, i) => s + i.lineTotal, 0));
  const shipping = shippingNgn ? fromNgn(shippingNgn, cur) : 0;
  return {
    items,
    itemCount: items.reduce((s, i) => s + i.qty, 0),
    subtotal,
    shipping,
    total: round(subtotal + shipping),
    currency: cur,
    subtotalNgn,
    shippingNgn,
    totalNgn: subtotalNgn + shippingNgn,
    freeDeliveryFromNgn: config.store.freeDeliveryFromNgn,
  };
}

/** Totals for a session, in the buyer's chosen currency. */
export const sessionTotals = (session) => cartTotals(session.cart, session.currency);

const round = (n) => Math.round(n * 100) / 100;
export const money = (n) => Number(n).toFixed(2);

/* ---------- orders ---------- */

export function createOrderRecord(session, totals, extra = {}) {
  const id = newId('ord');
  state.orders[id] = {
    id,
    sessionId: session.id,
    createdAt: Date.now(),
    status: 'AWAITING_PAYMENT',
    items: totals.items,
    subtotal: totals.subtotal,
    shipping: totals.shipping,
    total: totals.total,
    totalNgn: totals.totalNgn,
    currency: totals.currency,
    paypalOrderId: null,
    invoiceId: null,
    invoiceUrl: null,
    payer: null,
    method: null,
    delivery: session.delivery ? { ...session.delivery } : null,
    deliveryStatus: 'NOT_STARTED', // NOT_STARTED -> PACKED -> OUT_FOR_DELIVERY -> DELIVERED
    source: session.source,
    familyMessage: null,
    ...extra,
  };
  session.orderIds.push(id);
  save();
  return state.orders[id];
}

export function getOrder(id) {
  return state.orders[id] || null;
}

export function findOrderByPaypalId(paypalOrderId) {
  return Object.values(state.orders).find((o) => o.paypalOrderId === paypalOrderId) || null;
}

export function updateOrder(id, patch) {
  Object.assign(state.orders[id], patch, { updatedAt: Date.now() });
  save();
  return state.orders[id];
}

export function listOrders() {
  return Object.values(state.orders).sort((a, b) => b.createdAt - a.createdAt);
}

export function listSessions() {
  return Object.values(state.sessions).sort((a, b) => b.createdAt - a.createdAt);
}

/** Decrease stock once an order is paid. */
export function commitStock(order) {
  for (const item of order.items) {
    const p = getProduct(item.productId);
    if (p) p.stock = Math.max(0, p.stock - item.qty);
  }
}

/* ---------- analytics events ---------- */

export function logEvent(type, data = {}) {
  state.events.push({ type, at: Date.now(), ...data });
  if (state.events.length > 5000) state.events.splice(0, state.events.length - 5000);
  save();
}

export function listEvents() {
  return state.events;
}

export function resetAll() {
  state.sessions = {};
  state.orders = {};
  state.events = [];
  save();
}
