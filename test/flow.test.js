// End-to-end test of the buyer and seller flows in offline mode (no API keys needed).
// Run: npm test

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oja-test-'));

const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), OJA_DATA_DIR: dataDir, GEMINI_API_KEY: '', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '', SELLER_KEY: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;

async function call(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + '/api/config'); break; } catch { await sleep(100); }
  }

  const { data: { sessionId } } = await call('POST', '/api/session');
  const chat = async (message) => { await sleep(750); return (await call('POST', '/api/chat', { sessionId, message })).data; };
  let out;

  await test('search respects a naira budget and category', async () => {
    out = await chat('I need a phone under 150k with a good camera');
    const cards = out.ui.find((u) => u.type === 'products').products;
    assert.ok(cards.length >= 2);
    assert.ok(cards.every((p) => p.category === 'phones' && p.priceNgn <= 150000));
    assert.match(out.reply, /₦\d/);
  });

  await test('search respects a dollar budget', async () => {
    out = await chat('phone under $105');
    const cards = out.ui.find((u) => u.type === 'products').products;
    assert.ok(cards.every((p) => p.price <= 105));
  });

  let shown;
  await test('use-case search', async () => {
    out = await chat('I need a phone for content creation');
    shown = out.ui.find((u) => u.type === 'products').products;
    assert.equal(shown[0].id, 'ph-spark40');
  });

  await test('comparison card', async () => {
    out = await chat('compare them');
    assert.ok(out.ui.some((u) => u.type === 'comparison'));
  });

  await test('"the cheaper one and a power bank" fills the cart', async () => {
    out = await chat('add the cheaper one and a power bank');
    assert.equal(out.cart.items.length, 2);
    const cheapest = shown.filter((p) => p.inStock).slice(0, 3).sort((a, b) => a.price - b.price)[0];
    assert.ok(out.cart.items.some((i) => i.productId === cheapest.id), 'cheapest phone added');
    assert.ok(out.cart.totalNgn > 0, 'naira total present');
    assert.ok(out.cart.items.some((i) => i.productId.startsWith('pw-')), 'power bank added');
  });

  let checkout;
  await test('checkout creates a PayPal order with server-side totals', async () => {
    out = await chat('checkout');
    checkout = out.ui.find((u) => u.type === 'checkout');
    assert.ok(checkout?.paypalOrderId);
    const expected = out.cart.items.reduce((s, i) => s + i.lineTotal, 0) + out.cart.shipping;
    assert.equal(checkout.totals.total, expected);
  });

  await test('capture marks the order paid and empties the cart', async () => {
    const { status, data } = await call('POST', '/api/paypal/capture', { sessionId, paypalOrderId: checkout.paypalOrderId });
    assert.equal(status, 200);
    assert.equal(data.status, 'PAID');
    assert.equal(data.cart.items.length, 0);
  });

  await test('capturing twice is safe', async () => {
    const { data } = await call('POST', '/api/paypal/capture', { sessionId, paypalOrderId: checkout.paypalOrderId });
    assert.equal(data.status, 'PAID');
  });

  await test('another chat cannot capture this order', async () => {
    const { data: other } = await call('POST', '/api/session');
    const { status } = await call('POST', '/api/paypal/capture', { sessionId: other.sessionId, paypalOrderId: checkout.paypalOrderId });
    assert.equal(status, 404);
  });

  await test('order status question', async () => {
    out = await chat('has my payment gone through?');
    assert.equal(out.ui.find((u) => u.type === 'order_status').order.status, 'PAID');
  });

  await test('invoice flow asks for email, then sends invoice with QR', async () => {
    await chat('I want a ring light');
    await chat('yes');
    out = await chat('send me an invoice');
    assert.match(out.reply, /email/i);
    out = await chat('daniel@example.com');
    const inv = out.ui.find((u) => u.type === 'invoice');
    assert.ok(inv?.invoiceId);
    assert.ok(inv.qrPng, 'QR code present');
  });

  await test('out of stock item offers an alternative', async () => {
    out = await chat('do you have iphone 15 pro max?');
    assert.match(out.reply, /out of stock/i);
    assert.equal(out.ui[0].products.length, 2);
  });

  await test('seller stats and insights', async () => {
    const { data: stats } = await call('GET', '/api/seller/stats');
    assert.equal(stats.paidOrders, 1);
    assert.ok(stats.revenueNgn > 0);
    assert.ok(stats.unmetDemand.some((u) => /iphone/i.test(u.term)));
    const { data: ins } = await call('POST', '/api/seller/insight');
    assert.ok(ins.insights.length >= 1);
  });

  /* ---------- Buy for family back home ---------- */

  const { data: gift } = await call('POST', '/api/session', { locale: 'en-GB', source: 'whatsapp' });
  const g = async (message) => { await sleep(750); return (await call('POST', '/api/chat', { sessionId: gift.sessionId, message })).data; };

  await test('UK browser gets pounds by default', async () => {
    assert.equal(gift.currency, 'GBP');
  });

  await test('gift request: searches within a pound budget and remembers the city', async () => {
    out = await g("I'm in London and I want a phone for my mum in Lokoja, about £120");
    const cards = out.ui.find((u) => u.type === 'products').products;
    assert.ok(cards.length >= 1);
    assert.ok(cards.every((p) => p.category === 'phones' && p.currency === 'GBP' && p.price <= 132));
    assert.match(out.reply, /mum/);
  });

  await test('adding an item asks for the missing delivery details', async () => {
    out = await g('add the first one');
    assert.equal(out.cart.currency, 'GBP');
    assert.match(out.reply, /full name, phone number and street address/);
  });

  await test('checkout is blocked until the address is complete', async () => {
    out = await g('checkout');
    assert.ok(!out.ui.some((u) => u.type === 'checkout'));
    assert.match(out.reply, /need their/);
  });

  await test('one-line Nigerian address is understood', async () => {
    out = await g('Grace Idoko, 0803 123 4567, 12 Ganaja Road');
    const d = out.ui.find((u) => u.type === 'delivery').delivery;
    assert.deepEqual([d.recipientName, d.recipientPhone, d.address, d.city, d.state], ['Grace Idoko', '+2348031234567', '12 Ganaja Road', 'Lokoja', 'Kogi']);
  });

  await test('message language and sender name', async () => {
    await g('in pidgin');
    out = await g('my name is Tunde');
    assert.match(out.reply, /Tunde/);
  });

  let giftCheckout;
  await test('gift checkout is in pounds and ships to the recipient', async () => {
    out = await g('checkout');
    giftCheckout = out.ui.find((u) => u.type === 'checkout');
    assert.equal(giftCheckout.totals.currency, 'GBP');
    assert.equal(giftCheckout.delivery.city, 'Lokoja');
    assert.match(out.reply, /£\d/);
  });

  await test('payment produces a WhatsApp message for the family', async () => {
    const { data } = await call('POST', '/api/paypal/capture', { sessionId: gift.sessionId, paypalOrderId: giftCheckout.paypalOrderId });
    assert.equal(data.status, 'PAID');
    assert.match(data.family.text, /Grace/);
    assert.match(data.family.text, /Tunde/);
    assert.match(data.family.text, /don/); // Pidgin template
    assert.ok(data.family.waUrl.startsWith('https://wa.me/2348031234567?text='));
  });

  await test('seller moves the delivery along and the buyer can track it', async () => {
    const { status } = await call('POST', `/api/seller/orders/${giftCheckout.orderId}/delivery`, { status: 'OUT_FOR_DELIVERY' });
    assert.equal(status, 200);
    out = await g('has my mum received it?');
    assert.match(out.reply, /out for delivery/i);
  });

  await test('unpaid orders cannot be dispatched', async () => {
    const { data: orders } = await call('GET', '/api/seller/orders');
    const unpaid = orders.find((o) => o.status !== 'PAID');
    if (unpaid) {
      const { status } = await call('POST', `/api/seller/orders/${unpaid.id}/delivery`, { status: 'PACKED' });
      assert.equal(status, 409);
    }
  });

  await test('seller stats count gifts, currencies and sources', async () => {
    const { data: stats } = await call('GET', '/api/seller/stats');
    assert.equal(stats.giftOrders, 1);
    assert.ok(stats.revenueByCurrency.GBP > 0);
    assert.ok(stats.sources.some((x) => x.term === 'whatsapp'));
    assert.ok(stats.deliveryCities.some((x) => x.term === 'Lokoja'));
  });

  console.log(`\n${passed} tests passed`);
} catch (err) {
  console.error('\n✗ Test failed:', err.message);
  process.exitCode = 1;
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
