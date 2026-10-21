import { modes } from './config.js';
import { listEvents, listOrders, listSessions } from './store.js';
import { geminiText } from './agent/gemini.js';

const PAID = new Set(['PAID']);

export function sellerStats() {
  const orders = listOrders();
  const sessions = listSessions().filter((s) => s.history.some((h) => h.role === 'user'));
  const events = listEvents();

  const paid = orders.filter((o) => PAID.has(o.status));
  // Buyers pay in different currencies, so the headline is in naira; the breakdown keeps each currency.
  const revenueNgn = paid.reduce((s, o) => s + (o.totalNgn || 0), 0);
  const byCurrency = {};
  for (const o of paid) byCurrency[o.currency] = round((byCurrency[o.currency] || 0) + o.total);
  const gifts = paid.filter((o) => o.delivery?.isGift);
  const paidSessions = new Set(paid.map((o) => o.sessionId));

  const searches = events.filter((e) => e.type === 'search');
  const unmet = searches.filter((e) => e.inStock === 0 || e.topOutOfStock);

  const productSales = {};
  for (const o of paid) for (const i of o.items) productSales[i.name] = (productSales[i.name] || 0) + i.qty;

  const abandoned = orders.filter((o) => o.status === 'AWAITING_PAYMENT' && Date.now() - o.createdAt > 10 * 60_000);

  return {
    revenueNgn,
    revenueByCurrency: byCurrency,
    paidOrders: paid.length,
    averageOrderNgn: paid.length ? Math.round(revenueNgn / paid.length) : 0,
    giftOrders: gifts.length,
    giftRevenueNgn: gifts.reduce((s, o) => s + (o.totalNgn || 0), 0),
    deliveriesPending: paid.filter((o) => o.deliveryStatus !== 'DELIVERED').length,
    deliveryCities: topN(paid.filter((o) => o.delivery?.city).map((o) => o.delivery.city), 5),
    sources: topN(sessions.map((s) => s.source || 'direct'), 6),
    conversations: sessions.length,
    conversionRate: sessions.length ? Math.round((paidSessions.size / sessions.length) * 100) : 0,
    awaitingPayment: orders.filter((o) => o.status === 'AWAITING_PAYMENT').length,
    invoicesOpen: orders.filter((o) => o.status === 'INVOICE_SENT').length,
    abandonedCheckouts: abandoned.length,
    topSearches: topN(searches.map((e) => clean(e.query)), 6),
    unmetDemand: topN(unmet.map((e) => e.topOutOfStock || clean(e.query)), 5),
    topProducts: Object.entries(productSales).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty })),
  };
}

export async function sellerInsight() {
  const stats = sellerStats();
  if (modes.ai === 'gemini') {
    try {
      const text = await geminiText(
        'You are a sharp retail analyst for a small Nigerian online gadget store. Write 3 short, specific, actionable insights for the owner based ONLY on the stats given. Each insight is one sentence starting with a verb. No headers, no markdown, one insight per line.',
        JSON.stringify(stats),
      );
      return { insights: text.split('\n').map((l) => l.replace(/^[-*•\d.\s]+/, '').trim()).filter(Boolean).slice(0, 3), source: 'gemini', stats };
    } catch (err) {
      console.error('Insight via Gemini failed:', err.message);
    }
  }
  return { insights: ruleInsights(stats), source: 'rules', stats };
}

function ruleInsights(s) {
  const out = [];
  if (s.unmetDemand.length) out.push(`Restock or source "${s.unmetDemand[0].term}" — buyers asked for it ${s.unmetDemand[0].count}× while it was out of stock.`);
  if (s.giftOrders) {
    const share = s.revenueNgn ? Math.round((s.giftRevenueNgn / s.revenueNgn) * 100) : 0;
    const abroad = Object.keys(s.revenueByCurrency).filter((c) => c !== 'USD');
    out.push(`Market to Nigerians abroad — family gifts are ${share}% of your sales${abroad.length ? `, paid in ${abroad.join(' and ')}` : ''}.`);
  }
  if (s.deliveriesPending) out.push(`Dispatch ${s.deliveriesPending} paid order${s.deliveriesPending > 1 ? 's' : ''} still waiting for delivery.`);
  if (s.abandonedCheckouts) out.push(`Follow up on ${s.abandonedCheckouts} unpaid checkout${s.abandonedCheckouts > 1 ? 's' : ''} — offer a PayPal invoice so they can pay later.`);
  if (s.topProducts[0]) out.push(`Feature ${s.topProducts[0].name} on your homepage — it's your best seller (${s.topProducts[0].qty} sold).`);
  const topAsk = s.topSearches.find((t) => !s.unmetDemand.some((u) => u.term.toLowerCase().includes(t.term) || t.term.includes(u.term.toLowerCase().split(' (')[0])));
  if (topAsk && out.length < 3) out.push(`Create a post about "${topAsk.term}" — it's one of the things buyers ask Oja for most.`);
  if (s.invoicesOpen && out.length < 3) out.push(`Send a reminder for ${s.invoicesOpen} open invoice${s.invoicesOpen > 1 ? 's' : ''}.`);
  if (!out.length) out.push('Share your Oja chat link on WhatsApp and X to start getting conversations.');
  return out.slice(0, 3);
}

function topN(list, n) {
  const counts = {};
  for (const t of list) if (t) counts[t] = (counts[t] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([term, count]) => ({ term, count }));
}

const FILLER = /^(hi|hello|hey|please|pls|abeg|i need|i want|i'm looking for|im looking for|looking for|do you have|do you sell|show me|i also want|can i get|get me|any)\b\s*/;
function clean(q) {
  let s = String(q || '').toLowerCase().replace(/[^a-z0-9 $']/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) s = s.replace(FILLER, '').replace(/^(a|an|some|the)\s+/, '');
  return s.slice(0, 60);
}
const round = (n) => Math.round(n * 100) / 100;
