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
const { parseLogin } = require('../src/lib/api/auth.ts');
const { roleDestination, shellAccess } = require('../src/lib/role-policy.ts');
const { OperatorShellContent } = require('../src/components/operator-shell.tsx');
const { useAuthStore, getAccessToken } = require('../src/lib/auth-store.ts');
const { useCartStore } = require('../src/lib/cart-store.ts');
const originalFetch = globalThis.fetch; const originalStorage = globalThis.sessionStorage;
const owner = randomUUID();
const response = (role = 'CUSTOMER', id = owner) => ({ accessToken: `fixture-${id}`, tokenType: 'Bearer', expiresIn: 3600, user: { id, email: 'fixture@example.invalid', loyaltyPoints: 0, role } });
globalThis.fetch = async () => Response.json({ items: [], subtotal: '0', totalQuantity: 0, currency: 'VND' });
afterEach(() => { useAuthStore.getState().clear(); globalThis.fetch = originalFetch; globalThis.sessionStorage = originalStorage; });
for (const role of ['CUSTOMER', 'STAFF', 'ADMIN']) test(`auth parser/store preserve ${role} without private fields`, () => {
  const input = response(role); const parsed = parseLogin({ ...input, user: { ...input.user, passwordHash: 'discarded' } });
  assert.deepEqual(parsed, input); useAuthStore.getState().signIn(parsed); assert.equal(useAuthStore.getState().user.role, role); assert.equal(getAccessToken(), input.accessToken);
});
test('auth parser rejects missing/unknown/untrusted role types', () => {
  for (const role of [undefined, 'ROOT', 1, null, { role: 'ADMIN' }]) assert.throws(() => parseLogin({ ...response(), user: { ...response().user, role } }));
});
test('login role destinations keep safe returnTo and deny incompatible private routes', () => {
  assert.equal(roleDestination('CUSTOMER', null), '/'); assert.equal(roleDestination('STAFF', null), '/operator/orders'); assert.equal(roleDestination('ADMIN', null), '/admin');
  assert.equal(roleDestination('ADMIN', '/admin/products'), '/admin/products'); assert.equal(roleDestination('STAFF', '/admin/products'), '/operator/orders');
  assert.equal(roleDestination('CUSTOMER', '/operator/orders'), '/'); assert.equal(roleDestination('CUSTOMER', '/cart?orderId=fixture'), '/cart?orderId=fixture');
  for (const role of ['STAFF', 'ADMIN']) assert.equal(roleDestination(role, '/orders'), role === 'ADMIN' ? '/admin' : '/operator/orders');
  for (const path of ['//evil.invalid', '/\\evil.invalid', '/login', 'https://evil.invalid']) assert.equal(roleDestination('ADMIN', path), '/admin');
});
test('operator/admin shell permission matrix is explicit and guest is unauthorized', () => {
  assert.equal(shellAccess(undefined, false, ['ADMIN']), 'unauthorized');
  for (const role of ['CUSTOMER', 'STAFF', 'ADMIN']) {
    assert.equal(shellAccess(role, true, ['STAFF', 'ADMIN']), role === 'CUSTOMER' ? 'forbidden' : 'allowed');
    assert.equal(shellAccess(role, true, ['ADMIN']), role === 'ADMIN' ? 'allowed' : 'forbidden');
  }
});
function html(role, allowed = ['STAFF', 'ADMIN'], ready = true, authenticated = true) {
  return renderToStaticMarkup(React.createElement(OperatorShellContent, { role, allowed, ready, authenticated, pathname: '/operator/orders' }, React.createElement('p', null, 'PRIVATE CONTENT')));
}
test('shell loading/guest/forbidden states never render operator children', () => {
  for (const markup of [html('ADMIN', ['ADMIN'], false), html(undefined, ['ADMIN'], true, false), html('CUSTOMER'), html('STAFF', ['ADMIN'])]) {
    assert(!markup.includes('PRIVATE CONTENT'));
  }
  assert(html('ADMIN', ['ADMIN'], false).includes('role="status"')); assert(html(undefined, ['ADMIN'], true, false).includes('returnTo'));
  assert(html('CUSTOMER').includes('role="alert"')); assert(html('CUSTOMER').includes('Không có quyền truy cập'));
});
test('Staff shell omits admin controls; Admin has approved shell links and no fake data', () => {
  const staff = html('STAFF'); const admin = html('ADMIN');
  assert(staff.includes('PRIVATE CONTENT')); assert(!staff.includes('href="/admin/products"'));
  assert(admin.includes('href="/admin/products"')); assert(admin.includes('aria-label="Khu vực quản trị"'));
  assert(!staff.includes('<table')); assert(!admin.includes('<form'));
});
test('logout/expiry clear role and Cart cache; different login never inherits role', () => {
  globalThis.fetch = async () => new Promise(() => {});
  useAuthStore.getState().signIn(response('CUSTOMER')); useCartStore.setState({ cart: { items: [], totalQuantity: 9, subtotal: '0', currency: 'VND' } });
  useAuthStore.getState().signIn(response('ADMIN', randomUUID())); assert.equal(useCartStore.getState().cart, null); assert.equal(useAuthStore.getState().user.role, 'ADMIN');
  useAuthStore.getState().clear(); assert.equal(useAuthStore.getState().user, null); assert.equal(useCartStore.getState().cart, null);
  useAuthStore.getState().signIn(response('STAFF')); useAuthStore.setState({ expiresAt: Date.now() - 1 }); assert.equal(getAccessToken(), null); assert.equal(useAuthStore.getState().user, null);
});
test('same-owner uncertain transport context survives re-login; another user discards it', () => {
  globalThis.fetch = async () => new Promise(() => {});
  const values = new Map(); globalThis.sessionStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  values.set('brewlite-order-context', JSON.stringify({ userId: owner, key: randomUUID(), payload: { items: [] } }));
  values.set('brewlite-payment-context', JSON.stringify({ userId: owner, key: randomUUID(), payload: { orderId: randomUUID(), method: 'CARD' } }));
  useAuthStore.getState().signIn(response()); assert.equal(values.size, 2); useAuthStore.getState().clear(); useAuthStore.getState().signIn(response()); assert.equal(values.size, 2);
  useAuthStore.getState().signIn(response('STAFF', randomUUID())); assert.equal(values.size, 0);
});
