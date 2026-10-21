import { products, getProduct, searchProducts, publicProduct } from '../catalog.js';
import { config } from '../config.js';
import { sessionTotals } from '../store.js';
import { CURRENCIES, currencyFromText, fmt, fmtNgn, fromNgn, toNgnFrom } from '../money.js';
import { findCity, findRelationship, isGiftIntent, looksLikePersonName, missingDelivery, parseDelivery } from '../nigeria.js';
import { runTool } from './tools.js';

/*
 * Offline "demo brain".
 * Runs the SAME tools as the Gemini agent, using simple intent rules, so the app works end to end
 * with no API key (for judges and local testing). The real AI path is Gemini — see gemini.js.
 */

const ORDINALS = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2, fourth: 3, '4th': 3 };
const GENERIC = new Set(['phone', 'laptop', 'power', 'bank', 'speaker', 'used', 'uk', 'grade', 'with', 'the', 'and', 'refurbished', 'pro', 'mah', 'light', 'air', 'note', 'active', 'watch', 'mic', 'station']);
const EMAIL_RE = /[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}/i;
const ngn = fmtNgn;

const BUDGET_RE = /(?:under|below|less than|max(?:imum)?|budget(?: of| is)?|up to|not more than|within|about|around|roughly|approx(?:imately)?|for)\s*(₦|n|ca\$|\$|£|€|usd|gbp|eur|cad)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|naira|ngn|dollars?|usd|pounds?|gbp|quid|euros?|eur|cad)?\b/i;

/**
 * Parse a budget: "under 150k", "below ₦200,000", "about £120", "under $120", "within 100 euros".
 * Returns { ngn, label } (limit in naira) or null. "about/around" gets 10% headroom.
 */
function parseBudget(msg, sessionCurrency) {
  const m = msg.match(BUDGET_RE);
  if (!m) return null;
  let n = Number(m[2].replace(/,/g, ''));
  const unit = (m[3] || '').toLowerCase();
  const sym = (m[1] || '').toLowerCase();
  if (unit === 'k') n *= 1000;
  if (unit === 'm') n *= 1_000_000;
  let cur = null;
  if (sym === '£' || sym === 'gbp' || /^(pounds?|gbp|quid)$/.test(unit)) cur = 'GBP';
  else if (sym === '€' || sym === 'eur' || /^(euros?|eur)$/.test(unit)) cur = 'EUR';
  else if (sym === 'ca$' || sym === 'cad' || unit === 'cad') cur = 'CAD';
  else if (sym === '$' || sym === 'usd' || /^(dollars?|usd)$/.test(unit)) cur = sessionCurrency === 'CAD' && sym === '$' ? 'CAD' : 'USD';
  const isNgn = sym === '₦' || sym === 'n' || /^(naira|ngn|k|m)$/.test(unit) || (!cur && n >= 5000);
  if (!cur && !isNgn) {
    if (/^for$/i.test(m[0].split(/\s/)[0])) return null; // "for 2" is a quantity, not a budget
    cur = sessionCurrency;
  }
  const loose = /^(about|around|roughly|approx)/i.test(m[0]) ? 1.1 : 1;
  if (isNgn) return { ngn: Math.round(n * loose), label: `${loose > 1 ? 'about ' : ''}${ngn(n)}`, raw: m[0] };
  return { ngn: Math.round(toNgnFrom(n, cur) * loose), label: `${loose > 1 ? 'about ' : ''}${fmt(n, cur)}`, raw: m[0] };
}

