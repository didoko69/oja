// Oja buyer chat — vanilla JS, no build step.

const $ = (sel, el = document) => el.querySelector(sel);
const thread = $('#thread');
const input = $('#input');
const form = $('#composer');
const sendBtn = $('.send');

const state = { sessionId: null, config: null, currency: 'USD', busy: false, paypal: { promise: null, currency: null }, polling: new Set() };

const SYMBOL = { USD: '$', GBP: '£', EUR: '€', CAD: 'CA$' };
/** Amount in a checkout currency: "£81", "$110.50". */
const money = (n, cur = state.currency) => `${SYMBOL[cur] || ''}${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const ngn = (n) => `₦${Math.round(n).toLocaleString('en-US')}`;
/** "+2348031234567" -> "0803 123 4567" */
const localPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '').replace(/^234/, '');
  return d.length === 10 ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(p || '');
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/* ---------------- boot ---------------- */

async function boot() {
  state.config = await api('GET', '/api/config');
  const { store: s, modes } = state.config;
  $('#store-line').textContent = `Shopping assistant for ${s.name}`;
  document.title = `Oja — shop ${s.name} by chat`;
  $('#mode-line').textContent = [
    modes.ai === 'gemini' ? 'AI by Google Gemini' : 'Offline demo AI',
    modes.paypal === 'sandbox' ? 'PayPal sandbox — use a sandbox buyer account' : 'PayPal test mode — no real money moves',
  ].join('. ') + '.';

  const saved = store.get('oja.session');
  if (saved) {
    try {
      const { history, cart, currency } = await api('GET', `/api/session/${saved}`);
      state.sessionId = saved;
      setCurrency(currency);
      if (history.length) hideIntro();
      for (const h of history) addMsg(h.role === 'user' ? 'me' : 'bot', h.text);
      updateCart(cart, false);
    } catch { /* expired, start fresh */ }
  }
  if (!state.sessionId) {
    // Locale picks the first currency (en-GB -> £); ?src=whatsapp tells the seller where buyers come from.
    const source = new URLSearchParams(location.search).get('src') || (document.referrer ? new URL(document.referrer).hostname : 'direct');
    const out = await api('POST', '/api/session', { locale: navigator.language, source });
    state.sessionId = out.sessionId;
    setCurrency(out.currency);
    store.set('oja.session', state.sessionId);
  }
  scrollDown();
}

/* ---------------- sending ---------------- */

form.addEventListener('submit', (e) => {
  e.preventDefault();
  send(input.value);
});

document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => send(chip.textContent)));

$('#cart-chip').addEventListener('click', () => send('Show my cart'));

$('#currency').addEventListener('change', async (e) => {
  try {
    const out = await api('POST', '/api/currency', { sessionId: state.sessionId, currency: e.target.value });
    setCurrency(out.currency);
    updateCart(out.cart, false);
    addMsg('bot', `Prices will now show in ${SYMBOL[out.currency]} as well as naira, and PayPal will charge in ${out.currency}.`);
  } catch (err) {
    addMsg('error', err.message);
  }
});

function setCurrency(cur) {
  if (!cur) return;
  state.currency = cur;
  $('#currency').value = cur;
}

async function send(text) {
  text = text.trim();
  if (!text || state.busy) return;
  state.busy = true;
  sendBtn.disabled = true;
  input.value = '';
  hideIntro();
  addMsg('me', text);
  const typing = showTyping();
  try {
    const out = await api('POST', '/api/chat', { sessionId: state.sessionId, message: text });
    typing.remove();
    if (out.reply) addMsg('bot', out.reply);
    if (out.cart?.currency) setCurrency(out.cart.currency);
    for (const ui of out.ui || []) renderUi(ui);
    updateCart(out.cart);
  } catch (err) {
    typing.remove();
    addMsg('error', err.message);
  } finally {
    state.busy = false;
    sendBtn.disabled = false;
    input.focus();
    scrollDown();
  }
}

/* ---------------- rendering ---------------- */

function addMsg(kind, text) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  el.textContent = text;
  thread.append(el);
  scrollDown();
  return el;
}

function showTyping() {
  const el = $('#tpl-typing').content.firstElementChild.cloneNode(true);
  thread.append(el);
  scrollDown();
  return el;
}

function hideIntro() {
  $('#intro')?.remove();
  $('#chips')?.setAttribute('hidden', '');
}

function renderUi(ui) {
  const r = { products: renderProducts, comparison: renderComparison, checkout: renderCheckout, invoice: renderInvoice, order_status: renderStatus, delivery: renderDelivery, currency: (u) => setCurrency(u.currency) }[ui.type];
  if (r) r(ui);
  // "cart" events update the header chip; no extra card needed in the thread.
}

const GLYPH = {
  phones: '<rect x="15" y="5" width="18" height="38" rx="4"/><path d="M21 37h6"/>',
  laptops: '<rect x="9" y="10" width="30" height="20" rx="2"/><path d="M5 36h38l-3-6H8z"/>',
  audio: '<path d="M10 28v-4a14 14 0 0 1 28 0v4"/><rect x="7" y="27" width="8" height="12" rx="3"/><rect x="33" y="27" width="8" height="12" rx="3"/>',
  power: '<rect x="9" y="14" width="28" height="20" rx="4"/><path d="M37 21h3v6h-3M24 17l-5 8h6l-4 7"/>',
  wearables: '<rect x="14" y="13" width="20" height="22" rx="6"/><path d="M18 13l2-7h8l2 7M18 35l2 7h8l2-7"/>',
  accessories: '<circle cx="24" cy="20" r="12"/><circle cx="24" cy="20" r="6"/><path d="M24 32v10M18 44h12"/>',
};

function glyph(p) {
  return `<svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[p.category] || GLYPH.accessories}</svg>`;
}

function thumb(p) {
  if (p.image) {
    const credit = p.imageCredit
      ? `<a class="credit" href="${esc(p.imageCredit.url)}" target="_blank" rel="noopener">Photo: Wikimedia Commons${p.imageCredit.note ? ` (${esc(p.imageCredit.note)})` : ''}</a>`
      : '';
    return `<div class="thumb photo"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" data-cat="${esc(p.category)}">${credit}</div>`;
  }
  return `<div class="thumb"><svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[p.category] || GLYPH.accessories}</svg></div>`;
}

