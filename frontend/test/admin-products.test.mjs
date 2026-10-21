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
const { parseAdminProduct, parseAdminProducts, adminProductRequest, validateProductForm, productManagementMessage } = require('../src/lib/api/admin-products.ts');
const { ProductForm, ProductList } = require('../src/components/admin-products.tsx');
const { useAuthStore } = require('../src/lib/auth-store.ts');
const { cartErrorMessage, CartError } = require('../src/lib/api/cart.ts');
const { orderErrorMessage, OrderError } = require('../src/lib/api/orders.ts');
const { CartItems } = require('../src/components/cart-view.tsx');
const originalFetch = globalThis.fetch; process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
const id = randomUUID(); const owner = randomUUID(); const stamp = '2026-10-13T00:00:00.000Z';
const p = { id, name: 'Drink', price: '999999999999', imageUrl: '/images/cappuccino.svg', stock: 1, isActive: true, version: 7, createdAt: stamp, updatedAt: stamp,
  sizes: [{ size: 'M', extraPrice: '0' }], toppings: [{ id: randomUUID(), name: 'Cream', price: '5000', createdAt: stamp, updatedAt: stamp }] };
const session = (role = 'ADMIN', actor = owner) => useAuthStore.getState().signIn({ accessToken: `fixture-${role}-${actor}`, tokenType: 'Bearer', expiresIn: 3600, user: { id: actor, email: 'fixture@example.invalid', loyaltyPoints: 0, role } });
const html = (component, props) => renderToStaticMarkup(React.createElement(component, props));
afterEach(() => { globalThis.fetch = originalFetch; useAuthStore.getState().clear(); });
test('A04 parser returns exact phased DTO without option flags/version/internal fields', () => {
  assert.deepEqual(parseAdminProduct({ ...p, passwordHash: 'private', sizes: [{ ...p.sizes[0], isActive: true }], toppings: [{ ...p.toppings[0], version: 77, isActive: true }] }), p);
  assert.deepEqual(parseAdminProducts({ items: [p] }), [p]); assert.deepEqual(parseAdminProducts({ items: [] }), []);
});
test('parser rejects malformed flags/versions/stock/money/IDs/options/duplicate rows', () => {
  for (const [field, values] of [['price', [45000, '1.5', '-1', '1000000000000']], ['isActive', [null, 'true', 1]], ['stock', [-1, 1.5]], ['version', ['7', 2147483648]], ['createdAt', ['bad']], ['id', ['bad']]]) for (const value of values) assert.throws(() => parseAdminProduct({ ...p, [field]: value }));
  assert.throws(() => parseAdminProducts({ items: [p, p] })); assert.throws(() => parseAdminProduct({ ...p, sizes: [{ size: 'XL', extraPrice: '0' }] }));
});
test('Cold brew empty sizes remains a valid Admin response with stock visible', () => { assert.deepEqual(parseAdminProduct({ ...p, sizes: [] }).sizes, []); assert.match(html(ProductList, { items: [{ ...p, sizes: [] }], busy: false }), /hiện chưa thể đặt hàng/); });
test('create form requires explicit sizes, no isActive/stock inputs, label/fieldset/pending accessibility', () => {
  const value = html(ProductForm, { toppings: p.toppings, busy: false });
  for (const text of ['Tên sản phẩm', 'Giá cơ bản (VND)', 'Kích cỡ bắt buộc', 'Cream', 'Lưu sản phẩm', 'name="sizes"', 'name="extra-M"']) assert(value.includes(text));
  assert(!value.includes('name="stock"')); assert(!value.includes('name="isActive"')); assert(!value.includes('checked=""'));
  const busy = html(ProductForm, { toppings: [], busy: true }); assert(busy.includes('aria-busy="true"')); assert(busy.includes('disabled'));
});
test('edit form shows flag/current metadata, no mutable inline sizes/stock', () => { const value = html(ProductForm, { product: p, toppings: [], busy: false }); assert(value.includes('name="isActive"')); assert(!value.includes('name="sizes"')); assert(!value.includes('name="stock"')); });
test('Product list/empty/status/delete actions format exact VND, stock read-only', () => {
  assert.match(html(ProductList, { items: [], busy: false }), /Chưa có sản phẩm/);
  const value = html(ProductList, { items: [p, { ...p, id: randomUUID(), isActive: false, stock: 0 }], busy: true });
  for (const text of ['999.999.999.999', 'Đang kinh doanh', 'Ngừng kinh doanh', 'Hết tồn', 'Xóa sản phẩm', 'Bật bán lại', 'disabled']) assert(value.includes(text)); assert(!value.includes('<input'));
});
test('form validation rejects invalid name/money/path/missing-size and allows Decimal VND boundaries', () => {
  assert.equal(validateProductForm(' Drink ', '0', '/images/drink.svg', p.sizes), '');
  assert.equal(validateProductForm('Drink', '999999999999', '/images/drink.svg', p.sizes), '');
  for (const args of [[' ', '0', '/images/x', p.sizes], ['Drink', '01', '/images/x', p.sizes], ['Drink', '1.5', '/images/x', p.sizes], ['Drink', '1', '/images/../x', p.sizes], ['Drink', '1', '/images//x', p.sizes], ['Drink', '1', '/images/x', []]]) assert(validateProductForm(...args));
});
test('authenticated CRUD exact paths/methods/payload/headers and no-store', async () => {
  session(); const calls = []; globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return options.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(options.method === 'GET' && !url.endsWith(id) ? { items: [p] } : p, { status: options.method === 'POST' ? 201 : 200 }); };
  await adminProductRequest('GET'); await adminProductRequest('GET', id); await adminProductRequest('POST', undefined, { name: 'Drink', price: '1', imageUrl: '/images/x', sizes: p.sizes, toppingIds: [] });
  await adminProductRequest('PATCH', id, { expectedVersion: 7, isActive: false }); await adminProductRequest('DELETE', id, { expectedVersion: 7 });
  assert.deepEqual(calls.map(c => c.method), ['GET', 'GET', 'POST', 'PATCH', 'DELETE']); assert.equal(calls[0].body, undefined);
  for (const c of calls) { assert.equal(c.cache, 'no-store'); assert.match(c.headers.Authorization, /^Bearer /); assert(!c.url.includes('token=')); }
  assert.deepEqual(JSON.parse(calls[3].body), { expectedVersion: 7, isActive: false });
});
test('guest/STAFF/CUSTOMER cannot call management client', async () => { globalThis.fetch = () => assert.fail('No request'); await assert.rejects(adminProductRequest('GET'), { code: 'UNAUTHORIZED' }); for (const role of ['STAFF', 'CUSTOMER']) { session(role); await assert.rejects(adminProductRequest('POST'), { code: 'FORBIDDEN' }); } });
test('session expiration clears current private session; Forbidden is explicit', async () => { session(); globalThis.fetch = async () => new Response(null, { status: 401 }); await assert.rejects(adminProductRequest('GET'), { code: 'UNAUTHORIZED' }); assert.equal(useAuthStore.getState().accessToken, null);
  session(); globalThis.fetch = async () => new Response(null, { status: 403 }); await assert.rejects(adminProductRequest('GET'), { code: 'FORBIDDEN' }); });
