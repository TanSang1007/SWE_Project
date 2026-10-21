import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url); const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { OrderCheckout, OrderSummary } = require('../src/components/order-checkout.tsx');
const { orderRequest, OrderError } = require('../src/lib/api/orders.ts');
const { checkoutErrorMessage } = require('../src/lib/checkout-policy.ts');
const { useAuthStore } = require('../src/lib/auth-store.ts');
const context = require('../src/lib/order-context.ts');
const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
const originalFetch = globalThis.fetch; const originalStorage = globalThis.sessionStorage;
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
const id = '11111111-1111-4111-8111-111111111111';
const payload = { items: [{ productId: id, size: 'M', qty: 2, toppingIds: [] }], promotionCode: 'BREW10K' };
const order = { id, orderCode: 'BL-promo', status: 'PENDING', currency: 'VND', createdAt: '2026-10-09T00:00:00Z', promotionCode: 'BREW10K',
  subtotal: '104002', discountAmount: '10000', total: '94002', items: [{ productId: id, productName: 'Drink', size: 'M', qty: 2, unitPrice: '52001', lineTotal: '104002', toppings: [] }] };

test('owner-selected BREW10K displays 40000 subtotal,10000 discount and30000 payable from Order snapshot', () => {
  const html = renderToStaticMarkup(React.createElement(OrderSummary, { order: { ...order, subtotal: '40000', discountAmount: '10000', total: '30000' } }));
  for (const text of ['BREW10K', '40.000', '10.000', '30.000']) assert(html.includes(text));
});
function login() { useAuthStore.getState().signIn({ accessToken: 'test-only', expiresIn: 3600, user: { id, email: 'test@example.invalid', loyaltyPoints: 0, role: 'CUSTOMER' } }); }
afterEach(() => { globalThis.fetch = originalFetch; globalThis.sessionStorage = originalStorage; useAuthStore.getState().clear(); });
test('Promotion input is labeled, bounded, disabled during recovery and explains server confirmation', () => {
  const html = renderToStaticMarkup(React.createElement(OrderCheckout, { cart: { items: [], subtotal: '0' }, disabled: false, onLock() {} }));
  assert.match(html, /for="checkout-promotion"/); assert.match(html, /aria-describedby="checkout-promotion-note"/);
  assert.match(html, /maxLength="32" disabled=""/); assert(html.includes('Mã được kiểm tra khi đặt hàng'));
  assert(!html.includes('Giảm giá cố định')); assert(!html.includes('BREW10K'));
});
test('valid code is sent only through POST orders; snapshot supplies discount/final total', async () => {
  login(); const calls = []; globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json(order); };
  const result = await orderRequest('/orders', 'POST', payload, 'original-key');
  assert.equal(calls.length, 1); assert(calls[0].url.endsWith('/orders')); assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  assert.equal(result.discountAmount, '10000'); assert.equal(result.total, '94002');
});
test('invalid code422 retains typed error and shows a safe actionable message', async () => {
  login(); globalThis.fetch = async () => Response.json({ error: { code: 'PROMOTION_INVALID', message: 'private SQL details' } }, { status: 422 });
  await assert.rejects(orderRequest('/orders', 'POST', payload, 'key'), { code: 'PROMOTION_INVALID' });
  const message = checkoutErrorMessage(new OrderError('PROMOTION_INVALID'), 'create'); assert(message.includes('Kiểm tra mã')); assert(!message.includes('SQL'));
});
test('confirmed summary shows promotion code and exact backend amounts', () => {
  const html = renderToStaticMarkup(React.createElement(OrderSummary, { order }));
  for (const value of ['BREW10K', '104.002', '10.000', '94.002', 'Giảm giá cố định', 'Tổng đơn']) assert(html.includes(value));
});
test('fully discounted snapshot displays zero total without claiming payment success', () => {
  const html = renderToStaticMarkup(React.createElement(OrderSummary, { order: { ...order, discountAmount: '104002', total: '0' } }));
  assert.match(html, /<dt>Tổng đơn<\/dt><dd>0/); assert(!html.includes('Thanh toán thành công'));
});
test('reload recovery preserves code/key/payload and never stores client discount authority', () => {
  const data = new Map(); globalThis.sessionStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  context.writeOrderContext({ userId: id, key: 'same-key', payload, orderId: id });
  const recovered = context.readOrderContext(id); assert.deepEqual(recovered.payload, payload); assert.equal(recovered.key, 'same-key');
  assert(![...data.values()].join('').includes('discountAmount')); assert(![...data.values()].join('').includes('accessToken'));
});
