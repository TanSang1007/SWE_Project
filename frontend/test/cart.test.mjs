import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url); const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const api = require('../src/lib/api/cart.ts'); const { useAuthStore } = require('../src/lib/auth-store.ts');
const { useCartStore } = require('../src/lib/cart-store.ts');
const { renderToStaticMarkup } = require('react-dom/server'); const React = require('react');
const { CartView, CartItems } = require('../src/components/cart-view.tsx');
const renderItems = (cart) => renderToStaticMarkup(React.createElement(CartItems, { cart, locked: false, onQuantity() {}, onEdit() {}, onRemove() {} }));
const originalFetch = globalThis.fetch;
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
const item = { id: 'item', productId: 'product', productName: 'Latte', imageUrl: '/images/latte.jpg', available: true, size: 'M', qty: 2, toppings: [{ id: 'a', name: 'Kem', price: '5000' }], unitPrice: '50000', lineTotal: '100000' };
const cart = { items: [item], totalQuantity: 2, subtotal: '100000', currency: 'VND' };
const empty = { items: [], totalQuantity: 0, subtotal: '0', currency: 'VND' };
const input = { productId: 'product', size: 'L', toppingIds: ['b'], qty: 2 };
function signIn() { useAuthStore.getState().signIn({ accessToken: 'fixture', expiresIn: 3600, user: { id: 'user', email: 'fixture@example.invalid', loyaltyPoints: 0, role: 'CUSTOMER' } }); }
afterEach(() => { globalThis.fetch = originalFetch; useAuthStore.getState().clear(); });
test('guest request blocked and cart renders login state', async () => {
  await assert.rejects(api.cartRequest(), { code: 'UNAUTHORIZED' });
  assert.match(renderToStaticMarkup(React.createElement(CartView)), /Đăng nhập để tải giỏ/);
});
test('GET/POST/PATCH/DELETE carry JWT, no userId or prices, display server subtotal', async () => {
  const calls = []; globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json(cart); }; signIn();
  await api.cartRequest('POST', '/cart/items', input); await api.cartRequest('PATCH', '/cart/items/item', { qty: 3 }); await api.cartRequest('DELETE', '/cart/items/item');
  const posts = calls.filter((c) => c.options.method === 'POST'); assert.equal(posts.length, 1); assert.deepEqual(JSON.parse(posts[0].options.body), input);
  assert(calls.every((c) => c.options.headers.Authorization === 'Bearer fixture'));
  useCartStore.getState().setCart(cart); const html = renderItems(cart);
  for (const expected of ['Latte', 'Size M', 'Kem', '100.000', 'Chỉnh sửa', 'Xóa']) assert(html.includes(expected));
});
test('empty state and logout clear cache', async () => {
  globalThis.fetch = async () => Response.json(empty); signIn(); await useCartStore.getState().load();
  assert.match(renderItems(empty), /Giỏ đang trống/);
  useCartStore.getState().setCart(cart); useAuthStore.getState().clear(); assert.equal(useCartStore.getState().cart, null);
});
test('login/reload cache rehydrates by GET; stale response after logout discarded', async () => {
  globalThis.fetch = async () => Response.json(cart); signIn(); await useCartStore.getState().load(); assert.deepEqual(useCartStore.getState().cart, cart);
  useCartStore.setState({ cart: null }); assert.equal(await useCartStore.getState().load(), true); assert.deepEqual(useCartStore.getState().cart, cart);
  let resolve; globalThis.fetch = () => new Promise((done) => { resolve = done; }); const loading = useCartStore.getState().load();
  useAuthStore.getState().clear(); resolve(Response.json(cart)); assert.equal(await loading, false); assert.equal(useCartStore.getState().cart, null);
});
test('superseded successful Cart read is not acknowledged as updated when the newer read fails', async () => {
  globalThis.fetch = async () => Response.json(cart); signIn(); await useCartStore.getState().load();
  const reads = []; globalThis.fetch = () => new Promise((resolve, reject) => reads.push({ resolve, reject }));
  const oldRead = useCartStore.getState().load(); const newRead = useCartStore.getState().load();
  reads[1].reject(new Error('offline')); await assert.rejects(newRead, { code: 'UNAVAILABLE' });
  reads[0].resolve(Response.json(empty)); assert.equal(await oldRead, false); assert.deepEqual(useCartStore.getState().cart, cart);
  globalThis.fetch = async () => Response.json(empty); assert.equal(await useCartStore.getState().load(), true); assert.deepEqual(useCartStore.getState().cart, empty);
});
for (const change of [{ size: 'L' }, { toppingIds: [] }, { toppingIds: ['b'] }]) test(`edit ${JSON.stringify(change)} uses one atomic options request; server quantity retained`, async () => {
  const calls = []; globalThis.fetch = async (_url, options) => { calls.push(options); return Response.json(cart); }; signIn();
  calls.length = 0; const result = await api.editCartItem(item, { productId: item.productId, size: item.size, toppingIds: ['a'], qty: 99, ...change });
  assert.deepEqual(calls.map((c) => c.method), ['PATCH']); assert.equal(JSON.parse(calls[0].body).qty, undefined); assert.deepEqual(result.cart, cart);
});
test('failed options edit never sends a separate add or delete', async () => {
  globalThis.fetch = async () => Response.json(empty); signIn(); const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({url, method: options.method}); return Response.json({ error: { code: 'INVALID_ITEM_OPTIONS' } }, { status: 400 }); };
  await assert.rejects(api.editCartItem(item, input), {code: 'INVALID_ITEM_OPTIONS'});
  assert.deepEqual(calls, [{url: 'http://example.invalid/cart/items/item/options', method: 'PATCH'}]);
  globalThis.fetch = async (_url, options) => { assert.equal(options.method, 'PATCH'); throw new Error('offline'); };
  await assert.rejects(api.editCartItem(item, input), {code: 'UNAVAILABLE'});
});
test('edit into existing configuration renders merged qty and server subtotal', async () => {
  const merged = { ...cart, totalQuantity: 3, subtotal: '150000', items: [{ ...item, qty: 3, lineTotal: '150000' }] };
  globalThis.fetch = async () => Response.json(merged); signIn();
  const result = await api.editCartItem({ ...item, id: 'old', size: 'L' }, { ...input, size: 'M', toppingIds: ['a'] });
  assert.equal(result.cart.items.length, 1); assert.equal(result.cart.items[0].qty, 3); assert.match(renderItems(result.cart), /150\.000/);
});
test('unchanged edit does not merge own quantity; malformed money and API errors rejected', async () => {
  assert(api.sameConfiguration({ ...item, toppings: [{ id: 'b' }, { id: 'a' }] }, { ...input, size: 'M', toppingIds: ['A', 'B'] }));
  assert.throws(() => api.parseCart({ ...cart, subtotal: 1.5 }));
  globalThis.fetch = async () => Response.json(cart); signIn(); const calls = [];
  globalThis.fetch = async (_url, options) => { calls.push(options.method); return Response.json(cart); };
  await api.editCartItem(item, { ...input, size: 'M', toppingIds: ['a'] }); assert.deepEqual(calls, ['GET']);
  globalThis.fetch = async () => new Response('', { status: 401 }); await assert.rejects(api.cartRequest(), { code: 'UNAUTHORIZED' }); assert.equal(useAuthStore.getState().accessToken, null);
});