test('late response from another account cannot overwrite new session, including401', async () => {
  for (const status of [200, 401]) { session(); let resolve; globalThis.fetch = () => new Promise(r => { resolve = r; }); const task = adminProductRequest('GET'); session('ADMIN', randomUUID()); resolve(status === 200 ? Response.json({ items: [p] }) : new Response(null, { status })); await assert.rejects(task, { code: 'UNAUTHORIZED' }); assert(useAuthStore.getState().accessToken); }
});
test('conflicts/validation/missing resources remain typed with safe messages; raw faults sanitized', async () => {
  session(); for (const code of ['CONCURRENT_UPDATE', 'RESOURCE_IN_USE', 'VALIDATION_ERROR', 'PRODUCT_NOT_FOUND', 'TOPPING_NOT_FOUND', 'SQL secret']) {
    globalThis.fetch = async () => Response.json({ error: { code, message: 'SQL passwordHash' } }, { status: 409 });
    await assert.rejects(adminProductRequest('PATCH', id, { expectedVersion: 7, price: '1' }), { code: code === 'SQL secret' ? 'UNAVAILABLE' : code }); assert(!productManagementMessage(code).includes('SQL'));
  } assert.match(productManagementMessage('RESOURCE_IN_USE'), /ngừng bán/); assert.match(productManagementMessage('CONCURRENT_UPDATE'), /thao tác mới/);
});
test('network/malformed response has no automatic retry or duplicate POST', async () => { session(); let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('private'); }; await assert.rejects(adminProductRequest('POST'), { code: 'UNAVAILABLE' }); assert.equal(calls, 1); });
test('Cart warning retains unavailable item/removal and action messages mention preservation', () => {
  const item = { id, productId: id, productName: 'Inactive', imageUrl: '/images/x', available: false, size: 'M', qty: 1, toppings: [], unitPrice: '45000', lineTotal: '45000' };
  const value = html(CartItems, { cart: { items: [item], totalQuantity: 1, subtotal: '45000', currency: 'VND' }, locked: false }); assert(value.includes('hiện chưa thể đặt hàng')); assert(value.includes('Xóa')); assert(value.includes('Inactive'));
  assert.match(cartErrorMessage(new CartError('PRODUCT_UNAVAILABLE')), /Giỏ vẫn được giữ/); assert.match(orderErrorMessage(new OrderError('PRODUCT_UNAVAILABLE')), /Giỏ vẫn được giữ/);
});
