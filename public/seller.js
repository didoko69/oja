// Oja seller dashboard.

const $ = (s) => document.querySelector(s);
const SYMBOL = { USD: '$', GBP: '£', EUR: '€', CAD: 'CA$' };
const money = (n, cur) => `${SYMBOL[cur] || ''}${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const ngn = (n) => `₦${Math.round(n || 0).toLocaleString('en-US')}`;
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

async function api(method, url, body) {
  const headers = { ...(key ? { 'x-seller-key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) {
    key = prompt('Enter your seller key');
    try { localStorage.setItem('oja.sellerKey', key || ''); } catch { /* ignore */ }
    return api(method, url, body);
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

  // Buyers pay in several currencies, so the headline is naira with a per-currency split.
  $('#revenue').textContent = ngn(stats.revenueNgn);
  const split = Object.entries(stats.revenueByCurrency || {}).map(([c, v]) => money(v, c));
  $('#revenue-split').textContent = split.length ? `Received as ${split.join(' + ')}` : 'No sales yet';
  $('#k-orders').textContent = stats.paidOrders;
  $('#k-gifts').textContent = stats.giftOrders;
  $('#k-conv').textContent = `${stats.conversionRate}%`;
  $('#k-deliver').textContent = stats.deliveriesPending;

  showOrders(orders);

  bars('#unmet', '#unmet-empty', stats.unmetDemand);
  bars('#searches', '#searches-empty', stats.topSearches);
  bars('#cities', '#cities-empty', stats.deliveryCities);
  bars('#sources', '#sources-empty', stats.sources.filter((r) => r.term !== 'direct' || stats.sources.length > 1));

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

/* ---------------- Orders & deliveries (AG Grid) ---------------- */

const STEP_LABEL = { NOT_STARTED: 'To pack', PACKED: 'Packed', OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered' };
let grid = null;

/** "+2348031234567" -> "0803 123 4567" */
const localPhone = (p) => {
  const d = String(p || '').replace(/\D/g, '').replace(/^234/, '');
  return d.length === 10 ? `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(p || '');
};

function twoLine(top, bottom) {
  return `<div class="cell-two"><span>${top}</span>${bottom ? `<small>${bottom}</small>` : ''}</div>`;
}

const columnDefs = [
  {
    headerName: 'Order', field: 'id', minWidth: 140, maxWidth: 170,
    cellRenderer: (p) => twoLine(esc(p.value), ago(p.data.createdAt)),
  },
  {
    headerName: 'Items', minWidth: 200, flex: 2, autoHeight: true, wrapText: true, cellClass: 'wrap-cell',
    valueGetter: (p) => p.data.items.map((i) => `${i.qty} × ${i.name}`).join(', '),
  },
  {
    headerName: 'Deliver to', minWidth: 200, flex: 1.4,
    valueGetter: (p) => (p.data.delivery?.recipientName ? `${p.data.delivery.recipientName}, ${p.data.delivery.city}` : ''),
    cellRenderer: (p) => {
      const d = p.data.delivery;
      if (!d?.recipientName) return twoLine('<span style="color:var(--ink-2)">Buyer\'s own address</span>', '');
      return twoLine(`${esc(d.recipientName)}${d.isGift ? '<span class="gift-tag">Gift</span>' : ''}`, `${esc(d.city)}, ${esc(d.state)} · ${esc(localPhone(d.recipientPhone))}`);
    },
  },
  {
    headerName: 'Paid', minWidth: 105, maxWidth: 130, type: 'rightAligned', comparator: (a, b) => a - b,
    valueGetter: (p) => p.data.totalNgn || 0,
    cellRenderer: (p) => twoLine(`<strong>${money(p.data.total, p.data.currency)}</strong>`, ngn(p.data.totalNgn)),
  },
  {
    headerName: 'Payment', field: 'status', minWidth: 120, maxWidth: 140, filter: true,
    cellRenderer: (p) => {
      const [label, cls] = STATUS[p.value] || [p.value, 'mute'];
      return `<span class="pill ${cls}">${label}</span>`;
    },
  },
  {
    // A plain dropdown in the cell: one tap to change, works with keyboard and screen readers.
    headerName: 'Delivery', field: 'deliveryStatus', minWidth: 170, maxWidth: 200, filter: true,
    valueFormatter: (p) => STEP_LABEL[p.value] || p.value,
    cellRenderer: (p) => {
      if (p.data.status !== 'PAID') return '<span class="step locked">After payment</span>';
      const sel = document.createElement('select');
      sel.className = `step-select ${p.value}`;
      sel.setAttribute('aria-label', `Delivery step for ${p.data.id}`);
      sel.innerHTML = Object.entries(STEP_LABEL).map(([k, v]) => `<option value="${k}" ${k === p.value ? 'selected' : ''}>${v}</option>`).join('');
      sel.addEventListener('change', async () => {
        sel.disabled = true;
        try {
          const updated = await api('POST', `/api/seller/orders/${p.data.id}/delivery`, { status: sel.value });
          p.node.setData(updated);
          load().catch(() => {});
        } catch (err) {
          sel.value = p.value;
          alert(err.message);
        } finally {
          sel.disabled = false;
        }
      });
      return sel;
    },
  },
  { headerName: 'Came from', field: 'source', minWidth: 110, maxWidth: 140, filter: true },
];

function showOrders(orders) {
  const el = $('#orders-grid');
  if (!window.agGrid) {
    el.textContent = 'The orders table could not load. Refresh the page.';
    return;
  }
  if (!grid) {
    grid = window.agGrid.createGrid(el, {
      columnDefs,
      rowData: orders,
      getRowId: (p) => p.data.id,
      defaultColDef: { sortable: true, resizable: true, flex: 1 },
      rowHeight: 60,
      animateRows: true,
      domLayout: 'autoHeight',
      overlayNoRowsTemplate: '<span style="color:var(--ink-2)">No orders yet. Share your chat link and they\'ll appear here.</span>',
    });
    return;
  }
  // Don't swap rows while the seller has a delivery dropdown open.
  if (document.activeElement?.classList.contains('step-select')) return;
  grid.setGridOption('rowData', orders);
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