function renderProducts({ products }) {
  const strip = document.createElement('div');
  strip.className = 'strip';
  strip.setAttribute('role', 'list');
  for (const p of products) {
    const card = document.createElement('article');
    card.className = `card${p.inStock ? '' : ' out'}`;
    card.setAttribute('role', 'listitem');
    card.innerHTML = `
      ${thumb(p)}
      <div class="body">
        <h3>${esc(p.name)}</h3>
        <p class="sum">${esc(p.summary)}</p>
        <div class="meta">★ ${p.rating} · ${p.inStock ? (p.stockLeft <= 5 ? `Only ${p.stockLeft} left` : 'In stock') : 'Out of stock'}</div>
        <div class="row">
          <span class="price">${ngn(p.priceNgn)}<small class="usd">${money(p.price, p.currency)}</small></span>
          ${p.inStock ? `<button class="btn add" type="button">Add to cart</button>` : ''}
        </div>
      </div>`;
    card.querySelector('.add')?.addEventListener('click', (e) => addFromCard(p, e.currentTarget));
    // If a photo can't load, fall back to the category icon instead of a broken image.
    card.querySelector('.thumb img')?.addEventListener('error', (e) => {
      const box = e.currentTarget.parentElement;
      box.classList.remove('photo');
      box.innerHTML = glyph(p);
    }, { once: true });
    strip.append(card);
  }
  thread.append(strip);
}