/** "my name is Tunde", "I'm Ada", "— Tunde", "from Tunde" -> "Tunde". */
function senderNameFrom(text) {
  const m = text.match(/\b(?:my name is|my name's|i am|i'm|im|this is|it's|from|signed|love,?)\s+([A-Z][a-z]{1,20})\b/) || text.match(/^—\s*([A-Z][a-z]{1,20})$/);
  if (!m) return null;
  const n = m[1];
  if (findCity(n) || /^(In|At|From|Buying|Looking|Here|Back|Sending|Abroad|London|Canada|Germany|Ireland|Texas|Houston|Toronto)$/i.test(n)) return null;
  return n;
}

const LANG_RE = /\b(?:in|use|write (?:it )?in)\s+(pidgin|yoruba|igbo|hausa|english)\b/i;
const FIELD_LABEL = { recipientName: 'full name', recipientPhone: 'phone number', address: 'street address', city: 'town or city', state: 'state' };

export async function runOffline(session, text) {
  const ui = [];
  const msg = text.toLowerCase().trim();
  const say = [];
  const call = (name, args = {}) => runTool(session, name, args, ui);
  /** "₦146,600 (£81)" — naira first, then what PayPal will charge in the buyer's currency. */
  const both = (p) => `${ngn(p.priceNgn)} (${fmt(fromNgn(p.priceNgn, session.currency), session.currency)})`;
  const bothTotal = (t) => `${ngn(t.totalNgn)} (${fmt(t.total, t.currency)})`;
  const who = () => (session.delivery?.relationship ? `your ${session.delivery.relationship}` : session.delivery?.recipientName || 'them');
  const askMissing = (missing) => {
    const where = session.delivery?.city ? ` in ${session.delivery.city}` : '';
    const fields = missing.map((k) => FIELD_LABEL[k]);
    const list2 = fields.length > 1 ? `${fields.slice(0, -1).join(', ')} and ${fields.at(-1)}` : fields[0];
    return `To deliver to ${who()}${where}, I need their ${list2}. You can send it all in one line, like: Grace Idoko, 0803 123 4567, 12 Ganaja Road, Lokoja.`;
  };

  // A. Currency from what the buyer says ("I'm in London", "about £120").
  const cur = currencyFromText(text);
  if (cur && cur !== session.currency && !/₦|naira|\d+k\b/i.test(text)) {
    await call('set_currency', { currency: cur });
    say.push(`I'll charge in ${CURRENCIES[cur].name} (${CURRENCIES[cur].symbol}) through PayPal and show naira prices too.`);
  }

  // B. Buying for someone back home ("a phone for my mum in Lokoja").
  if (isGiftIntent(text) && !session.delivery?.isGift) {
    const found = parseDelivery(text);
    await call('set_delivery', { is_gift: true, relationship: findRelationship(text) || undefined, city: found.city, state: found.state });
  }

  // C. Gift message preferences: sender's name and language.
  const lang = text.match(LANG_RE)?.[1];
  const sender = session.delivery?.isGift ? senderNameFrom(text) : null;
  if (session.delivery?.isGift && (lang || sender)) {
    await call('set_delivery', { ...(lang ? { message_language: lang.toLowerCase() } : {}), ...(sender ? { sender_name: sender } : {}) });
    if (msg.split(' ').length <= 6 && !/\b(check ?out|pay)\b/.test(msg)) {
      const bits = [lang && `the WhatsApp message will be in ${lang[0].toUpperCase()}${lang.slice(1).toLowerCase()}`, sender && `I'll sign it from ${sender}`].filter(Boolean);
      return done(`${say.join(' ')} Done — ${bits.join(', and ')}. Say "checkout" when you're ready to pay.`.trim());
    }
  }

  // D. Collecting the recipient's details for delivery in Nigeria.
  const missingNow = session.delivery ? missingDelivery(session.delivery) : [];
  const namesProduct = products.some((p) => mentions(msg, p)) || /\b(phone|laptop|earbuds?|speaker|watch|power ?bank|cart|compare|remove|invoice|add|show|want|need|buy|which|how much|price|cheaper|cheapest|first|second|third)\b/.test(msg);
  if (session.delivery?.isGift && missingNow.length && !namesProduct && !/^(yes|no|ok|okay|sure|checkout|check out|pay)\b/.test(msg)) {
    const found = parseDelivery(text);
    // A bare name ("Grace Idoko") when we're waiting for one.
    if (!found.recipientName && missingNow.includes('recipientName') && looksLikePersonName(text.trim()) && !findCity(text) && text.trim().split(/\s+/).length <= 4) {
      found.recipientName = text.trim();
    }
    const fields = Object.keys(found).filter((k) => missingNow.includes(k) || k === 'address' || k === 'recipientPhone');
    if (fields.length) {
      const args = {};
      if (found.recipientName) args.recipient_name = found.recipientName;
      if (found.recipientPhone) args.recipient_phone = found.recipientPhone;
      if (found.address) args.address = found.address;
      if (found.city) args.city = found.city;
      if (found.state) args.state = found.state;
      const r = await call('set_delivery', args);
      if (r.error) return done(r.error);
      if (r.missing_fields.length) return done(askMissing(r.missing_fields));
      const t = sessionTotals(session);
      say.push(`Got it — delivering to ${r.delivery.recipient_name}, ${r.delivery.address}, ${r.delivery.city}, ${r.delivery.state}.`);
      say.push(t.items.length
        ? `Your total is ${bothTotal(t)}. Say "checkout" to pay — and tell me your first name if you'd like me to sign the WhatsApp message to ${who()}.`
        : `Now, what would you like to send ${who()}?`);
      return done(say.join(' '));
    }
  }

  // 1. Invoice flow (explicit, or answering our "what's your email?")
  const email = text.match(EMAIL_RE)?.[0];
  const wantsInvoice = /\b(invoice|pay later|pay tomorrow|another (device|phone)|send (me )?(a |the )?(bill|link))\b/.test(msg);
  if (email && (wantsInvoice || session.pendingInvoice)) {
    session.pendingInvoice = false;
    const r = await call('send_invoice', { email });
    if (r.error) return done(r.error);
    return done(`Done! I've emailed a PayPal invoice for ${bothTotal(sessionTotals(session))} to ${r.emailed_to}. You can also scan the QR code or tap the pay link below — it's valid for 3 days.`);
  }
  if (wantsInvoice) {
    if (!sessionTotals(session).items.length) return done('Sure — first tell me what you\'d like to buy, then I\'ll send you a PayPal invoice for it.');
    session.pendingInvoice = true;
    return done('No problem. What email should I send the PayPal invoice to?');
  }
  if (email) {
    if (sessionTotals(session).items.length) {
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
    return done(`Sent! A PayPal invoice for ${bothTotal(sessionTotals(session))} is on its way to ${r.emailed_to}. You can also pay with the QR code below.`);
  }

  // "yes" to a single suggested product (an add-on or an alternative) adds it.
  if (/^(yes|yeah|yep|sure|ok|okay|go ahead)\b/.test(msg) && msg.split(' ').length <= 5 && session.lastShown.length === 1) {
    const p = getProduct(session.lastShown[0]);
    const r = await call('add_to_cart', { product_id: p.id });
    if (r.error) return done(r.error);
    session.lastShown = [];
    return done(`Added ${p.name}. Your total is ${bothTotal(r.cart)}. Say "checkout" when you're ready to pay.`);
  }

  // 2. Order status
  if (/\b(status|paid\?|has (it|my) .*(paid|gone)|go(ne)? through|did (my|the) payment|payment (status|confirmed)|delivered|received it|get it yet|where is (my|the) (order|phone|laptop|package|item)|tracking|track (my|the)|has (she|he|they|my \w+) (got|gotten|received))\b/.test(msg)) {
    const r = await call('check_order_status');
    if (r.error) return done("I can't find an order in this chat yet. Want me to help you pick something?");
    const label = { PAID: 'paid ✅', AWAITING_PAYMENT: 'waiting for payment', INVOICE_SENT: 'invoice sent, not paid yet', REPLACED: 'replaced by a newer checkout' }[r.payment_status] || r.payment_status;
    const step = { NOT_STARTED: 'being prepared', PACKED: 'packed and ready to go', OUT_FOR_DELIVERY: 'out for delivery 🚚', DELIVERED: 'delivered ✅' }[r.delivery_status];
    const to = r.delivers_to?.recipient_name ? ` to ${r.delivers_to.recipient_name} in ${r.delivers_to.city}` : '';
    return done(`Your order ${r.order_id} (${fmt(r.total, r.currency)}) is ${label}.${r.payment_status === 'PAID' && step ? ` Delivery${to}: ${step}.` : ''}`);
  }

  // 3. Remove
  if (/\b(remove|delete|take out|drop|don'?t want)\b/.test(msg)) {
    const cartIds = session.cart.map((l) => l.productId);
    const p = refProduct(msg, cartIds) || (cartIds.length === 1 ? getProduct(cartIds[0]) : null);
    if (!p) return done('Which item should I remove from your cart?');
    const r = await call('remove_from_cart', { product_id: p.id });
    if (r.error) return done(r.error);
    return done(r.cart.items.length ? `Removed ${p.name}. Your total is now ${bothTotal(r.cart)}.` : `Removed ${p.name}. Your cart is now empty.`);
  }

  // 4. Compare
  if (/\b(compare|comparison|vs\.?|versus|difference|which (one )?is better)\b/.test(msg)) {
    let ids = products.filter((p) => mentions(msg, p)).map((p) => p.id);
    if (ids.length < 2) ids = session.lastShown.filter((id) => getProduct(id)?.stock > 0).slice(0, 3);
    const r = await call('compare_products', { product_ids: ids });
    if (r.error) return done('Show me a few options first, then I can compare them for you.');
    const inStock = r.products.filter((p) => p.inStock);
    const cheapest = [...inStock].sort((a, b) => a.price - b.price)[0];
    const best = [...inStock].sort((a, b) => b.rating - a.rating)[0];
    return done(
      best && cheapest && best.id !== cheapest.id
        ? `Here's the side-by-side. Best overall: ${best.name} (${best.rating}★). Best value: ${cheapest.name} at ${both(getProduct(cheapest.id))}. Want me to add one?`
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
        const t = sessionTotals(session);
        say.push(`Total: ${bothTotal(t)}${t.shippingNgn ? `, incl. ${ngn(t.shippingNgn)} delivery (free from ${ngn(t.freeDeliveryFromNgn)})` : ' with free delivery anywhere in Nigeria'}.`);
        if (session.delivery?.isGift && missingDelivery(session.delivery).length) {
          say.push(askMissing(missingDelivery(session.delivery)));
          return done(say.join(' '));
        }
        const addon = suggestAddon(session);
        say.push(addon ? `Want ${/^[aeiou]/i.test(addon.name) ? 'an' : 'a'} ${addon.name} for ${both(addon)} to go with it, or shall we check out?` : 'Ready to check out?');
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
    if (r.error) {
      if (r.error.includes('empty')) return done("Your cart is empty — tell me what you're looking for and I'll find it.");
      if (r.error.includes('Delivery details')) return done(`${say.join(' ')} Almost there! ${askMissing(missingDelivery(session.delivery))}`.trim());
      return done(r.error);
    }
    say.push(`Your order comes to ${ngn(r.total_ngn)} — charged as ${fmt(r.total, r.currency)} through PayPal.`);
    if (r.delivers_to) say.push(`${config.store.name} will deliver to ${r.delivers_to.recipient_name} in ${r.delivers_to.city} within ${config.store.deliveryDays}.`);
    say.push(`Tap the PayPal button below to pay securely — I'll confirm as soon as it goes through.`);
    return done(say.join(' '));
  }

  // 7. Cart
  if (/\b(cart|basket|total|how much)\b/.test(msg)) {
    const r = await call('view_cart');
    if (!r.items.length) return done("Your cart is empty. What are you shopping for today?");
    return done(`You have ${r.itemCount} item${r.itemCount > 1 ? 's' : ''} — total ${bothTotal(r)}. Say "checkout" when you're ready.`);
  }

  // 8. Small talk
  if (/^(hi|hello|hey|good (morning|afternoon|evening)|howdy|yo)\b/.test(msg) && msg.split(' ').length <= 4) {
    return done(`Hi! I'm Oja, ${config.store.name}'s shopping assistant. Tell me what you need — like "a phone under 200k for content" — or, if you live abroad, "a phone for my mum in Lokoja, about £120". I'll find it, you pay with PayPal, and we deliver in Nigeria.`);
  }
  if (/^(thanks|thank you|ok|okay|cool|great|nice)\b/.test(msg) && msg.split(' ').length <= 4) {
    return done('Anytime! Anything else you need?');
  }

  // 9. Default: product search
  const budget = parseBudget(text, session.currency);
  let query = budget ? text.replace(budget.raw, ' ') : text;
  // Drop the gift/location wording so it doesn't confuse the product search.
  query = query
    .replace(/\b(for|to)\s+(my|our)\s+[a-z-]+(?:\s+(?:in|at)\s+[a-z]+(?:\s+(?:city|state))?)?/gi, ' ')
    .replace(/\b(i'?m|i am|we'?re|living|based|live)\s+(in|at)\s+[a-z]+/gi, ' ')
    .replace(/\b(back home|hi|hello|hey)\b/gi, ' ');
  if (!query.replace(/[^a-z]/gi, '').length && session.delivery?.isGift) query = 'phone';
  const r = await call('search_products', { query, ...(budget ? { max_price_ngn: budget.ngn } : {}) });
  if (!r.count) {
    return done(`${say.join(' ')} I couldn't find that in stock${budget ? ` for ${budget.label}` : ''}. We carry phones, laptops, audio, power banks and solar, wearables and creator gear — what should I look for?`.trim());
  }
  const inStock = r.products.filter((p) => p.inStock);
  const out = r.products.filter((p) => !p.inStock);

  // Best match is out of stock: be honest and offer the closest in-stock alternative.
  if (!r.products[0].inStock) {
    const wanted = getProduct(r.products[0].id);
    // Closest alternative: most shared features first, then nearest price.
    const overlap = (p) => p.tags.filter((t) => wanted.tags.includes(t)).length;
    const alt = products
      .filter((p) => p.category === wanted.category && p.stock > 0 && p.id !== wanted.id)
      .sort((a, b) => overlap(b) - overlap(a) || Math.abs(a.price - wanted.price) - Math.abs(b.price - wanted.price))[0];
    if (!alt) return done(`${wanted.name} is out of stock right now, sorry. I'll let the team know you asked.`);
    ui.length = 0;
    ui.push({ type: 'products', products: [wanted, alt].map((p) => publicProduct(p, session.currency)) });
    session.lastShown = [alt.id];
    return done(`${wanted.name} is out of stock right now, sorry. The closest alternative is ${alt.name} at ${both(alt)} — ${lower(alt.summary)} Want me to add it?`);
  }

  const forWho = session.delivery?.isGift ? ` for ${who()}` : '';
  let top = getProduct(inStock[0].id);
  let why = lower(top.summary);
  // A gift for a parent or relative: favour a long battery and plenty of storage, and say why in plain words.
  if (session.delivery?.isGift && top.category === 'phones') {
    const easy = inStock.map((x) => getProduct(x.id))
      .sort((a, b) => b.tags.includes('big battery') - a.tags.includes('big battery') || b.rating - a.rating)[0];
    top = easy;
    why = `${easy.specs.battery} battery that lasts through power cuts, ${easy.specs.storage} for photos and WhatsApp, and ${easy.rating}★ from buyers.`;
    session.lastShown = [top.id, ...session.lastShown.filter((id) => id !== top.id)];
    const cards = ui.find((u) => u.type === 'products');
    if (cards) cards.products.sort((a, b) => (a.id === top.id ? -1 : b.id === top.id ? 1 : 0));
  }
  say.push(`Here ${inStock.length > 1 ? `are my top ${inStock.length} picks` : 'is my pick'}${forWho}${budget ? ` for ${budget.label}` : ''}. ${top.name} at ${both(top)} stands out — ${why}`);
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
