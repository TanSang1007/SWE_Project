import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const ts = require('typescript');
// Test-process-only transpilation using the existing compiler; no new framework.
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
}
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const api = require('../src/lib/api/products.ts');
const { formatVnd } = require('../src/lib/money.ts');
const { ProductListView } = require('../src/components/menu.tsx');
const { ProductDetailView } = require('../src/components/product-detail.tsx');
const { CatalogState, CatalogLoading } = require('../src/components/catalog-state.tsx');
const item = { id: '11111111-1111-4111-8111-111111111111', name: 'Fixture', price: '45000', imageUrl: '/images/fixture.jpg', available: true };
const detail = { ...item, sizes: [{ size: 'M', extraPrice: '5000' }], toppings: [{ id: '22222222-2222-4222-8222-222222222221', name: 'Kem', price: '7000' }] };
const originalFetch = globalThis.fetch;
const originalBase = process.env.NEXT_PUBLIC_API_BASE_URL;
afterEach(() => { globalThis.fetch = originalFetch; if (originalBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL; else process.env.NEXT_PUBLIC_API_BASE_URL = originalBase; });
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('parses list/detail contract and strips fields outside UI representation', () => {
  assert.deepEqual(api.parseProducts({ items: [{ ...item, stock: 20 }], currency: 'VND' }), { items: [item], currency: 'VND' });
  assert.deepEqual(api.parseProduct(detail), detail);
});
test('rejects malformed list/detail and numeric/negative/overflow money', () => {
  for (const price of [45000, '-1', '1.5', '1000000000000']) assert.throws(() => api.parseProduct({ ...detail, price }));
  assert.throws(() => api.parseProducts({ items: [item], currency: 'USD' }));
  assert.throws(() => api.parseProduct({ ...detail, sizes: [{ size: 'XL', extraPrice: '0' }] }));
});
test('formats VND exactly including zero and maximum via BigInt', () => {
  assert.match(formatVnd('45000'), /45\.000/);
  assert.match(formatVnd('999999999999'), /999\.999\.999\.999/);
  assert.match(formatVnd('0'), /0/);
  assert.throws(() => formatVnd('1.1'));
});
test('API client uses configured base URL and only GET catalog paths', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid:3010';
  const requests = [];
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(url.endsWith('/products') ? { items: [item], currency: 'VND' } : detail)); };
  assert.deepEqual(await api.getProducts(), { items: [item], currency: 'VND' });
  assert.deepEqual(await api.getProductById(item.id), detail);
  assert.equal(requests[0].url, 'http://example.invalid:3010/products');
  assert.equal(requests[1].url, `http://example.invalid:3010/products/${item.id}`);
  assert.equal(requests[0].options.credentials, 'omit');
});
test('invalid identifier never calls fetch', async () => {
  globalThis.fetch = () => { throw new Error('must not fetch'); };
  await assert.rejects(api.getProductById('invalid'), { kind: 'invalid-id' });
});
for (const [status, kind] of [[400, 'invalid-id'], [404, 'not-found'], [503, 'unavailable']]) {
  test(`HTTP ${status} is normalized without exposing server internals`, async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
    globalThis.fetch = async () => new Response('SQL stack secret', { status });
    await assert.rejects(api.getProducts(), (error) => error.kind === kind && !error.message.includes('SQL'));
  });
}
test('network and malformed JSON failures become unavailable', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
  globalThis.fetch = async () => { throw new Error('network internals'); };
  await assert.rejects(api.getProducts(), { kind: 'unavailable' });
  globalThis.fetch = async () => new Response('invalid JSON');
  await assert.rejects(api.getProducts(), { kind: 'unavailable' });
});
test('list rendering includes product, money, availability and semantic detail link', () => {
  const html = render(ProductListView, { catalog: { items: [{ ...item, available: false }], currency: 'VND' } });
  assert.match(html, /Fixture/); assert.match(html, /45\.000/); assert.match(html, /Tạm hết/);
  assert.match(html, /href="\/products\//); assert.match(html, /alt="Đồ uống Fixture"/);
});
test('detail rendering shows base price and only supplied sizes/toppings', () => {
  const html = render(ProductDetailView, { product: detail });
  for (const text of ['Fixture', '45.000', 'Size M', '5.000', 'Kem', '7.000']) assert(html.includes(text));
  assert(!html.includes('Size L')); assert(!html.includes('Giỏ hàng'));
});
test('empty list and absent options have clear states', () => {
  assert.match(render(ProductListView, { catalog: { items: [], currency: 'VND' } }), /Thực đơn đang được cập nhật/);
  assert.match(render(ProductDetailView, { product: { ...detail, sizes: [], toppings: [] } }), /chưa có topping/);
});
test('loading/error/not-found/invalid states have roles and accessible actions', () => {
  assert.match(render(CatalogLoading, {}), /role="status"/);
  assert.match(render(CatalogState, { kind: 'unavailable', retry: () => {} }), /Thử lại/);
  assert.match(render(CatalogState, { kind: 'not-found' }), /Không tìm thấy món này/);
  assert.match(render(CatalogState, { kind: 'invalid-id' }), /Đường dẫn món chưa hợp lệ/);
});
