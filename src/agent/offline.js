import { products, getProduct, searchProducts, publicProduct } from '../catalog.js';
import { cartTotals } from '../store.js';
import { runTool } from './tools.js';

/*
 * Offline "demo brain".
 * Runs the SAME tools as the Gemini agent, using simple intent rules, so the app works end to end
 * with no API key (for judges and local testing). The real AI path is Gemini — see gemini.js.
 */

const ORDINALS = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3 };
const GENERIC = new Set(['phone', 'laptop', 'power', 'bank', 'speaker', 'used', 'uk', 'grade', 'with', 'the', 'and', 'refurbished', 'pro', 'mah', 'light', 'air', 'note', 'active', 'watch', 'mic', 'station']);
const EMAIL_RE = /[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}/i;
const usd = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;

export async function runOffline(session, text) {
  const ui = [];
  const msg = text.toLowerCase().trim();
  const say = [];
  const call = (name, args = {}) => runTool(session, name, args, ui);

  // 1. Invoice flow (explicit, or answering our "what's your email?")
  const email = text.match(EMAIL_RE)?.[0];
  const wantsInvoice = /\b(invoice|pay later|pay tomorrow|another (device|phone)|send (me )?(a |the )?(bill|link))\b/.test(msg);
  if (email && (wantsInvoice || session.pendingInvoice)) {
    session.pendingInvoice = false;
    const r = await call('send_invoice', { email });
    if (r.error) return done(r.error);
    return done(`Done! I've emailed a PayPal invoice for ${usd(r.total)} to ${r.emailed_to}. You can also scan the QR code or tap the pay link below — it's valid for 3 days.`);
  }
  if (wantsInvoice) {
    if (!cartTotals(session.cart).items.length) return done('Sure — first tell me what you\'d like to buy, then I\'ll send you a PayPal invoice for it.');
    session.pendingInvoice = true;
    return done('No problem. What email should I send the PayPal invoice to?');
  }
  if (email) {
    if (cartTotals(session.cart).items.length) {
      session.pendingInvoice = true;
      session.buyerEmail = email;
      return done(`Got it — ${email}. Shall I send a PayPal invoice for your cart there, or would you rather pay right now with the PayPal button?`);
    }
    return done("Thanks! Tell me what you'd like to buy and I can invoice you or let you pay right here.");
  }
  if (session.pendingInvoice && /^(yes|yeah|yep|ok|okay|sure|send( it)?|please do)\b/.test(msg) && session.buyerEmail) {
    session.pendingInvoice = false;
    const r = await call('send_invoice', { email: session.buyerEmail });
    if (r.error) return done(r.error);
    return done(`Sent! A PayPal invoice for ${usd(r.total)} is on its way to ${r.emailed_to}. You can also pay with the QR code below.`);
  }

  // "yes" to a single suggested product (an add-on or an alternative) adds it.
  if (/^(yes|yeah|yep|sure|ok|okay|go ahead)\b/.test(msg) && msg.split(' ').length <= 5 && session.lastShown.length === 1) {
    const p = getProduct(session.lastShown[0]);
    const r = await call('add_to_cart', { product_id: p.id });
    if (r.error) return done(r.error);
    session.lastShown = [];
    return done(`Added ${p.name}. Your total is ${usd(r.cart.total)}. Say "checkout" when you're ready to pay.`);
  }

  // 2. Order status
  if (/\b(status|paid\?|has (it|my) .*(paid|gone)|go(ne)? through|did (my|the) payment|payment (status|confirmed))\b/.test(msg)) {
    const r = await call('check_order_status');
    if (r.error) return done("I can't find an order in this chat yet. Want me to help you pick something?");
    const label = { PAID: 'paid ✅', AWAITING_PAYMENT: 'waiting for payment', INVOICE_SENT: 'invoice sent, not paid yet', REPLACED: 'replaced by a newer checkout' }[r.status] || r.status;
    return done(`Your order ${r.order_id} (${usd(r.total)}) is ${label}.`);
  }

  // 3. Remove
  if (/\b(remove|delete|take out|drop|don'?t want)\b/.test(msg)) {
    const cartIds = session.cart.map((l) => l.productId);
    const p = refProduct(msg, cartIds) || (cartIds.length === 1 ? getProduct(cartIds[0]) : null);
    if (!p) return done('Which item should I remove from your cart?');
    const r = await call('remove_from_cart', { product_id: p.id });
    if (r.error) return done(r.error);
    return done(r.cart.items.length ? `Removed ${p.name}. Your total is now ${usd(r.cart.total)}.` : `Removed ${p.name}. Your cart is now empty.`);
  }

  // 4. Compare
  if (/\b(compare|comparison|vs\.?|versus|difference|which (one )?is better)\b/.test(msg)) {
    let ids = products.filter((p) => mentions(msg, p)).map((p) => p.id);
    if (ids.length < 2) ids = session.lastShown.slice(0, 3);
    const r = await call('compare_products', { product_ids: ids });
    if (r.error) return done('Show me a few options first, then I can compare them for you.');
    const inStock = r.products.filter((p) => p.inStock);
    const cheapest = [...inStock].sort((a, b) => a.price - b.price)[0];
    const best = [...inStock].sort((a, b) => b.rating - a.rating)[0];
    return done(
      best && cheapest && best.id !== cheapest.id
        ? `Here's the side-by-side. Best overall: ${best.name} (${best.rating}★). Best value: ${cheapest.name} at ${usd(cheapest.price)}. Want me to add one?`
        : `Here's the side-by-side comparison. Want me to add one to your cart?`,
    );
  }

  // 5. Add to cart (supports "the cheaper one and a power bank")
  const wantsCheckout = /\b(check ?out|pay( now)?|proceed|place (the |my )?order|that'?s all|buy (it|them|now))\b/.test(msg);
  // Strong verbs may pick the best match for a generic item ("add a power bank").
  // Weak verbs ("I want", "get me") only add when they point at a specific product; otherwise we search.
  const addMatch = msg.match(/\b(add|put|i'?ll take|i will take|i'?ll go with|go with|take|i (?:also )?want|get me|give me|let me get|buy)\b(.*)/);
  const strong = addMatch && /^(add|put|i'?ll take|i will take|i'?ll go with|go with|take)$/.test(addMatch[1]);
  if (addMatch) {
    let rest = addMatch[2].trim();
    if (/^(it|that|this|this one|that one|one)?\s*(to (my|the) cart)?\s*(please)?$/.test(rest)) rest = 'that one';
    const segments = rest.split(/,| and | plus | with |then/).map((s) => s.trim()).filter(Boolean);
    const added = [];
    const addedIds = [];
    const failed = [];
    for (const seg of segments) {
      if (/\b(check ?out|pay|proceed)\b/.test(seg)) continue;
      const qty = Number(seg.match(/\b(\d+)\s*(x|pcs|pieces|units)?\b/)?.[1]) || 1;
      const ref = seg === 'that one' ? topShown(session) : refProduct(seg, session.lastShown);
      const p = ref || (strong ? bestMatch(seg) : null);
      if (!p) continue;
      const r = await call('add_to_cart', { product_id: p.id, quantity: qty > 10 ? 1 : qty });
      if (r.error) failed.push(r.error);
      else {
        added.push(qty > 1 ? `${qty} × ${p.name}` : p.name);
        addedIds.push(p.id);
      }
    }
    if (!added.length && !failed.length && strong && !wantsCheckout) {
      return done('Which product should I add? You can say its name, or "the first one" from the options I showed.');
    }
    if (added.length || failed.length) {
      if (addedIds.length) {
        // Offer the add-on next, so "add it" / "yes add it" means the suggestion.
        const addon = suggestAddon(session);
        session.lastShown = addon ? [addon.id] : [];
      }
      if (added.length) say.push(`Added ${list(added)} to your cart.`);
      if (failed.length) say.push(failed.join(' '));
      if (!wantsCheckout) {
        const t = cartTotals(session.cart);
        say.push(`Total: ${usd(t.total)}${t.shipping ? ` (incl. ${usd(t.shipping)} shipping — free from ${usd(t.freeShippingFrom)})` : ' with free shipping'}.`);
        const addon = suggestAddon(session);
        say.push(addon ? `Want ${/^[aeiou]/i.test(addon.name) ? 'an' : 'a'} ${addon.name} (${usd(addon.price)}) to go with it, or shall we check out?` : 'Ready to check out?');
        return done(say.join(' '));
      }
    }
  }

  // 6. Checkout
  if (wantsCheckout) {
    if (!session.cart.length && session.lastShown.length) {
      const p = refProduct(msg, session.lastShown);
      if (p) await call('add_to_cart', { product_id: p.id });
    }
    const r = await call('create_checkout');
    if (r.error) return done(r.error.includes('empty') ? "Your cart is empty — tell me what you're looking for and I'll find it." : r.error);
    say.push(`Your order comes to ${usd(r.total)}. Tap the PayPal button below to pay securely — I'll confirm as soon as it goes through.`);
    return done(say.join(' '));
  }

  // 7. Cart
  if (/\b(cart|basket|total|how much)\b/.test(msg)) {
    const r = await call('view_cart');
    if (!r.items.length) return done("Your cart is empty. What are you shopping for today?");
    return done(`You have ${r.itemCount} item${r.itemCount > 1 ? 's' : ''} — total ${usd(r.total)}. Say "checkout" when you're ready.`);
  }

  // 8. Small talk
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|howdy|yo)\b/.test(msg) && msg.split(' ').length <= 4) {
    return done("Hi! I'm Oja, Danzora's shopping assistant. Tell me what you need — for example \"a phone under $200 for content\" — and I'll find it and help you pay with PayPal.");
  }
  if (/^(thanks|thank you|ok|okay|cool|great|nice)\b/.test(msg) && msg.split(' ').length <= 4) {
    return done('Anytime! Anything else you need?');
  }

  // 9. Default: product search
  const maxPrice = Number(msg.match(/(?:under|below|less than|max|budget(?: of| is)?|up to)\s*\$?\s*(\d{2,5})/)?.[1]) || undefined;
  const r = await call('search_products', { query: text, ...(maxPrice ? { max_price: maxPrice } : {}) });
  if (!r.count) {
    return done(`I couldn't find that in stock${maxPrice ? ` under ${usd(maxPrice)}` : ''}. We carry phones, laptops, audio, power banks and solar, wearables and creator gear — what should I look for?`);
  }
  const inStock = r.products.filter((p) => p.inStock);
  const out = r.products.filter((p) => !p.inStock);

  // Best match is out of stock: be honest and offer the closest in-stock alternative.
  if (!r.products[0].inStock) {
    const wanted = getProduct(r.products[0].id);
    const alt = searchProducts({ query: wanted.tags.join(' '), category: wanted.category, inStockOnly: true, limit: 8 })
      .sort((a, b) => Math.abs(a.price - wanted.price) - Math.abs(b.price - wanted.price))[0];
    if (!alt) return done(`${wanted.name} is out of stock right now, sorry. I'll let the team know you asked.`);
    ui.length = 0;
    ui.push({ type: 'products', products: [wanted, alt].map(publicProduct) });
    session.lastShown = [alt.id];
    return done(`${wanted.name} is out of stock right now, sorry. The closest alternative is ${alt.name} at ${usd(alt.price)} — ${lower(alt.summary)} Want me to add it?`);
  }

  const top = inStock[0];
  say.push(`Here ${inStock.length > 1 ? `are my top ${inStock.length} picks` : 'is my pick'}${maxPrice ? ` under ${usd(maxPrice)}` : ''}. ${top.name} (${usd(top.price)}) stands out — ${lower(top.summary)}`);
  if (out.length) say.push(`(${out[0].name} is out of stock.)`);
  say.push(inStock.length > 1 ? 'Want me to compare them, or add one to your cart?' : 'Shall I add it to your cart?');
  return done(say.join(' '));

  function done(reply) {
    return { reply, ui };
  }
}

