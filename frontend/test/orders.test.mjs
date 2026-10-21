import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url); const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { orderRequest, parseOrder, orderErrorMessage, OrderError } = require('../src/lib/api/orders.ts');
const context = require('../src/lib/order-context.ts'); const { useAuthStore } = require('../src/lib/auth-store.ts');
const { OrderSummary, OrderCheckout } = require('../src/components/order-checkout.tsx');
const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
const originalFetch = globalThis.fetch; const originalStorage = globalThis.sessionStorage;
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
const id = '11111111-1111-4111-8111-111111111111';
const order = { id, orderCode: 'BL-test', status: 'PENDING', currency: 'VND', createdAt: '2026-10-07T00:00:00Z', promotionCode: null,
  subtotal: '104000', discountAmount: '10000', total: '94000', items: [{ productId: id, productName: 'Drink', size: 'M', qty: 2, unitPrice: '52000', lineTotal: '104000', toppings: [{ name: 'Cream', price: '7000' }] }] };
const payload = { items: [{ productId: id, size: 'M', qty: 2, toppingIds: [] }] };
function login() { useAuthStore.getState().signIn({ accessToken: 'test-only', expiresIn: 3600, user: { id, email: 'test@example.invalid', loyaltyPoints: 0, role: 'CUSTOMER' } }); }
afterEach(() => { globalThis.fetch = originalFetch; globalThis.sessionStorage = originalStorage; useAuthStore.getState().clear(); });
test('POST order carries JWT/key/config only; same retry key and payload retained', async () => {
  const calls = []; globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json(order); }; login();
  await orderRequest('/orders', 'POST', payload, 'same-key'); await orderRequest('/orders', 'POST', payload, 'same-key');
  const posts = calls.filter((c) => c.options.method === 'POST'); assert.equal(posts.length, 2);
  for (const c of posts) { assert.equal(c.options.headers['Idempotency-Key'], 'same-key'); assert.deepEqual(JSON.parse(c.options.body), payload); assert.equal(c.options.headers.Authorization, 'Bearer test-only'); }
});
test('new-key block recovers existingOrderId without storage', async () => {
  globalThis.fetch = async () => Response.json({ error: { code: 'INVALID_ORDER_STATE', details: { existingOrderId: id } } }, { status: 409 }); login();
  await assert.rejects(orderRequest('/orders', 'POST', payload, 'key'), { code: 'INVALID_ORDER_STATE', existingOrderId: id });
});
for (const code of ['OUT_OF_STOCK', 'CONCURRENT_UPDATE', 'INVALID_ITEM_OPTIONS', 'VALIDATION_ERROR', 'PROMOTION_INVALID']) test(`checkout error ${code} preserves typed error and safe UI message`, async () => {
  globalThis.fetch = async () => Response.json({ error: { code, message: 'private server details' } }, { status: 409 }); login();
  await assert.rejects(orderRequest('/orders', 'POST', payload, 'key'), { code }); assert(!orderErrorMessage(new OrderError(code)).includes('private'));
});
test('network/API errors remain uncertain; unauthorized clears auth', async () => {
  globalThis.fetch = async () => { throw new Error('private failure'); }; login(); await assert.rejects(orderRequest('/orders', 'POST', payload, 'key'), { code: 'UNAVAILABLE' });
  globalThis.fetch = async () => new Response('', { status: 401 }); await assert.rejects(orderRequest(`/orders/${id}`), { code: 'UNAUTHORIZED' }); assert.equal(useAuthStore.getState().accessToken, null);
});
test('summary renders server monetary snapshot/status and never displays payment success', () => {
  const html = renderToStaticMarkup(React.createElement(OrderSummary, { order }));
  for (const value of ['PENDING', 'Drink', '52.000', '104.000', '94.000', '10.000']) assert(html.includes(value));
  assert(!html.includes('PAID')); assert(!html.includes('Thanh toán thành công'));
});
test('creation controls show Place Order; empty/disabled state cannot submit', () => {
  const html = renderToStaticMarkup(React.createElement(OrderCheckout, { cart: { items: [], subtotal: '0', totalQuantity: 0, currency: 'VND' }, disabled: false, onLock() {} }));
  assert.match(html, /disabled="">Đặt hàng/); assert(html.includes('Đang khôi phục đơn')); assert(html.includes('aria-busy="true"'));
});
test('typed parser strips internal fields and rejects malformed money/status', () => {
  assert(!('passwordHash' in parseOrder({ ...order, passwordHash: 'private' })));
  assert.throws(() => parseOrder({ ...order, total: 1.1 })); assert.throws(() => parseOrder({ ...order, status: 'CONFIRMED' }));
});
test('retry context stores no token; owner switch discards context; storage loss harmless', () => {
  const data = new Map(); globalThis.sessionStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const attempt = { userId: id, key: 'key', payload, orderId: id }; context.writeOrderContext(attempt); assert.deepEqual(context.readOrderContext(id), attempt);
  assert(![...data.values()].join('').includes('accessToken')); assert.equal(context.readOrderContext('other'), null);
  assert.equal(context.readOrderContext(id), null);
});
