import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url), ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename }).outputText, filename);
require.extensions['.css'] = () => {};
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { InventoryForm, InventoryList, AdminInventory } = require('../src/components/admin-inventory.tsx');
const { parseInventory, parseInventoryResult, inventoryPreview, inventoryMessage, getInventory, adjustInventory } = require('../src/lib/api/admin-inventory.ts');
const { readInventoryContext, saveInventoryContext, clearInventoryContext } = require('../src/lib/inventory-context.ts');
const { useAuthStore } = require('../src/lib/auth-store.ts');
const originalFetch = globalThis.fetch, originalStorage = globalThis.sessionStorage;
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001';
const id = randomUUID(), owner = randomUUID(), item = { productId: id, productName: 'Drink', stock: 10, version: 3 };
const context = { userId: owner, productId: id, key: randomUUID(), body: { delta: 2, expectedVersion: 3 } };
const result = { productId: id, delta: 2, previousStock: 10, stock: 12, version: 4 };
const html = (component, props) => renderToStaticMarkup(React.createElement(component, props));
function storage() { const entries = new Map(); globalThis.sessionStorage = { getItem: k => entries.get(k) ?? null, setItem: (k, v) => entries.set(k, v), removeItem: k => entries.delete(k) }; }
function session(role = 'ADMIN', userId = owner) { useAuthStore.getState().signIn({ accessToken: `${role}-${userId}`, tokenType: 'Bearer', expiresIn: 3600, user: { id: userId, email: 'test@example.invalid', role, loyaltyPoints: 0 } }); }
afterEach(() => { globalThis.fetch = originalFetch; globalThis.sessionStorage = originalStorage; useAuthStore.getState().clear(); });
test('inventory projections strip internal fields and reject malformed/duplicate entries', () => {
  assert.deepEqual(parseInventory({ items: [{ ...item, requestHash: 'secret' }] }), [item]); assert.deepEqual(parseInventory({ items: [] }), []);
  for (const stock of [-1, 1.2, '10', 2147483648]) assert.throws(() => parseInventory({ items: [{ ...item, stock }] }));
  assert.throws(() => parseInventory({ items: [item, item] })); assert.throws(() => parseInventory({ items: [{ ...item, productId: 'bad' }] }));
});
test('historical result must match original identity/delta/version/arithmetic', () => {
  assert.deepEqual(parseInventoryResult({ ...result, key: 'secret' }, context), result);
  for (const extra of [{ productId: randomUUID() }, { delta: 4 }, { version: 5 }, { stock: 13 }, { previousStock: -1 }]) assert.throws(() => parseInventoryResult({ ...result, ...extra }, context));
});
test('increase/decrease preview and integer bounds are validated', () => {
  assert.deepEqual(inventoryPreview(10, 'increase', '2'), { delta: 2, stock: 12 }); assert.deepEqual(inventoryPreview(10, 'decrease', '10'), { delta: -10, stock: 0 });
  for (const qty of ['0', '-1', '1.2', '', '01', '2147483648']) assert.equal(inventoryPreview(10, 'increase', qty), null);
  assert.equal(inventoryPreview(10, 'decrease', '11'), null); assert.equal(inventoryPreview(2147483647, 'increase', '1'), null);
});
test('list empty/status/current stock/version and form labels/pending are accessible', () => {
  assert(html(InventoryList, { items: [], statuses: {}, disabled: false }).includes('Chưa có sản phẩm'));
  const list = html(InventoryList, { items: [item], statuses: { [id]: false }, disabled: true });
  assert(list.includes('Ngừng kinh doanh')); assert(list.includes('Phiên bản 3')); assert(list.includes('disabled')); assert(list.includes('scope="col"'));
  const form = html(InventoryForm, { item, busy: true }); for (const label of ['inventory-direction', 'inventory-quantity', 'inventory-preview', 'inventory-validation', 'aria-busy="true"']) assert(form.includes(label));
  assert(form.includes('disabled')); assert(form.includes('Phiên bản: 3'));
});
test('recovery persists only original user/product/key/payload; no JWT and account switch clears', () => {
  storage(); assert(saveInventoryContext(context)); assert.deepEqual(readInventoryContext(owner), context);
  assert(!JSON.stringify(readInventoryContext(owner)).includes('token')); assert.equal(readInventoryContext(randomUUID()), null); assert.equal(readInventoryContext(owner), null);
  assert(saveInventoryContext(context)); clearInventoryContext(); assert.equal(readInventoryContext(owner), null);
});
test('storage failure prevents promising persistent recovery', () => {
  globalThis.sessionStorage = { setItem: () => { throw new Error('disabled'); }, getItem: () => null };
  assert.equal(saveInventoryContext(context), false);
});
test('ADMIN GET uses no-store/JWT and adjustment preserves exact key/body on repeated recovery', async () => {
  session(); let calls = 0;
  globalThis.fetch = async (url, options) => { assert.equal(options.cache, 'no-store'); assert.equal(options.credentials, 'omit'); assert(options.headers.Authorization);
    if (url.endsWith('/inventory')) return new Response(JSON.stringify({ items: [item] }), { status: 200 });
    calls++; assert(url.endsWith(`/products/${id}/inventory-adjustments`)); assert.equal(options.headers['Idempotency-Key'], context.key); assert.deepEqual(JSON.parse(options.body), context.body);
    return new Response(JSON.stringify(result), { status: 200 }); };
  assert.deepEqual(await getInventory(), [item]); assert.deepEqual(await adjustInventory(context), result); assert.deepEqual(await adjustInventory(context), result); assert.equal(calls, 2);
});
test('lost-response recovery retains context and repeats the original request', async () => {
  storage(); session(); saveInventoryContext(context); globalThis.fetch = async () => { throw new Error('lost'); };
  await assert.rejects(adjustInventory(context), e => e.code === 'UNAVAILABLE'); assert.deepEqual(readInventoryContext(owner), context);
  globalThis.fetch = async () => new Response(JSON.stringify(result), { status: 200 }); assert.deepEqual(await adjustInventory(readInventoryContext(owner)), result);
});
test('stale409 preserves conflict code; does not retry with a newer revision', async () => {
  session(); let n = 0; globalThis.fetch = async () => { n++; return new Response(JSON.stringify({ error: { code: 'CONCURRENT_UPDATE' } }), { status: 409 }); };
  await assert.rejects(adjustInventory(context), e => e.code === 'CONCURRENT_UPDATE'); assert.equal(n, 1); assert(inventoryMessage('CONCURRENT_UPDATE').includes('Tải lại'));
});
test('STAFF/CUSTOMER blocked before fetch; wrong-owner context blocked', async () => {
  globalThis.fetch = async () => { assert.fail('No request expected'); };
  assert.equal(html(AdminInventory, {}), '');
  for (const role of ['STAFF', 'CUSTOMER']) { session(role); assert.equal(html(AdminInventory, {}), ''); await assert.rejects(getInventory(), e => e.code === 'FORBIDDEN'); await assert.rejects(adjustInventory(context), e => e.code === 'FORBIDDEN'); }
  session('ADMIN', randomUUID()); await assert.rejects(adjustInventory(context), e => e.code === 'UNAUTHORIZED');
});
test('401 expiry/403 forbidden and old account response never show success', async () => {
  session(); globalThis.fetch = async () => new Response('{}', { status: 401 }); await assert.rejects(getInventory(), e => e.code === 'UNAUTHORIZED'); assert.equal(useAuthStore.getState().accessToken, null);
  session(); globalThis.fetch = async () => new Response('{}', { status: 403 }); await assert.rejects(getInventory(), e => e.code === 'FORBIDDEN');
  session(); globalThis.fetch = async () => { session('ADMIN', randomUUID()); return new Response(JSON.stringify(result), { status: 200 }); }; await assert.rejects(adjustInventory(context), e => e.code === 'UNAUTHORIZED');
});
