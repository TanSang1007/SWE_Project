import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url); const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { paymentRequest, parsePayment } = require('../src/lib/api/payments.ts');
const context = require('../src/lib/payment-context.ts'); const { useAuthStore } = require('../src/lib/auth-store.ts');
const originalFetch = globalThis.fetch; const originalStorage = globalThis.sessionStorage;
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
const id = '11111111-1111-4111-8111-111111111111';
const result = { payment: { id, orderId: id, status: 'SUCCEEDED', amount: '80001', method: 'WALLET' }, order: { id, orderCode: 'BL-test', status: 'PAID' }, loyalty: { awardedPoints: 8 } };
const payload = { orderId: id, method: 'WALLET' };
function login() { useAuthStore.getState().signIn({ accessToken: 'test-only', expiresIn: 3600, user: { id, email: 'test@example.invalid', loyaltyPoints: 0, role: 'CUSTOMER' } }); }
afterEach(() => { globalThis.fetch = originalFetch; globalThis.sessionStorage = originalStorage; useAuthStore.getState().clear(); });
test('payment sends only order/method with JWT/key and retries identical payload', async () => {
  const calls = []; globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json(result); }; login();
  await paymentRequest(payload, 'same-key'); await paymentRequest(payload, 'same-key');
  for (const c of calls) { assert.equal(c.url, 'http://example.invalid/payments'); assert.equal(c.options.headers['Idempotency-Key'], 'same-key'); assert.equal(c.options.headers.Authorization, 'Bearer test-only'); assert.deepEqual(JSON.parse(c.options.body), payload); }
});
test('HTTP200 FAILED is a decline with zero loyalty, not success', async () => {
  const failed = { ...result, payment: { ...result.payment, status: 'FAILED', failureCode: 'MOCK_DECLINED' }, order: { ...result.order, status: 'PAYMENT_FAILED' }, loyalty: { awardedPoints: 0 } };
  globalThis.fetch = async () => Response.json(failed); login(); assert.equal((await paymentRequest(payload, 'key')).payment.status, 'FAILED');
  assert.throws(() => parsePayment({ ...failed, loyalty: { awardedPoints: 8 } }));
});
test('parser rejects contradictory order/payment and numeric/noninteger money/points', () => {
  assert.throws(() => parsePayment({ ...result, order: { ...result.order, status: 'PENDING' } }));
  assert.throws(() => parsePayment({ ...result, payment: { ...result.payment, amount: 80001 } }));
  assert.throws(() => parsePayment({ ...result, loyalty: { awardedPoints: 1.5 } }));
  assert.throws(() => parsePayment({ ...result, payment: { ...result.payment, failureCode: 'MOCK_DECLINED' } }));
  assert.deepEqual(parsePayment({ ...result, token: 'private' }), result);
});
test('transport uncertainty remains retryable; 503 is not business decline; 401 clears auth', async () => {
  login(); globalThis.fetch = async () => { throw new Error('private fault'); }; await assert.rejects(paymentRequest(payload, 'key'), { code: 'UNAVAILABLE' });
  globalThis.fetch = async () => Response.json({ error: { code: 'PAYMENT_UNAVAILABLE' } }, { status: 503 }); await assert.rejects(paymentRequest(payload, 'key'), { code: 'PAYMENT_UNAVAILABLE' });
  globalThis.fetch = async () => new Response('', { status: 401 }); await assert.rejects(paymentRequest(payload, 'key'), { code: 'UNAUTHORIZED' }); assert.equal(useAuthStore.getState().accessToken, null);
});
for (const code of ['OUT_OF_STOCK', 'CONCURRENT_UPDATE', 'ORDER_ALREADY_PAID', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_ORDER_STATE']) test(`payment preserves backend error ${code}`, async () => {
  login(); globalThis.fetch = async () => Response.json({ error: { code } }, { status: 409 }); await assert.rejects(paymentRequest(payload, 'key'), { code });
});
test('mismatched response order/method rejected', async () => {
  login(); globalThis.fetch = async () => Response.json({ ...result, payment: { ...result.payment, method: 'CARD' } }); await assert.rejects(paymentRequest(payload, 'key'), { code: 'UNAVAILABLE' });
});
test('payment context isolates user and stores no JWT; uncertain context survives reread', () => {
  const data = new Map(); globalThis.sessionStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const attempt = { userId: id, key: 'key', payload }; context.writePaymentContext(attempt); assert.deepEqual(context.readPaymentContext(id), attempt); assert.deepEqual(context.readPaymentContext(id), attempt);
  assert(![...data.values()].join('').includes('accessToken')); assert.equal(context.readPaymentContext('other'), null); assert.equal(data.size, 0);
});
test('storage write failure prevents persisting a new attempt; malformed context discarded', () => {
  globalThis.sessionStorage = { getItem: () => JSON.stringify({ userId: id, key: 'key', payload: { orderId: id, method: 'CASH' } }), removeItem() {}, setItem() { throw new Error('storage blocked'); } };
  assert.equal(context.readPaymentContext(id), null); assert.throws(() => context.writePaymentContext({ userId: id, key: 'key', payload }));
});
