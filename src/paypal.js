import { config, modes } from './config.js';
import { money, newId } from './store.js';

/*
 * PayPal REST client — Orders v2 and Invoicing v2.
 * In "mock" mode (no keys in .env) every call returns realistic fake data,
 * so the whole app can be run and judged without a PayPal account.
 */

const isMock = () => modes.paypal === 'mock';

let token = null;
let tokenExpires = 0;

async function accessToken() {
  if (token && Date.now() < tokenExpires - 60_000) return token;
  const auth = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
  const res = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new PayPalError('Could not get a PayPal access token. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.', res.status, await safeText(res));
  const data = await res.json();
  token = data.access_token;
  tokenExpires = Date.now() + data.expires_in * 1000;
  return token;
}

async function api(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${config.paypal.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      'PayPal-Request-Id': newId('req'), // idempotency
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = data?.details?.[0]?.description || data?.message || res.statusText;
    throw new PayPalError(`PayPal ${method} ${path} failed: ${detail}`, res.status, data);
  }
  return data;
}

export class PayPalError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const safeText = (res) => res.text().catch(() => '');

/* ---------------- Orders v2 ---------------- */

/** Create a CAPTURE order from server-computed totals. Returns { id, status, approveUrl }. */
export async function createOrder({ totals, localOrderId, storeName }) {
  if (isMock()) {
    const id = 'MOCK-' + newId('').slice(1).toUpperCase();
    return { id, status: 'CREATED', approveUrl: null };
  }
  const cur = totals.currency;
  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: localOrderId,
        custom_id: localOrderId,
        description: `${storeName} order ${localOrderId}`.slice(0, 127),
        amount: {
          currency_code: cur,
          value: money(totals.total),
          breakdown: {
            item_total: { currency_code: cur, value: money(totals.subtotal) },
            shipping: { currency_code: cur, value: money(totals.shipping) },
          },
        },
        items: totals.items.map((i) => ({
          name: i.name.slice(0, 127),
          sku: i.productId,
          quantity: String(i.qty),
          unit_amount: { currency_code: cur, value: money(i.unitPrice) },
          category: 'PHYSICAL_GOODS',
        })),
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: storeName.slice(0, 127),
          shipping_preference: 'GET_FROM_FILE',
          user_action: 'PAY_NOW',
        },
      },
    },
  };
  const data = await api('POST', '/v2/checkout/orders', body);
  const approveUrl = data.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href || null;
  return { id: data.id, status: data.status, approveUrl };
}

/** Capture an approved order. Returns { status, captureId, amount, payer }. */
export async function captureOrder(paypalOrderId) {
  if (isMock()) {
    return {
      status: 'COMPLETED',
      captureId: 'MOCKCAP-' + newId('').slice(1).toUpperCase(),
      amount: null,
      payer: { name: null, email: null },
    };
  }
  const data = await api('POST', `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {});
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    status: data.status, // COMPLETED when money moved
    captureStatus: capture?.status,
    captureId: capture?.id || null,
    amount: capture?.amount || null,
    payer: {
      name: [data.payer?.name?.given_name, data.payer?.name?.surname].filter(Boolean).join(' ') || null,
      email: data.payer?.email_address || null,
    },
  };
}

export async function getPaypalOrder(paypalOrderId) {
  if (isMock()) return { id: paypalOrderId, status: 'CREATED' };
  const data = await api('GET', `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
  return { id: data.id, status: data.status };
}

/* ---------------- Invoicing v2 ---------------- */

/** Create, send and return a payable invoice. Returns { id, number, status, payUrl, qrPng (base64|null) }. */
export async function createAndSendInvoice({ totals, buyerEmail, buyerName, localOrderId, storeName, note }) {
  if (isMock()) {
    const id = 'INV2-MOCK-' + newId('').slice(1).toUpperCase();
    return { id, number: localOrderId, status: 'SENT', payUrl: `https://www.sandbox.paypal.com/invoice/p/#${id}`, qrPng: null };
  }
  const cur = totals.currency;
  const dueDate = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
  const invoice = {
    detail: {
      currency_code: cur,
      reference: localOrderId,
      note: (note || `Thank you for shopping with ${storeName}!`).slice(0, 4000),
      payment_term: { due_date: dueDate },
    },
    invoicer: {
      business_name: storeName,
      ...(config.paypal.merchantEmail ? { email_address: config.paypal.merchantEmail } : {}),
    },
    primary_recipients: [
      {
        billing_info: {
          email_address: buyerEmail,
          ...(buyerName ? { name: { full_name: buyerName } } : {}),
        },
      },
    ],
    items: totals.items.map((i) => ({
      name: i.name.slice(0, 200),
      quantity: String(i.qty),
      unit_amount: { currency_code: cur, value: money(i.unitPrice) },
      unit_of_measure: 'QUANTITY',
    })),
    ...(totals.shipping
      ? { amount: { breakdown: { shipping: { amount: { currency_code: cur, value: money(totals.shipping) } } } } }
      : {}),
  };

  const created = await api('POST', '/v2/invoicing/invoices', invoice);
  const id = created.id || created.href?.split('/').pop();
  await api('POST', `/v2/invoicing/invoices/${id}/send`, { send_to_invoicer: true, send_to_recipient: true });
  const full = await api('GET', `/v2/invoicing/invoices/${id}`);

  let qrPng = null;
  try {
    qrPng = await invoiceQr(id);
  } catch (err) {
    console.warn('Invoice QR not available, the UI will draw one from the pay link:', err.message);
  }

  return {
    id,
    number: full.detail?.invoice_number,
    status: full.status,
    payUrl: full.detail?.metadata?.recipient_view_url || null,
    qrPng,
  };
}

async function invoiceQr(id) {
  const res = await fetch(`${config.paypal.baseUrl}/v2/invoicing/invoices/${id}/generate-qr-code`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ width: 300, height: 300 }),
  });
  if (!res.ok) throw new Error(`QR ${res.status}`);
  const text = (await res.text()).trim();
  // The API answers with a base64 PNG, sometimes wrapped in a multipart body.
  const match = text.match(/(iVBORw0KGgo[A-Za-z0-9+/=\r\n]+)/);
  return match ? match[1].replace(/\s/g, '') : null;
}

export async function getInvoiceStatus(invoiceId) {
  if (isMock()) return 'SENT';
  const data = await api('GET', `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
  return data.status; // DRAFT | SENT | PAID | MARKED_AS_PAID | CANCELLED ...
}