test('cart summary shows server total and only enables checkout without a blocking reason', () => {
  const { CartSummary } = require('../src/components/cart-view.tsx');
  const ready = renderToStaticMarkup(React.createElement(CartSummary, { cart, reason: '' }));
  assert.match(ready, /100\.000/); assert.match(ready, /href="\/checkout"/);
  for (const reason of ['Thêm đồ uống để tiếp tục.', 'Đang cập nhật giỏ hàng…', 'Hãy lưu hoặc hủy chỉnh sửa trước khi tiếp tục.', 'Hãy chỉnh sửa hoặc xóa món hiện không thể đặt.']) {
    const html = renderToStaticMarkup(React.createElement(CartSummary, { cart, reason }));
    assert.match(html, /disabled/); assert(html.includes(reason)); assert.doesNotMatch(html, /href="\/checkout"/);
  }
});

test('unavailable item allows edit/delete but disables quantity changes', () => {
  const html = renderItems({ ...cart, items: [{ ...item, available: false }] });
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-label="Giảm Latte" disabled/); assert.match(html, /aria-label="Tăng Latte" disabled/);
  assert.doesNotMatch(html, /aria-label="Chỉnh sửa Latte" disabled/); assert.doesNotMatch(html, /aria-label="Xóa Latte" disabled/);
});

