import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url); const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
const { parseOperatorList, parseOperatorDetail, getOperatorOrders, getOperatorOrder } = require('../src/lib/api/operator-orders.ts');
const { OperatorReadContent, OperatorOrdersView } = require('../src/components/operator-orders-view.tsx');
const { OperatorShellContent } = require('../src/components/operator-shell.tsx');
const { useAuthStore, getAccessToken } = require('../src/lib/auth-store.ts');
const { orderStatusLabels } = require('../src/lib/order-display.ts');
const originalFetch = globalThis.fetch;
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
const id = randomUUID(); const actor = randomUUID();
const session = (role = 'STAFF', owner = actor) => ({ accessToken: `fixture-${owner}-${role}`, tokenType: 'Bearer', expiresIn: 3600, user: { id: owner, email: 'fixture@example.invalid', loyaltyPoints: 0, role } });
const summary = { id, orderCode: 'BL-fixture', status: 'PAID', total: '95000', currency: 'VND', createdAt: '2026-10-07T00:00:00Z', earnedPoints: 9, version: 7, updatedAt: '2026-10-08T00:00:00Z' };
const detail = { ...summary, subtotal: '105000', discountAmount: '10000', promotionCode: 'SNAPSHOT', paidAt: '2026-10-07T00:01:00Z', paymentStatus: 'SUCCEEDED',
  items: [{ productId: id, productName: 'Historical drink', size: 'M', qty: 1, unitPrice: '105000', lineTotal: '105000', toppings: [{ name: 'Cream', price: '5000' }] }] };
