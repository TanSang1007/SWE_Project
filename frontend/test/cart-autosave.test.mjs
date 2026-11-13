import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const {useAuthStore} = require('../src/lib/auth-store.ts');
const {useCartStore: store} = require('../src/lib/cart-store.ts');
const originalFetch = globalThis.fetch;
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
const item = {id: 'one', productId: 'p', productName: 'Latte', imageUrl: '', available: true, size: 'S', qty: 1,
  unitPrice: '10000', lineTotal: '10000', toppings: [], stock: 5, requestedQuantity: 1};
function cart(qty = 1, secondQty = 1) {
  return {items: [{...item, qty, lineTotal: String(qty * 10000), requestedQuantity: qty + secondQty},
    {...item, id: 'two', size: 'M', qty: secondQty, lineTotal: String(secondQty * 10000), requestedQuantity: qty + secondQty}],
  subtotal: String((qty + secondQty) * 10000), totalQuantity: qty + secondQty, currency: 'VND'};
}
async function setup() {
  globalThis.fetch = async () => Response.json(cart());
  useAuthStore.getState().signIn({accessToken: 'fixture', expiresIn: 3600,
    user: {id: 'user', role: 'CUSTOMER', email: 'fixture@example.invalid', loyaltyPoints: 0}});
  await store.getState().load();
}
const tick = () => new Promise(resolve => setImmediate(resolve));
afterEach(() => { useAuthStore.getState().clear(); globalThis.fetch = originalFetch; });
test('rapid clicks update qty/BigInt subtotal/demand immediately and send only the last qty', async () => {
  await setup(); const calls = [];
  globalThis.fetch = async (_url, options) => {calls.push(options); return Response.json(cart(JSON.parse(options.body).qty));};
  for (const qty of [2,3,4,5,6]) store.getState().changeQuantity('one', qty);
  assert.equal(calls.length, 0);
  assert.equal(store.getState().cart.subtotal, '70000');
  assert.equal(store.getState().cart.items[1].requestedQuantity, 7);
  assert.equal(store.getState().saving, true);
  await store.getState().flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), {qty: 6});
  assert.equal(store.getState().saving, false);
});
test('a click while saving is rebased and sent after the first response, never concurrently', async () => {
  await setup(); const calls = []; let respond;
  globalThis.fetch = (_url, options) => {
    calls.push(JSON.parse(options.body).qty);
    if (calls.length === 1) return new Promise(resolve => {respond = resolve;});
    return Promise.resolve(Response.json(cart(4)));
  };
  store.getState().changeQuantity('one', 2); const saving = store.getState().flush(); await tick();
  store.getState().changeQuantity('one', 4);
  assert.deepEqual(calls, [2]);
  respond(Response.json(cart(2))); await saving;
  assert.deepEqual(calls, [2,4]); assert.equal(store.getState().cart.items[0].qty, 4);
});
test('queued changes to two rows retain the other optimistic qty when a server response arrives', async () => {
  await setup(); let serverQty = 1, second = 1; const requests = [];
  globalThis.fetch = async (url, options) => {
    const {qty} = JSON.parse(options.body); requests.push(url);
    if (url.endsWith('/one')) serverQty = qty; else second = qty;
    return Response.json(cart(serverQty, second));
  };
  store.getState().changeQuantity('one', 3); store.getState().changeQuantity('two', 4);
  await store.getState().flush(); assert.equal(requests.length, 2);
  assert.equal(store.getState().cart.subtotal, '70000');
});
test('failed/uncertain writes read authoritative cart, discard unsent changes and block flush until reload', async () => {
  await setup();
  globalThis.fetch = async (_url, options) => options.method === 'PATCH'
    ? Response.json({error:{code:'INVALID_ORDER_STATE'}}, {status:409}) : Response.json(cart());
  store.getState().changeQuantity('one', 4);
  await assert.rejects(store.getState().flush(), {code:'INVALID_ORDER_STATE'});
  assert.equal(store.getState().cart.items[0].qty, 1); assert.equal(store.getState().saving, false);
  await assert.rejects(store.getState().flush(), {code:'INVALID_ORDER_STATE'});
  await store.getState().load(); assert.equal(store.getState().syncError, null);
});
test('logout during save discards old response and cannot leak into the next account', async () => {
  await setup(); let respond;
  globalThis.fetch = () => new Promise(resolve => {respond = resolve;});
  store.getState().changeQuantity('one', 2); const saving = store.getState().flush(); await tick();
  useAuthStore.getState().clear(); respond(Response.json(cart(2))); await saving;
  assert.equal(store.getState().cart, null); assert.equal(store.getState().saving, false);
});
test('out-of-order GET cannot overwrite new local quantity; bounds and missing rows do not queue', async () => {
  await setup(); let respond;
  globalThis.fetch = () => new Promise(resolve => {respond = resolve;});
  const reading = store.getState().load();
  store.getState().changeQuantity('one', 3); respond(Response.json(cart()));
  assert.equal(await reading, false); assert.equal(store.getState().cart.items[0].qty, 3);
  store.getState().cancelPending();
  for (const qty of [0,100,NaN,1.5]) store.getState().changeQuantity('one',qty);
  store.getState().changeQuantity('missing',2);
  assert.equal(store.getState().saving, false);
});
test('cancelling pending changes for an active order prevents the debounced write', async () => {
  await setup(); let count = 0;
  globalThis.fetch = async () => {count++; return Response.json(cart());};
  store.getState().changeQuantity('one', 3); store.getState().cancelPending();
  await store.getState().flush(); assert.equal(count, 0); assert.equal(store.getState().cart.items[0].qty, 1);
});
test('background timer saves without a checkout click', async () => {
  await setup(); const saved = new Promise(resolve => {
    globalThis.fetch = async (_url, options) => {resolve(JSON.parse(options.body).qty); return Response.json(cart(5));};
  });
  store.getState().changeQuantity('one',5);
  assert.equal(await saved,5); await store.getState().flush(); assert.equal(store.getState().saving,false);
});
const {prepareCartCheckout} = require('../src/lib/cart-checkout.ts');
const loyalty = require('../src/lib/api/loyalty-redemption.ts');
const originalPreview = loyalty.previewOrder;
afterEach(() => {loyalty.previewOrder = originalPreview;});
test('checkout flushes pending quantities before previewing saved cart and sends no client prices', async () => {
  await setup(); const steps = []; let server = cart();
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'PATCH') {steps.push('save'); server = cart(JSON.parse(options.body).qty);}
    else steps.push('read');
    return Response.json(server);
  };
  loyalty.previewOrder = async body => {
    steps.push('preview'); assert.equal(body.items[0].qty,4);
    assert.deepEqual(Object.keys(body.items[0]).sort(),['productId','qty','size','toppingIds']);
    return {itemSubtotal: '50000'};
  };
  store.getState().changeQuantity('one',4);
  await prepareCartCheckout(async () => {steps.push('active'); return false;});
  assert.deepEqual(steps,['save','active','read','preview']);
});
test('checkout rejects changed prices and stays rejected on invalid stock/options', async () => {
  await setup();
  globalThis.fetch = async () => Response.json({...cart(), items: cart().items.map(i => ({...i,unitPrice:'12000',lineTotal:'12000'})),subtotal:'24000'});
  loyalty.previewOrder = async () => ({itemSubtotal:'24000'});
  await assert.rejects(prepareCartCheckout(async () => false),{code:'CART_CHANGED'});
  const {OrderError} = require('../src/lib/api/orders.ts');
  loyalty.previewOrder = async () => {throw new OrderError('OUT_OF_STOCK');};
  await assert.rejects(prepareCartCheckout(async () => false),{code:'OUT_OF_STOCK'});
});
test('active order blocks checkout before preview; failed saving never reaches preview', async () => {
  await setup(); let previews = 0;
  loyalty.previewOrder = async () => {previews++; return {itemSubtotal:'20000'};};
  await assert.rejects(prepareCartCheckout(async () => true),{code:'INVALID_ORDER_STATE'});
  assert.equal(previews,0);
  globalThis.fetch = async (_url,options) => options.method === 'PATCH'
    ? Response.json({error:{code:'INVALID_ORDER_STATE'}},{status:409}) : Response.json(cart());
  store.getState().changeQuantity('one',3);
  await assert.rejects(prepareCartCheckout(async () => false),{code:'INVALID_ORDER_STATE'});
  assert.equal(previews,0);
});
test('two simultaneous flush callers share the same save and do not duplicate a write', async () => {
  await setup(); let respond, count = 0;
  globalThis.fetch = () => {count++; return new Promise(resolve => {respond = resolve;});};
  store.getState().changeQuantity('one',2);
  const one = store.getState().flush(), two = store.getState().flush(); await tick();
  assert.equal(count,1); respond(Response.json(cart(2))); await Promise.all([one,two]);
  assert.equal(store.getState().saving,false);
});
test('optimistic monetary overflow is rejected locally without rendering invalid money', async () => {
  await setup(); const huge = {...cart(), items: [{...item,unitPrice:'999999999999',lineTotal:'999999999999'}], subtotal:'999999999999',totalQuantity:1};
  store.getState().setCart(huge); store.getState().changeQuantity('one',2);
  assert.equal(store.getState().cart.subtotal,'999999999999');
  assert.equal(store.getState().syncError.code,'VALIDATION_ERROR');
  assert.equal(store.getState().saving,false);
});
test('a row removed elsewhere during saving is reconciled without silently retaining a ghost draft', async () => {
  await setup(); let respond; const empty = {items:[],subtotal:'0',totalQuantity:0,currency:'VND'};
  globalThis.fetch = async (_url,options) => options.method === 'PATCH'
    ? new Promise(resolve => {respond = resolve;}) : Response.json(empty);
  store.getState().changeQuantity('one',2); const saving = store.getState().flush(); await tick();
  store.getState().changeQuantity('one',4); respond(Response.json(empty));
  await assert.rejects(saving,{code:'CART_CHANGED'});
  assert.equal(store.getState().cart.items.length,0); assert.equal(store.getState().syncError.code,'CART_CHANGED');
});
test('a server price increase during a newer draft cannot overflow the displayed VND total', async () => {
  await setup(); let respond;
  const repriced = {...cart(), items:[{...item,qty:2,requestedQuantity:2,unitPrice:'400000000000',lineTotal:'800000000000'}],totalQuantity:2,subtotal:'800000000000'};
  globalThis.fetch = async (_url,options) => options.method === 'PATCH'
    ? new Promise(resolve => {respond=resolve;}) : Response.json(repriced);
  store.getState().changeQuantity('one',2); const saving=store.getState().flush(); await tick();
  store.getState().changeQuantity('one',3); respond(Response.json(repriced));
  await assert.rejects(saving,{code:'VALIDATION_ERROR'});
  assert.equal(store.getState().cart.subtotal,'800000000000');
});
