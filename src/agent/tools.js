import { config } from '../config.js';
import { categories, getProduct, publicProduct, resolveProduct, searchProducts } from '../catalog.js';
import {
  cartAdd, cartRemove, cartTotals, createOrderRecord, getOrder, listOrders, logEvent, updateOrder,
} from '../store.js';
import * as paypal from '../paypal.js';
import QRCode from 'qrcode';

/*
 * The agent's tools. Each tool returns:
 *   result -> what the AI model sees (compact JSON)
 *   ui     -> optional card the chat UI renders (product list, cart, PayPal checkout, invoice...)
 * Money is always computed here from the catalog, never taken from the model.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const lite = (p) => ({
  id: p.id, name: p.name, price: p.price, inStock: p.stock > 0, stockLeft: p.stock, rating: p.rating, summary: p.summary,
});

function resolveOrFail(ref) {
  const p = resolveProduct(ref);
  if (!p) throw new ToolError(`No product matches "${ref}". Use search_products to find valid product ids.`);
  return p;
}

export class ToolError extends Error {}

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
        max_price: { type: 'number', description: 'Optional maximum price in USD.' },
        min_price: { type: 'number', description: 'Optional minimum price in USD.' },
      },
      required: ['query'],
    },
    async run(session, args) {
      const found = searchProducts({
        query: args.query, category: args.category, maxPrice: args.max_price, minPrice: args.min_price, limit: 4,
      });
      logEvent('search', {
        sessionId: session.id, query: args.query, category: args.category || null, maxPrice: args.max_price ?? null,
        results: found.length, inStock: found.filter((p) => p.stock > 0).length,
        // The best match being out of stock is a lost sale the seller should know about.
        topOutOfStock: found[0] && found[0].stock <= 0 ? found[0].name : null,
      });
      session.lastShown = found.map((p) => p.id);
      return {
        result: { count: found.length, products: found.map(lite) },
        ui: found.length ? { type: 'products', products: found.map(publicProduct) } : null,
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
      return { result: publicProduct(p), ui: { type: 'products', products: [publicProduct(p)] } };
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
        result: { products: list.map(publicProduct) },
        ui: {
          type: 'comparison',
          products: list.map(publicProduct),
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
      const totals = cartTotals(session.cart);
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
      const totals = cartTotals(session.cart);
      return { result: { removed: p.name, cart: totals }, ui: { type: 'cart', totals } };
    },
  },

  {
    name: 'view_cart',
    description: 'Show the current cart with server-calculated subtotal, shipping and total.',
    parameters: { type: 'object', properties: {} },
    async run(session) {
      const totals = cartTotals(session.cart);
      return { result: totals, ui: totals.items.length ? { type: 'cart', totals } : null };
    },
  },

  {
    name: 'create_checkout',
    description:
      'Create a PayPal checkout for the current cart and show the PayPal pay buttons inside the chat. Call this when the buyer says they want to pay or check out. The buyer completes payment by clicking the button; payment is confirmed by the system, not by you.',
    parameters: { type: 'object', properties: {} },
    async run(session) {
      const totals = cartTotals(session.cart);
      if (!totals.items.length) throw new ToolError('The cart is empty. Ask what the buyer wants first.');
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
      const pp = await paypal.createOrder({ totals, localOrderId: order.id, storeName: config.store.name });
      updateOrder(order.id, { paypalOrderId: pp.id });
      logEvent('checkout_created', { sessionId: session.id, orderId: order.id, total: totals.total });
      return {
        result: { order_id: order.id, paypal_order_id: pp.id, total: totals.total, currency: totals.currency, status: 'AWAITING_PAYMENT' },
        ui: { type: 'checkout', orderId: order.id, paypalOrderId: pp.id, approveUrl: pp.approveUrl, totals },
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
      const totals = cartTotals(session.cart);
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
    description: 'Check whether the buyer\'s latest order (or a given order id) has been paid. Use for "did my payment go through?" or "has my invoice been paid?".',
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
        result: { order_id: o.id, status: o.status, total: o.total, method: o.method, items: o.items.map((i) => `${i.qty} x ${i.name}`) },
        ui: { type: 'order_status', order: { id: o.id, status: o.status, total: o.total, currency: o.currency, items: o.items, method: o.method } },
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