const html = (state) => renderToStaticMarkup(React.createElement(OperatorReadContent, { state, retry: () => {} }));
afterEach(() => { useAuthStore.getState().clear(); globalThis.fetch = originalFetch; });
test('operator parsers keep exact DTO/revisions and strip all private extras', () => {
  assert.deepEqual(parseOperatorList({ items: [{ ...summary, userId: actor, email: 'private', idempotencyKey: 'private' }] }), [summary]);
  assert.deepEqual(parseOperatorDetail({ ...detail, userId: actor, passwordHash: 'private', payments: [] }), detail);
  assert.deepEqual(parseOperatorList({ items: [] }), []);
});
test('parsers reject missing/invalid version or update timestamp and duplicate IDs', () => {
  for (const version of [undefined, null, -1, 1.5, '7', 2147483648]) {
    assert.throws(() => parseOperatorList({ items: [{ ...summary, version }] })); assert.throws(() => parseOperatorDetail({ ...detail, version }));
  }
  for (const updatedAt of [undefined, null, 'invalid']) assert.throws(() => parseOperatorDetail({ ...detail, updatedAt }));
  assert.throws(() => parseOperatorList({ items: [summary, summary] }));
});
test('loading/empty/error/Retry/forbidden/expired/not-found are semantic and clear private content', () => {
  assert.match(html({ status: 'loading' }), /aria-busy="true"/); assert.match(html({ status: 'loading' }), /disabled/);
  assert.match(html({ status: 'list', items: [] }), /Không có đơn hàng/);
  for (const [code, label] of [['UNAVAILABLE', 'Chưa tải được'], ['FORBIDDEN', 'Không có quyền'], ['UNAUTHORIZED', 'Phiên đăng nhập đã hết hạn'], ['ORDER_NOT_FOUND', 'Không tìm thấy']]) {
    const value = html({ status: 'error', code }); assert(value.includes(label)); assert(value.includes('role="alert"')); assert(!value.includes('BL-fixture'));
  }
  assert.match(html({ status: 'error', code: 'UNAVAILABLE' }), /Thử lại/); assert(!html({ status: 'error', code: 'FORBIDDEN' }).includes('data-operator-retry'));
});
test('all seven real statuses use Vietnamese labels and operator detail links', () => {
  for (const [status, label] of Object.entries(orderStatusLabels)) {
    const value = html({ status: 'list', items: [{ ...summary, status }] }); assert(value.includes(label)); assert(value.includes(`/operator/orders/${id}`)); assert(value.includes('95.000'));
  }
});
test('snapshot renders options/qty/unit/line/discount/payment/revision; only read controls', () => {
  const value = html({ status: 'detail', order: detail });
  for (const text of ['Historical drink', 'Cream', 'Size M', '105.000', '10.000', '95.000', 'SNAPSHOT', 'Thành công', 'Phiên bản hiện tại']) assert(value.includes(text));
  assert(!value.includes('/cart')); assert(!value.includes('Hủy đơn')); assert(!value.includes('/payments'));
  assert.equal((value.match(/<button/g) ?? []).length, 1);
});
test('VND upper boundary and zero values remain exact, paid cancellation has no refund claim', () => {
  assert(html({ status: 'list', items: [{ ...summary, total: '999999999999' }] }).includes('999.999.999.999'));
  assert(html({ status: 'detail', order: { ...detail, total: '0', status: 'CANCELLED', earnedPoints: 0 } }).includes('không xác nhận việc hoàn tiền'));
});
test('STAFF/ADMIN shell access, CUSTOMER/guest/loading suppress operator data', () => {
  for (const role of ['STAFF', 'ADMIN', 'CUSTOMER', undefined]) {
    const value = renderToStaticMarkup(React.createElement(OperatorShellContent, { ready: true, role, authenticated: !!role, allowed: ['STAFF', 'ADMIN'], pathname: '/operator/orders' }, React.createElement('p', null, 'PRIVATE_ORDER')));
    assert.equal(value.includes('PRIVATE_ORDER'), ['STAFF', 'ADMIN'].includes(role));
  }
  useAuthStore.getState().signIn(session('CUSTOMER'));
  assert.equal(renderToStaticMarkup(React.createElement(OperatorOrdersView)), '');
});
test('list and detail GET use approved namespace/status/no-store; no mutation or Cart requests', async () => {
  useAuthStore.getState().signIn(session()); const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return Response.json(url.includes('?') ? { items: [summary] } : detail); };
  assert.deepEqual(await getOperatorOrders('PAID'), [summary]); assert.deepEqual(await getOperatorOrder(id), detail);
  assert(calls[0].url.endsWith('/operator/orders?status=PAID')); assert(calls[1].url.endsWith('/operator/orders/' + id));
  for (const { init } of calls) { assert.equal(init.method, 'GET'); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'omit'); assert.equal(init.body, undefined); }
});
test('invalid detail/filter do not perform fetch; mismatched response ID rejected', async () => {
  useAuthStore.getState().signIn(session()); let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ ...detail, id: randomUUID() }); };
  await assert.rejects(getOperatorOrder('invalid'), { code: 'ORDER_NOT_FOUND' }); await assert.rejects(getOperatorOrders('UNKNOWN'), { code: 'VALIDATION_ERROR' }); assert.equal(calls, 0);
  await assert.rejects(getOperatorOrder(id), { code: 'UNAVAILABLE' });
});
test('403 rejects protected data; 401 clears session; network/503 offer retry errors', async () => {
  for (const [status, code] of [[403, 'FORBIDDEN'], [401, 'UNAUTHORIZED'], [503, 'UNAVAILABLE'], [404, 'ORDER_NOT_FOUND']]) {
    useAuthStore.getState().signIn(session()); globalThis.fetch = async () => new Response('', { status });
    await assert.rejects(getOperatorOrders(), { code }); assert.equal(!!useAuthStore.getState().accessToken, status !== 401);
  }
  globalThis.fetch = async () => { throw new Error('network'); }; await assert.rejects(getOperatorOrders(), { code: 'UNAVAILABLE' });
});
test('logout/account switch/role change discard late reads and old401 cannot clear new session', async () => {
  for (const status of [200, 401]) {
    useAuthStore.getState().signIn(session()); let resolve;
    globalThis.fetch = async () => new Promise((r) => { resolve = r; }); const read = getOperatorOrders();
    useAuthStore.getState().clear(); useAuthStore.getState().signIn(session('CUSTOMER', randomUUID()));
    resolve(status === 200 ? Response.json({ items: [summary] }) : new Response('', { status }));
    await assert.rejects(read, { code: 'UNAUTHORIZED' }); assert.equal(useAuthStore.getState().user.role, 'CUSTOMER');
  }
});
test('JSON arriving after account switch cannot expose previous operator data', async () => {
  useAuthStore.getState().signIn(session()); let finish;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: () => new Promise((r) => { finish = r; }) });
  const read = getOperatorOrders(); await new Promise((r) => setImmediate(r));
  useAuthStore.getState().signIn(session('ADMIN', randomUUID())); finish({ items: [summary] }); await assert.rejects(read, { code: 'UNAUTHORIZED' });
});
test('expired/guest sessions never fetch or retain operator credentials/data', async () => {
  useAuthStore.getState().signIn(session()); useAuthStore.setState({ expiresAt: Date.now() - 1 });
  globalThis.fetch = async () => { assert.fail('expired session must not fetch'); };
  assert.equal(getAccessToken(), null); await assert.rejects(getOperatorOrders(), { code: 'UNAUTHORIZED' }); assert.equal(useAuthStore.getState().user, null);
});