async function addFromCard(p, btn) {
  btn.disabled = true;
  try {
    const { cart } = await api('POST', '/api/cart/add', { sessionId: state.sessionId, productId: p.id });
    btn.textContent = 'Added';
    updateCart(cart);
    addMsg('bot', `${p.name} is in your cart. Total ${ngn(cart.totalNgn)} (${money(cart.total, cart.currency)}). Say "checkout" when you're ready.`);
  } catch (err) {
    btn.disabled = false;
    addMsg('error', err.message);
  }
}

function renderComparison({ products, rows }) {
  const wrap = document.createElement('div');
  wrap.className = 'compare';
  const head = products.map((p) => `<th scope="col">${esc(p.name)}</th>`).join('');
  const line = (label, fn) => `<tr><th scope="row">${esc(label)}</th>${products.map((p) => `<td>${fn(p)}</td>`).join('')}</tr>`;
  wrap.innerHTML = `<table>
    <thead><tr><th></th>${head}</tr></thead>
    <tbody>
      ${line('Price', (p) => `<span class="price">${ngn(p.priceNgn)}</span> <small class="usd">${money(p.price, p.currency)}</small>`)}
      ${line('Rating', (p) => `★ ${p.rating}`)}
      ${rows.map((r) => line(r, (p) => esc(p.specs[r] ?? '—'))).join('')}
      ${line('Stock', (p) => (p.inStock ? 'In stock' : 'Out of stock'))}
    </tbody></table>`;
  thread.append(wrap);
}

function receiptHtml(totals, title, ref) {
  return `
    <header><strong>${esc(title)}</strong><span>${esc(ref)}</span></header>
    <ul>
      ${totals.items.map((i) => `<li><span class="name">${i.qty > 1 ? `${i.qty} × ` : ''}${esc(i.name)}</span><span class="dots"></span><span class="amt">${money(i.lineTotal, totals.currency)}<small class="ngn">${ngn(i.lineTotalNgn)}</small></span></li>`).join('')}
      <li class="sub"><span class="name">Delivery in Nigeria</span><span class="dots"></span><span class="amt">${totals.shipping ? `${money(totals.shipping, totals.currency)}<small class="ngn">${ngn(totals.shippingNgn)}</small>` : 'Free'}</span></li>
    </ul>
    <div class="grand"><span>Total</span><span class="price">${money(totals.total, totals.currency)} <small>${esc(totals.currency)}</small></span></div>
    <p class="fx">About ${ngn(totals.totalNgn)}. PayPal charges in ${esc(totals.currency)}.</p>`;
}

function deliveryLine(d) {
  if (!d?.recipientName) return '';
  return `<p class="ship-to"><span>Deliver to</span><strong>${esc(d.recipientName)}</strong>${esc(d.address)}, ${esc(d.city)}, ${esc(d.state)} · ${esc(localPhone(d.recipientPhone))}${d.isGift ? '<em>Gift</em>' : ''}</p>`;
}

function renderCheckout({ orderId, paypalOrderId, totals, delivery }) {
  const slip = document.createElement('section');
  slip.className = 'receipt';
  slip.setAttribute('aria-label', 'Checkout');
  slip.innerHTML = `${receiptHtml(totals, state.config.store.name, orderId)}
    ${deliveryLine(delivery)}
    <div class="pay"></div>
    <p class="note">Paid securely through PayPal. ${esc(state.config.store.name)} never sees your card details.</p>`;
  thread.append(slip);
  const payBox = $('.pay', slip);

  if (state.config.modes.paypal === 'sandbox') {
    payBox.textContent = 'Loading PayPal…';
    loadPayPal(totals.currency)
      .then((paypal) => {
        payBox.textContent = '';
        return paypal.Buttons({
          style: { layout: 'vertical', shape: 'pill', label: 'pay', height: 45 },
          createOrder: () => paypalOrderId,
          onApprove: () => capture(paypalOrderId, slip),
          onCancel: () => addMsg('bot', 'No wahala — your cart is still here. Tap the button again whenever you are ready.'),
          onError: (err) => {
            console.error(err);
            addMsg('error', 'PayPal could not open. Please try again, or ask Oja to send you an invoice instead.');
          },
        }).render(payBox);
      })
      .catch(() => { payBox.textContent = 'PayPal could not load. Check your connection and refresh.'; });
  } else {
    payBox.innerHTML = `<button class="mock-pay" type="button">Pay with PayPal<small>Test mode — no real money moves</small></button>`;
    $('.mock-pay', payBox).addEventListener('click', (e) => {
      e.currentTarget.disabled = true;
      capture(paypalOrderId, slip);
    });
  }
}

