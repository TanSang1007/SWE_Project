import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url); const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { checkoutErrorMessage, checkoutStatusMessage, unpaid } = require('../src/lib/checkout-policy.ts');
const { OrderError } = require('../src/lib/api/orders.ts'); const context = require('../src/lib/order-context.ts');
const { OrderSummary, OrderCheckout } = require('../src/components/order-checkout.tsx');
const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
const originalStorage = globalThis.sessionStorage; afterEach(() => { globalThis.sessionStorage = originalStorage; });
const id = '11111111-1111-4111-8111-111111111111';

test('confirmed CANCELLED releases the checkout policy; a new intent uses fresh keys and current Cart payload', () => {
  assert.equal(unpaid({ status: 'CANCELLED' }), false);
  const payload = { items: [{ productId: id, size: 'S', qty: 1, toppingIds: [] }], promotionCode: 'BREW10K', redeemedPoints: 0 };
  const first = context.newOrderContext(id, payload, '40000');
  const second = context.newOrderContext(id, payload, '40000');
  assert.notEqual(first.key, second.key); assert.equal(second.orderId, undefined);
  assert.deepEqual(second.payload, payload);
  // Unresolved/PAYMENT_FAILED remains an active checkout, never a new Order intent.
  assert(unpaid({ status: 'PENDING' })); assert(unpaid({ status: 'PAYMENT_FAILED' }));
});
test('admission error preserves actionable Cart recovery rather than suggesting Mock or a new charge', () => {
  const text = checkoutErrorMessage(new OrderError('PAYMENT_ADMISSION_CLOSED'), 'create');
  assert(text.includes('giữ nguyên giỏ hàng')); assert(!text.includes('Mock'));
});
test('minimum rejection displays safe actionable text for create and payment', () => {
  for (const operation of ['create', 'payment']) assert.equal(checkoutErrorMessage(new OrderError('VNPAY_MINIMUM_AMOUNT_NOT_MET'), operation), 'Thanh toán VNPAY yêu cầu số tiền tối thiểu 5.000đ. Vui lòng điều chỉnh giỏ hàng hoặc số điểm sử dụng.');
});
const order = { id, orderCode: 'BL-snapshot', status: 'PENDING', currency: 'VND', createdAt: '2026-10-08T00:00:00Z', promotionCode: 'FIXED', subtotal: '104002', discountAmount: '10000', total: '94002',
  items: [{ productId: id, productName: 'Món lúc đặt', size: 'L', qty: 2, unitPrice: '52001', lineTotal: '104002', toppings: [{ name: 'Kem lúc đặt', price: '7001' }] }] };
test('summary renders exact immutable snapshot values, fixed discount/code and labeled totals in VND', () => {
  const html = renderToStaticMarkup(React.createElement(OrderSummary, { order }));
  for (const text of ['Món lúc đặt', 'Kem lúc đặt', 'Size L', '2 ly', '52.001', '104.002', '7.001', '94.002', '10.000', 'FIXED', '<dl', '<dt>Tổng đơn</dt>', 'PENDING']) assert(html.includes(text), text);
  assert(!html.includes('PAID')); assert(!html.includes('Thanh toán thành công'));
});
test('zero discount/final amount and maximum VND snapshot remain exact', () => {
  for (const total of ['0', '999999999999']) {
    const html = renderToStaticMarkup(React.createElement(OrderSummary, { order: { ...order, total } }));
    assert(html.includes(total === '0' ? '0' : '999.999.999.999'));
  }
});
test('initial recovery/empty Cart announces loading and prevents creation before cache is read', () => {
  const html = renderToStaticMarkup(React.createElement(OrderCheckout, { cart: { items: [], subtotal: '0', totalQuantity: 0, currency: 'VND' }, disabled: false, onLock() {} }));
  assert(html.includes('aria-busy="true"')); assert(html.includes('role="status"')); assert(html.includes('Thêm ít nhất một món')); assert.match(html, /disabled="">Đặt hàng/);
  assert(html.includes('for="checkout-promotion"')); assert(!html.includes('Thanh toán thành công'));
});
test('only PENDING and PAYMENT_FAILED lock the unpaid flow; terminal/current server statuses have correct messages', () => {
  assert(unpaid(order)); assert(unpaid({ ...order, status: 'PAYMENT_FAILED' }));
  for (const status of ['PAID', 'CANCELLED', 'PREPARING', 'READY', 'COMPLETED']) { assert(!unpaid({ ...order, status })); assert(checkoutStatusMessage(status).length > 10); }
  assert(!checkoutStatusMessage('CANCELLED').includes('hoàn tiền')); assert(!checkoutStatusMessage('PENDING').includes('thành công'));
});
for (const operation of ['create', 'payment', 'cancel', 'refresh']) test(`uncertain ${operation} error gives the correct recovery action and no raw details`, () => {
  const message = checkoutErrorMessage(new Error('Prisma secret JWT SQL stack trace'), operation);
  assert(!/Prisma|JWT|SQL|secret|stack/.test(message));
  if (operation === 'create') assert(message.includes('cùng yêu cầu'));
  if (operation === 'payment') assert(message.includes('cùng yêu cầu thanh toán'));
  if (operation === 'cancel') assert(message.includes('tải lại đơn'));
  if (operation === 'refresh') assert(message.includes('tải lại'));
});
test('retry insufficient stock, stale Cart, promotion and expired auth errors preserve actionable selections/recovery messages', () => {
  assert(checkoutErrorMessage(new OrderError('OUT_OF_STOCK'), 'payment').includes('hủy đơn'));
  assert(checkoutErrorMessage(new OrderError('CONCURRENT_UPDATE'), 'create').includes('xác nhận lại'));
  assert(!checkoutErrorMessage(new OrderError('CONCURRENT_UPDATE'), 'create').includes('Đã tải lại'));
  assert(checkoutErrorMessage(new OrderError('PROMOTION_INVALID'), 'create').includes('Kiểm tra mã'));
  assert(checkoutErrorMessage(new OrderError('UNAUTHORIZED'), 'payment').includes('đăng nhập lại'));
  assert(checkoutErrorMessage(new OrderError('INVALID_ITEM_OPTIONS'), 'create').includes('size hoặc topping'));
});
test('inactive Product checkout rejection preserves Cart and directs adjustment instead of uncertain replay', () => {
  const message = checkoutErrorMessage(new OrderError('PRODUCT_UNAVAILABLE'), 'create');
  assert(message.includes('Món đã ngừng bán')); assert(message.includes('Giỏ vẫn được giữ')); assert(message.includes('xóa dòng'));
  assert(!message.includes('cùng yêu cầu'));
});
test('old and new context formats retain exact original key/payload; preview is UI-only and extra top-level secrets are stripped', () => {
  const data = new Map(); globalThis.sessionStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const old = { userId: id, key: 'original', payload: { items: [{ productId: id, size: 'L', qty: 2, toppingIds: [] }] }, orderId: id };
  context.writeOrderContext(old); assert.deepEqual(context.readOrderContext(id), old);
  context.writeOrderContext({ ...old, previewSubtotal: '104002', accessToken: 'discard-me' });
  const saved = context.readOrderContext(id); assert.equal(saved.key, old.key); assert.deepEqual(saved.payload, old.payload); assert.equal(saved.previewSubtotal, '104002'); assert(!('accessToken' in saved));
  assert(![...data.values()].join('').includes('discard-me'));
});
