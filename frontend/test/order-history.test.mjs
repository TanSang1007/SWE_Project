import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url); const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const api = require('../src/lib/api/order-history.ts'); const { useAuthStore } = require('../src/lib/auth-store.ts');
const { orderStatusLabels, formatOrderTime } = require('../src/lib/order-display.ts'); const { recoveryOrderId } = require('../src/lib/order-context.ts');
const { OrderReadContent, OrderHistoryList, OrderDetailContent, OrderHistoryView } = require('../src/components/order-history-view.tsx');
const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
const originalFetch = globalThis.fetch; const originalBase = process.env.NEXT_PUBLIC_API_BASE_URL;
const id = randomUUID(); const summary = { id, orderCode: 'BL-history', status: 'PAID', total: '95000', currency: 'VND', createdAt: '2026-10-07T00:00:00Z', earnedPoints: 9 };
const detail = { ...summary, subtotal: '105000', discountAmount: '10000', promotionCode: 'ORIGINAL', paidAt: '2026-10-07T00:01:00Z', paymentStatus: 'SUCCEEDED',
  items: [{ productId: id, productName: 'Original drink', size: 'M', qty: 1, unitPrice: '105000', lineTotal: '105000', toppings: [{ name: 'Cream', price: '5000' }] }] };
const login = (token = 'owner') => useAuthStore.getState().signIn({ accessToken: token, expiresIn: 3600, user: { id: token, email: 'fixture@example.invalid', loyaltyPoints: 500, role: 'CUSTOMER' } });
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
beforeEach(() => { process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid'; });
afterEach(() => { globalThis.fetch = originalFetch; useAuthStore.getState().clear(); if (originalBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL; else process.env.NEXT_PUBLIC_API_BASE_URL = originalBase; });
test('history parser whitelists exact summary fields and preserves server order/nullable points', () => {
  assert.deepEqual(api.parseOrderHistory({ items: [{ ...summary, userId: 'private', paymentStatus: 'SUCCEEDED' }, { ...summary, id: randomUUID(), status: 'PENDING', earnedPoints: null }] })[0], summary);
  assert.deepEqual(api.parseOrderHistory({ items: [] }), []);
});
test('rejects malformed money/date/status/points and duplicate Orders instead of displaying stale/duplicate data', () => {
  for (const change of [{ total: 95000 }, { total: '1.5' }, { createdAt: 'bad' }, { status: 'CONFIRMED' }, { earnedPoints: -1 }, { earnedPoints: 1.5 }, { earnedPoints: 2147483648 }]) assert.throws(() => api.parseOrderHistory({ items: [{ ...summary, ...change }] }));
  assert.throws(() => api.parseOrderHistory({ items: [summary, summary] }));
});
test('detail parser reuses snapshot parser and preserves only paidAt/points/paymentStatus metadata', () => {
  assert.deepEqual(api.parseOrderDetail({ ...detail, passwordHash: 'private', payments: ['private'] }), detail);
  for (const change of [{ paidAt: 'bad' }, { paymentStatus: 'PAID' }, { earnedPoints: undefined }]) assert.throws(() => api.parseOrderDetail({ ...detail, ...change }));
});
test('fresh history/detail GETs carry only JWT/no-store and never create Order or Payment', async () => {
  login(); const calls = []; globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json(url.endsWith('/me') ? { items: [summary] } : detail); };
  assert.deepEqual(await api.getOrderHistory(), [summary]); assert.deepEqual(await api.getOrderDetail(id), detail); await api.getOrderHistory();
  assert.equal(calls.length, 3); for (const { url, options } of calls) {
    assert(url === `http://example.invalid/orders/${id}` || url === 'http://example.invalid/orders/me');
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { Authorization: 'Bearer owner' }); assert.equal(options.body, undefined);
  }
});
test('guest/expired auth and invalid detail ID do not fetch; login return path preserves Order ID', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({ items: [] }); };
  await assert.rejects(api.getOrderHistory(), { code: 'UNAUTHORIZED' }); login(); useAuthStore.setState({ expiresAt: Date.now() - 1 });
  await assert.rejects(api.getOrderHistory(), { code: 'UNAUTHORIZED' }); await assert.rejects(api.getOrderDetail('invalid'), { code: 'ORDER_NOT_FOUND' }); assert.equal(calls, 0);
  assert(render(OrderHistoryView, { id }).includes(encodeURIComponent(`/orders/${id}/confirmation`)));
});
test('401 clears current session; old401/200 after account switch do not clear/reveal new account', async () => {
  login(); globalThis.fetch = async () => new Response('raw', { status: 401 }); await assert.rejects(api.getOrderHistory(), { code: 'UNAUTHORIZED' }); assert.equal(useAuthStore.getState().accessToken, null);
  for (const status of [200, 401]) {
    login(); let resolve; globalThis.fetch = () => new Promise(done => { resolve = done; }); const pending = api.getOrderHistory(); login('other');
    resolve(Response.json({ items: [summary] }, { status })); await assert.rejects(pending, { code: 'UNAUTHORIZED' }); assert.equal(useAuthStore.getState().accessToken, 'other');
  }
});
test('read errors remain generic, cross-owner404 is not found, mismatch ID rejected and Retry reads new data', async () => {
  login(); globalThis.fetch = async () => new Response('SELECT password_hash', { status: 503 }); await assert.rejects(api.getOrderHistory(), { code: 'UNAVAILABLE' });
  globalThis.fetch = async () => new Response('private owner', { status: 404 }); await assert.rejects(api.getOrderDetail(id), { code: 'ORDER_NOT_FOUND' });
  globalThis.fetch = async () => Response.json({ ...detail, id: randomUUID() }); await assert.rejects(api.getOrderDetail(id), { code: 'UNAVAILABLE' });
  globalThis.fetch = async () => Response.json({ items: [{ ...summary, status: 'COMPLETED' }] }); assert.equal((await api.getOrderHistory())[0].status, 'COMPLETED');
});
test('list renders all seven Vietnamese statuses, times/VND/points and owned detail navigation', () => {
  const rows = Object.keys(orderStatusLabels).map(status => ({ ...summary, id: randomUUID(), status })); const html = render(OrderHistoryList, { items: rows });
  for (const label of Object.values(orderStatusLabels)) assert(html.includes(label)); assert.equal((html.match(/data-history-order=/g) ?? []).length, 7);
  for (const row of rows) assert(html.includes(`/orders/${row.id}/confirmation`)); assert(html.includes('95.000')); assert(html.includes('<time')); assert(formatOrderTime(summary.createdAt).includes('2026'));
});
test('empty/loading/error/Retry states announce and use native controls without mutation actions', () => {
  const renderState = state => render(OrderReadContent, { state, retry() {} });
  assert.match(renderState({ status: 'history', items: [] }), /Bạn chưa có đơn hàng/);
  const loading = renderState({ status: 'loading' }); assert.match(loading, /aria-busy="true"/); assert.match(loading, /role="status"/); assert.match(loading, /disabled/);
  assert.match(renderState({ status: 'error', notFound: false }), /<button type="button"[^>]*>Thử lại<\/button>/);
  assert.match(renderState({ status: 'error', notFound: true }), /Không tìm thấy đơn hàng/);
});
test('detail renders historical options/discount/final money/metadata and never presents Payment action', () => {
  const html = render(OrderDetailContent, { order: detail });
  for (const value of ['Original drink', 'Cream', 'Size M', '105.000', '10.000', '95.000', 'ORIGINAL', 'Đã thanh toán', '9 điểm', 'Thành công']) assert(html.includes(value));
  assert(!html.includes('data-checkout-action')); assert(!html.includes('Tiếp tục tại giỏ hàng'));
  assert.match(render(OrderDetailContent, { order: { ...detail, total: '999999999999' } }), /999\.999\.999\.999/);
});
test('unpaid details link to known-ID checkout; cancellation does not claim refund or permit payment', () => {
  assert(render(OrderDetailContent, { order: { ...detail, status: 'PAYMENT_FAILED', paidAt: null, earnedPoints: null, paymentStatus: 'FAILED' } }).includes(`/checkout?orderId=${id}`));
  const cancelled = render(OrderDetailContent, { order: { ...detail, status: 'CANCELLED', earnedPoints: 0 } }); assert(cancelled.includes('không xác nhận việc hoàn tiền')); assert(!cancelled.includes('Tiếp tục tại giỏ hàng'));
});
test('known-ID resume never replaces an uncertain original create/payment transport context', () => {
  const saved = { userId: 'owner', key: 'old-create', payload: { items: [] } };
  assert.equal(recoveryOrderId(saved, null, id), undefined);
  assert.equal(recoveryOrderId({ ...saved, orderId: 'saved' }, null, id), 'saved');
  assert.equal(recoveryOrderId(saved, { payload: { orderId: 'paid-context' } }, id), 'paid-context');
  assert.equal(recoveryOrderId(null, null, id), id);
});