async function capture(paypalOrderId, slip) {
  const typing = showTyping();
  try {
    const out = await api('POST', '/api/paypal/capture', { sessionId: state.sessionId, paypalOrderId });
    typing.remove();
    markPaid(slip);
    addMsg('win', out.reply);
    if (out.family) renderFamily(out.family);
    if (out.cart) updateCart(out.cart);
  } catch (err) {
    typing.remove();
    addMsg('error', err.message);
    const btn = $('.mock-pay', slip);
    if (btn) btn.disabled = false;
  }
}

function markPaid(slip) {
  slip.classList.add('paid');
  const stamp = document.createElement('div');
  stamp.className = 'stamp';
  stamp.textContent = 'PAID';
  slip.append(stamp);
  $('.note', slip).textContent = 'Payment confirmed by PayPal.';
}

function renderInvoice({ orderId, number, payUrl, qrPng, email, totals }) {
  const slip = document.createElement('section');
  slip.className = 'receipt';
  slip.setAttribute('aria-label', 'PayPal invoice');
  slip.innerHTML = `${receiptHtml(totals, 'PayPal invoice', number || orderId)}
    <div class="invoice pay">
      <div class="qr" aria-label="QR code to pay this invoice"></div>
      <div>
        <p>Sent to <strong>${esc(email)}</strong>. Scan to pay on another phone, or open the link.</p>
        ${payUrl ? `<a class="btn" href="${esc(payUrl)}" target="_blank" rel="noopener">Open invoice</a>` : ''}
      </div>
    </div>
    <p class="note">${state.config.modes.paypal === 'sandbox' ? 'Due in 3 days.' : 'Test mode — this invoice is a demo.'} Oja will confirm here once it's paid.</p>`;
  thread.append(slip);

  const qr = $('.qr', slip);
  if (qrPng) qr.innerHTML = `<img alt="" src="data:image/png;base64,${qrPng}">`;
  else qr.remove();

  watchInvoice(orderId, slip);
}

function watchInvoice(orderId, slip) {
  if (state.polling.has(orderId)) return;
  state.polling.add(orderId);
  const timer = setInterval(async () => {
    try {
      const { order } = await api('GET', `/api/order/${orderId}?sessionId=${state.sessionId}`);
      if (order.status === 'PAID') {
        clearInterval(timer);
        markPaid(slip);
        addMsg('win', `Invoice paid! 🎉 Order ${order.id} (${money(order.total, order.currency)}) is confirmed.`);
      }
    } catch { /* keep trying quietly */ }
  }, 15000);
}

const STEPS = [['NOT_STARTED', 'Paid'], ['PACKED', 'Packed'], ['OUT_FOR_DELIVERY', 'On the way'], ['DELIVERED', 'Delivered']];

function renderStatus({ order }) {
  const label = { PAID: ['Paid', 'paid'], AWAITING_PAYMENT: ['Waiting for payment', 'wait'], INVOICE_SENT: ['Invoice sent', 'inv'], REPLACED: ['Replaced', 'mute'], PAYMENT_ISSUE: ['Payment issue', 'bad'] }[order.status] || [order.status, 'mute'];
  const at = STEPS.findIndex(([k]) => k === order.deliveryStatus);
  const track = order.status === 'PAID'
    ? `<ol class="track" aria-label="Delivery progress">${STEPS.map(([, name], i) => `<li class="${i <= at ? 'done' : ''}${i === at ? ' now' : ''}">${name}</li>`).join('')}</ol>`
    : '';
  const el = document.createElement('section');
  el.className = 'status';
  el.innerHTML = `<div class="head"><strong>${esc(order.id)}</strong><span class="pill ${label[1]}">${label[0]}</span></div>
    <div>${order.items.map((i) => `${i.qty} × ${esc(i.name)}`).join('<br>')}</div>
    <div style="margin-top:6px"><span class="price">${money(order.total, order.currency)}</span>${order.totalNgn ? ` <small class="usd">about ${ngn(order.totalNgn)}</small>` : ''}</div>
    ${order.delivery?.recipientName ? `<p class="to">To ${esc(order.delivery.recipientName)}, ${esc(order.delivery.city)}</p>` : ''}
    ${track}`;
  thread.append(el);
}