/* ---------- helpers ---------- */

function refProduct(text, ids) {
  const pool = ids.map(getProduct).filter(Boolean);
  if (!pool.length) return null;
  for (const [word, idx] of Object.entries(ORDINALS)) {
    if (new RegExp(`\\b${word}\\b`).test(text) && pool[idx]) return pool[idx];
  }
  if (/\b(last|that) one\b/.test(text)) return pool.at(-1);
  if (/\b(cheap(er|est)|lower price|less expensive)\b/.test(text)) return [...pool].filter((p) => p.stock > 0).sort((a, b) => a.price - b.price)[0];
  if (/\b(best|top|highest rated|better)\b/.test(text)) return [...pool].filter((p) => p.stock > 0).sort((a, b) => b.rating - a.rating)[0];
  if (/\b(it|this|that)\b/.test(text) && pool.length === 1) return pool[0];
  return pool.find((p) => mentions(text, p)) || null;
}

function topShown(session) {
  return session.lastShown.map(getProduct).find((p) => p && p.stock > 0) || null;
}

function mentions(text, p) {
  const tokens = p.name.toLowerCase().replace(/[()",]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !GENERIC.has(t));
  return tokens.some((t) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text));
}

function bestMatch(seg) {
  const named = products.find((p) => p.stock > 0 && mentions(seg, p));
  if (named) return named;
  const words = seg.replace(/\b(a|an|the|some|one|me|please|also)\b/g, ' ').trim();
  if (words.length < 3) return null;
  return searchProducts({ query: words, inStockOnly: true, limit: 1 })[0] || null;
}

const ADDONS = { phones: 'pw-oraimo-20k', laptops: 'pw-solar-gen', 'ac-ringlight': 'au-boya-mic', 'au-boya-mic': 'ac-ringlight' };

function suggestAddon(session) {
  if (session.cart.length !== 1) return null;
  const main = getProduct(session.cart[0].productId);
  const addonId = ADDONS[main.id] || ADDONS[main.category];
  const addon = addonId && getProduct(addonId);
  return addon && addon.stock > 0 && addon.id !== main.id ? addon : null;
}

const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