test('delete confirmation identifies the complete configuration and keeps actions enabled', () => {
  const { CartRemoveConfirmation } = require('../src/components/cart-remove-confirmation.tsx');
  const html = renderToStaticMarkup(React.createElement(CartRemoveConfirmation, { item, busy: false, onCancel() {}, onConfirm() {} }));
  for (const text of ['Latte', 'Size M', 'Kem', 'Số lượng: 2', 'Giữ lại', 'Xóa món', 'Toàn bộ số lượng']) assert(html.includes(text));
  assert.doesNotMatch(html, /disabled/);
});

test('delete in progress disables both actions and product names are escaped', () => {
  const { CartRemoveConfirmation } = require('../src/components/cart-remove-confirmation.tsx');
  const html = renderToStaticMarkup(React.createElement(CartRemoveConfirmation, { item: { ...item, productName: '<script>bad</script>', toppings: [] }, busy: true, onCancel() {}, onConfirm() {} }));
  assert.equal((html.match(/disabled=""/g) || []).length, 2);
  assert.match(html, /Đang xóa/); assert.match(html, /Không topping/);
  assert.doesNotMatch(html, /<script>/); assert.match(html, /&lt;script&gt;/);
});

test('stock warning uses combined demand across all configurations and still permits reducing quantity', () => {
  const html = renderItems({...cart, items: [{...item, stock: 3, requestedQuantity: 5}]});
  for (const text of ['5', '3', 'qua các size/topping', 'Hãy giảm số lượng']) assert(html.includes(text));
  assert.doesNotMatch(html, /aria-label="Giảm Latte" disabled/);
});

test('active-order lock disables every Cart item mutation control', () => {
  const html = renderToStaticMarkup(React.createElement(CartItems, {cart, locked:true, onQuantity(){},onEdit(){},onRemove(){}}));
  for(const label of ['Giảm Latte','Tăng Latte','Chỉnh sửa Latte','Xóa Latte']) assert(html.includes(`aria-label="${label}" disabled`));
});

for (const state of ['checking', 'error', 'order', 'ready']) test(`product add button explains ${state} without showing an in-progress cart write`, () => {
  signIn();
  const pending = require('../src/components/pending-order.tsx');
  const original = pending.useCartLock;
  const auth = require('../src/lib/auth-store.ts'), originalStore = auth.useAuthStore;
  auth.useAuthStore = Object.assign(selector => selector(originalStore.getState()), originalStore);
  const order = { id: 'pending-id', orderCode: 'BL-pending' };
  pending.useCartLock = () => ({ checking: state === 'checking', error: state === 'error',
    order: state === 'order' ? order : null, locked: state !== 'ready', retry() {} });
  try {
    const { AddToCart } = require('../src/components/add-to-cart.tsx');
    const html = renderToStaticMarkup(React.createElement(AddToCart, { product: {
      id: 'product', name: 'Drink', price: '100', available: true, sizes: [{ size: 'S', extraPrice: '0' }], toppings: [],
    } }));
    assert(!html.includes('Đang xử lý'));
    if (state === 'checking') { assert(html.includes('Đang kiểm tra đơn')); assert(html.includes('10 giây')); }
    if (state === 'error') { assert(html.includes('role="alert"')); assert(html.includes('Thử lại')); }
    if (state === 'order') { assert(html.includes('BL-pending')); assert(html.includes('/checkout?orderId=pending-id')); }
    if (state === 'ready') { assert(!html.includes('disabled')); assert(html.includes('Thêm vào giỏ')); }
    else assert.match(html, /class="button cart-confirm" disabled/);
  } finally { pending.useCartLock = original; auth.useAuthStore = originalStore; }
});

