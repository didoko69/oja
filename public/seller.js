// Oja seller dashboard.

const $ = (s) => document.querySelector(s);
const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(t).toLocaleDateString();
};

const STATUS = {
  PAID: ['Paid', 'paid'],
  AWAITING_PAYMENT: ['Waiting', 'wait'],
  INVOICE_SENT: ['Invoice sent', 'inv'],
  PAYMENT_ISSUE: ['Payment issue', 'bad'],
};

let key = null;
try { key = localStorage.getItem('oja.sellerKey'); } catch { /* ignore */ }
let selected = null;

async function api(method, url) {
  const res = await fetch(url, { method, headers: key ? { 'x-seller-key': key } : {} });
  if (res.status === 401) {
    key = prompt('Enter your seller key');
    try { localStorage.setItem('oja.sellerKey', key || ''); } catch { /* ignore */ }
    return api(method, url);
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function load() {
  const [stats, orders, convos, config] = await Promise.all([
    api('GET', '/api/seller/stats'),
    api('GET', '/api/seller/orders'),
    api('GET', '/api/seller/conversations'),
    api('GET', '/api/config'),
  ]);
  $('#store-line').textContent = `${config.store.name}: your AI salesperson's results`;

  $('#revenue').textContent = usd(stats.revenue);
  $('#k-orders').textContent = stats.paidOrders;
  $('#k-conv').textContent = `${stats.conversionRate}%`;
  $('#k-aov').textContent = usd(stats.averageOrder);
  $('#k-wait').textContent = stats.awaitingPayment + stats.invoicesOpen;

  $('#orders').innerHTML = orders.map((o) => {
    const [label, cls] = STATUS[o.status] || [o.status, 'mute'];
    return `<tr>
      <td>${esc(o.id)}<br><small style="color:var(--ink-2)">${ago(o.createdAt)}</small></td>
      <td>${o.items.map((i) => `${i.qty} × ${esc(i.name)}`).join('<br>')}</td>
      <td>${o.method === 'invoice' ? `Invoice${o.buyerEmail ? `<br><small>${esc(o.buyerEmail)}</small>` : ''}` : esc(o.payer?.name || 'PayPal checkout')}</td>
      <td><span class="pill ${cls}">${label}</span></td>
      <td class="num price">${usd(o.total)}</td>
    </tr>`;
  }).join('');
  $('#orders-empty').hidden = orders.length > 0;

  bars('#unmet', '#unmet-empty', stats.unmetDemand);
  bars('#searches', '#searches-empty', stats.topSearches);

  $('#convo-list').innerHTML = convos.map((c) => {
    const first = c.messages.find((m) => m.role === 'user')?.text || 'New chat';
    const paid = c.orders.some((o) => o.status === 'PAID');
    return `<button type="button" data-id="${esc(c.id)}" ${c.id === selected ? 'aria-current="true"' : ''}>
      <span class="first">${esc(first)}</span>
      <span class="when">${ago(c.createdAt)}${paid ? ' · <span class="pill paid">Bought</span>' : ''}</span>
    </button>`;
  }).join('') || '<p class="empty" style="padding:0 20px">No chats yet.</p>';

  document.querySelectorAll('#convo-list button').forEach((b) => b.addEventListener('click', () => {
    selected = b.dataset.id;
    document.querySelectorAll('#convo-list button').forEach((x) => x.removeAttribute('aria-current'));
    b.setAttribute('aria-current', 'true');
    showTranscript(convos.find((c) => c.id === selected));
  }));
  if (selected) showTranscript(convos.find((c) => c.id === selected));
}

function bars(listSel, emptySel, rows) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  $(listSel).innerHTML = rows.map((r) => `<li><span>${esc(r.term)} <small style="color:var(--ink-2)">(${r.count})</small></span>
    <span class="bar"><span style="width:${Math.max(6, (r.count / max) * 100)}%"></span></span></li>`).join('');
  $(emptySel).hidden = rows.length > 0;
}

function showTranscript(c) {
  if (!c) return;
  $('#transcript').innerHTML = c.messages.map((m) => `<div class="bubble ${m.role}">${esc(m.text)}</div>`).join('');
}

async function insight() {
  const btn = $('#refresh-insight');
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  try {
    const r = await api('POST', '/api/seller/insight');
    $('#insights').innerHTML = r.insights.map((i) => `<li>${esc(i)}</li>`).join('');
    $('#insight-src').textContent = r.source === 'gemini' ? 'Written by Gemini from your store data.' : 'Based on your store data. Add a Gemini key for AI-written insights.';
  } catch (err) {
    $('#insights').innerHTML = `<li>${esc(err.message)}</li>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh';
  }
}

$('#refresh-insight').addEventListener('click', insight);
$('#reset').addEventListener('click', async () => {
  if (!confirm('Delete all demo chats, orders and stats?')) return;
  await api('POST', '/api/seller/reset');
  selected = null;
  $('#transcript').innerHTML = '<p class="empty">Pick a chat to read it.</p>';
  await load();
  await insight();
});

load().then(insight).catch((err) => alert(err.message));
setInterval(() => load().catch(() => {}), 10000);