/** Confirmation card once we know who receives the order in Nigeria. */
function renderDelivery({ delivery: d }) {
  const el = document.createElement('section');
  el.className = 'parcel';
  el.setAttribute('aria-label', 'Delivery details');
  el.innerHTML = `<div class="tag">${d.isGift ? 'Gift delivery' : 'Delivery'} in Nigeria</div>
    <strong>${esc(d.recipientName)}</strong>
    <span>${esc(d.address)}</span>
    <span>${esc(d.city)}, ${esc(d.state)}</span>
    <span>${esc(localPhone(d.recipientPhone))}</span>
    ${d.isGift && (d.senderName || d.language) ? `<span class="from">Message ${d.senderName ? `from ${esc(d.senderName)}` : ''}${d.language && d.language !== 'english' ? ` in ${esc(d.language[0].toUpperCase() + d.language.slice(1))}` : ''}</span>` : ''}`;
  thread.append(el);
}

/** After a gift is paid: the WhatsApp message the buyer forwards to family back home. */
function renderFamily(f) {
  const el = document.createElement('section');
  el.className = 'family';
  el.setAttribute('aria-label', `WhatsApp message for ${f.recipientName}`);
  el.innerHTML = `<div class="wa-head">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.9-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>
      <span>For ${esc(f.recipientName)} · ${esc(f.recipientPhone)}</span>
    </div>
    <p class="bubble-wa"></p>
    <div class="row">
      <a class="btn wa" href="${esc(f.waUrl)}" target="_blank" rel="noopener">Send on WhatsApp</a>
      <button class="btn ghost copy" type="button">Copy message</button>
    </div>`;
  $('.bubble-wa', el).textContent = f.text;
  $('.copy', el).addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(f.text);
      e.currentTarget.textContent = 'Copied';
    } catch {
      e.currentTarget.textContent = 'Copy not allowed here';
    }
  });
  thread.append(el);
}

function updateCart(cart, bump = true) {
  if (!cart) return;
  $('#cart-count').textContent = cart.itemCount;
  $('#cart-total').textContent = ngn(cart.totalNgn || 0);
  $('#cart-chip').setAttribute('aria-label', `Cart: ${cart.itemCount} items, ${ngn(cart.totalNgn || 0)}`);
  if (bump) {
    const chip = $('#cart-chip');
    chip.classList.remove('bump');
    void chip.offsetWidth;
    chip.classList.add('bump');
  }
}

/* ---------------- PayPal JS SDK ---------------- */

/** The PayPal SDK is tied to one currency, so reload it when the buyer pays in another. */
function loadPayPal(currency) {
  if (state.paypal.promise && state.paypal.currency === currency) return state.paypal.promise;
  document.getElementById('paypal-sdk')?.remove();
  delete window.paypal;
  state.paypal.currency = currency;
  state.paypal.promise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.id = 'paypal-sdk';
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(state.config.paypalClientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`;
    s.onload = () => resolve(window.paypal);
    s.onerror = () => { state.paypal.promise = null; reject(new Error('PayPal SDK failed to load')); };
    document.head.append(s);
  });
  return state.paypal.promise;
}

/* ---------------- utils ---------------- */

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Network problem. Check your connection and try again.');
  return data;
}

function scrollDown() {
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
}

boot().catch((err) => addMsg('error', `Could not start the chat: ${err.message}`));