test('a genuine add request still displays progress and disables the options', () => {
  const { CartOptions } = require('../src/components/cart-options.tsx');
  const html = renderToStaticMarkup(React.createElement(CartOptions, { product: {
    id: 'product', price: '100', available: true, sizes: [{ size: 'S', extraPrice: '0' }], toppings: [],
  }, busy: true, label: 'Thêm vào giỏ', onConfirm() {} }));
  assert(html.includes('Đang xử lý')); assert.match(html, /class="button cart-confirm" disabled/);
});

test('active-order check has a ten-second deadline and preserves caller cancellation', async t => {
  signIn();
  const { activeOrder } = require('../src/components/pending-order.tsx');
  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', milliseconds => { assert.equal(milliseconds, 10000); return deadline.signal; });
  globalThis.fetch = async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const request = activeOrder();
  deadline.abort(new DOMException('Deadline exceeded', 'TimeoutError'));
  await assert.rejects(request, { name: 'TimeoutError' });
  assert.equal(useAuthStore.getState().accessToken, 'fixture');
  const unmount = new AbortController();
  t.mock.restoreAll();
  const next = activeOrder(unmount.signal);
  unmount.abort(); await assert.rejects(next, { name: 'AbortError' });
});

test('slow active-order read survives polling ticks; failed read can recover without overlapping requests', async t => {
  signIn();
  // Exercise the real hook effect with controlled lifecycle and clock callbacks.
  // Keep requests pending across multiple polling ticks, without wall-clock sleeps.
  const slots = [], effects = [], events = new Map(); let cursor = 0, poll;
  const hooks = {
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useEffect(effect) { effects.push(effect); },
  };
  const originalWindow = globalThis.window;
  globalThis.window = { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  t.mock.method(globalThis, 'setInterval', fn => { poll = fn; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  const fromPending = createRequire(new URL('../src/components/pending-order.tsx', import.meta.url));
  const compiled = ts.transpileModule(readFileSync(new URL('../src/components/pending-order.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(loaded, loaded.exports, name => name === 'react' ? hooks
    : name === '../lib/auth-store' ? { getAccessToken: () => useAuthStore.getState().accessToken,
      useAuthStore: Object.assign(selector => selector(useAuthStore.getState()), { getState: useAuthStore.getState }) }
    : fromPending(name));
  const requests = [];
  globalThis.fetch = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
  const render = () => { cursor = 0; return loaded.exports.useCartLock(); };
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  let cleanup;
  try {
    assert.equal(render().locked, true); cleanup = effects[0]();
    poll(); poll(); events.get('focus')();
    assert.equal(requests.length, 1, 'poll/focus must not supersede the slow request');
    requests[0].resolve(Response.json({ order: null })); await flush();
    assert.equal(render().locked, false, 'a result slower than the polling interval must still unlock');
    poll(); assert.equal(requests.length, 2);
    requests[1].reject(new DOMException('Deadline exceeded', 'TimeoutError')); await flush();
    assert.equal(render().error, true); assert.equal(render().locked, true);
    poll(); assert.equal(requests.length, 3);
    requests[2].resolve(Response.json({ order: null })); await flush();
    assert.equal(render().error, false); assert.equal(render().locked, false);
  } finally { cleanup?.(); globalThis.window = originalWindow; }
});
