import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url), ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const api = require('../src/lib/api/gateway-payments.ts');
const ctx = require('../src/lib/gateway-context.ts');
const { pollPayment, paymentMessage } = require('../src/lib/payment-result.ts');
const { navigateAfterCancellation, useCancellationNotice } = require('../src/lib/cancellation-notice.ts');
const { CancellationNoticeContent } = require('../src/components/cancellation-notice.tsx');
const { PaymentAdmissionNotice } = require('../src/components/payment-admission-notice.tsx');
const { safeReturnTo } = require('../src/lib/auth-validation.ts');
const { useAuthStore } = require('../src/lib/auth-store.ts');
const { PaymentResult, PaymentResultContent } = require('../src/components/payment-result.tsx');
const { GatewayCheckout } = require('../src/components/gateway-checkout.tsx');
const { OrderDetailContent } = require('../src/components/order-history-view.tsx');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const pending = { attemptId: id, orderId: other, provider: 'VNPAY_SANDBOX', amount: '85000', currency: 'VND', effectiveState: 'AWAITING',
  applicationState: 'PENDING', orderStatus: 'PENDING', paymentId: null, canResume: true, canRetry: false, canCancel: false, requiresReview: false };
const order = { id: other, total: '85000', status: 'PENDING' };
const saved = { userId: id, orderId: other, key: 'same-intent' };
const url = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_SecureHash=synthetic';
const originalFetch = globalThis.fetch, originalStorage = globalThis.sessionStorage;
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
function login(user = id) { useAuthStore.getState().signIn({ accessToken: 'synthetic-' + user, expiresIn: 3600, user: { id: user, role: 'CUSTOMER', email: 'fixture@example.invalid', loyaltyPoints: 0 } }); }
afterEach(() => { globalThis.fetch = originalFetch; globalThis.sessionStorage = originalStorage; useAuthStore.getState().clear(); });
test('verified cancellation API result navigates Home and displays session-bound notification/order link', async () => {
  login();
  const cancelled = { ...pending, effectiveState: 'FAILED', applicationState: 'APPLIED', paymentId: id, orderStatus: 'CANCELLED', failureReason: 'CUSTOMER_CANCELLED', canResume: false };
  globalThis.fetch = async () => Response.json(cancelled);
  const status = await api.attemptStatus(id), destinations = [];
  assert(navigateAfterCancellation(status, useAuthStore.getState().accessToken, p => destinations.push(p)));
  assert.deepEqual(destinations, ['/']);
  const html = renderToStaticMarkup(React.createElement(CancellationNoticeContent, { token: useAuthStore.getState().accessToken, notice: useCancellationNotice.getState().notice }));
  assert(html.includes('Bạn đã hủy giao dịch VNPAY')); assert(html.includes(`/orders/${other}/confirmation`));
  login(other); assert.equal(renderToStaticMarkup(React.createElement(CancellationNoticeContent, { token: useAuthStore.getState().accessToken, notice: useCancellationNotice.getState().notice })), '');
  useCancellationNotice.setState({ notice: null });
});
test('untrusted query-style cancellation, unresolved states and generic FAILED never navigate as cancellation', () => {
  const failed = { ...pending, effectiveState: 'FAILED', applicationState: 'APPLIED', paymentId: id };
  for (const status of [pending, { ...pending, effectiveState: 'UNKNOWN' }, { ...pending, effectiveState: 'REVIEW', requiresReview: true }, failed,
    { ...pending, failureReason: 'CUSTOMER_CANCELLED' }, { ...failed, failureReason: 'CUSTOMER_CANCELLED', requiresReview: true }, { vnp_ResponseCode: '24' }]) {
    assert.equal(navigateAfterCancellation(status, 'fixture', assert.fail), false);
  }
  assert.equal(paymentMessage(failed), 'Thanh toán không thành công.');
  for (const effectiveState of ['AWAITING', 'UNKNOWN', 'REVIEW']) assert.throws(() => api.parseAttempt({ ...pending, effectiveState, failureReason: 'CUSTOMER_CANCELLED' }));
});
test('CLOSED admission explains disabled checkout; OPEN does not display a closure claim', () => {
  const html = renderToStaticMarkup(React.createElement(PaymentAdmissionNotice, { closed: true }));
  assert(html.includes('Thanh toán VNPAY hiện đang tạm ngừng nhận giao dịch mới.')); assert(html.includes('role="status"'));
  assert.equal(renderToStaticMarkup(React.createElement(PaymentAdmissionNotice, { closed: false })), '');
});
test('future OPEN config permits a new pending checkout; cancelled Order is never resumed or retried', async () => {
  login(); globalThis.fetch = async () => Response.json({ providerMode: 'VNPAY_SANDBOX' });
  assert.equal((await api.paymentConfiguration()).acceptingNewPayments, true);
  const cancelled = { ...pending, effectiveState: 'FAILED', applicationState: 'APPLIED', paymentId: id, orderStatus: 'CANCELLED', canResume: false, canRetry: false };
  assert.equal(ctx.gatewayPermission({ ...order, status: 'CANCELLED' }, cancelled, saved), false);
  const newOrder = { ...order, id: '33333333-3333-4333-8333-333333333333' };
  assert.equal(ctx.gatewayPermission(newOrder, null, null), true);
  const fresh = ctx.nextGatewayIntent(id, newOrder, null, null);
  assert.equal(fresh.orderId, newOrder.id); assert.notEqual(fresh.key, saved.key);
});
test('config requires JWT and exactly one validated mode field', async () => {
  await assert.rejects(api.paymentConfig(), { code: 'UNAUTHORIZED' }); login();
  for (const providerMode of ['MOCK', 'VNPAY_SANDBOX']) { globalThis.fetch = async () => Response.json({ providerMode }); assert.equal(await api.paymentConfig(), providerMode); }
  for (const v of [{}, { providerMode: 'INVALID' }, { providerMode: 'MOCK', secret: 'private' }, null]) {
    globalThis.fetch = async () => Response.json(v); await assert.rejects(api.paymentConfig(), { code: 'UNAVAILABLE' });
  }
});
test('config503/network errors never select MOCK; request is private/no-store', async () => {
  login(); let calls = 0;
  globalThis.fetch = async (u, o) => { calls++; assert.equal(u, 'http://example.invalid/payments/config'); assert.equal(o.cache, 'no-store'); assert.equal(o.credentials, 'omit'); assert(o.headers.Authorization); return Response.json({ error: { code: 'PAYMENT_UNAVAILABLE' } }, { status: 503 }); };
  await assert.rejects(api.paymentConfig(), { code: 'PAYMENT_UNAVAILABLE' }); assert.equal(calls, 1);
  globalThis.fetch = async () => { throw Error('network timeout'); }; await assert.rejects(api.paymentConfig(), { code: 'UNAVAILABLE' });
});
test('drain config extends VNPAY hint without selecting MOCK or exposing merchant settings', async () => {
  login(); globalThis.fetch = async () => Response.json({ providerMode: 'VNPAY_SANDBOX', acceptingNewPayments: false });
  assert.deepEqual(await api.paymentConfiguration(), { providerMode: 'VNPAY_SANDBOX', acceptingNewPayments: false });
  assert.equal(await api.paymentConfig(), 'VNPAY_SANDBOX');
});
test('invalid admission hints fail closed instead of silently enabling new payments', async () => {
  login();
  for (const v of [{ providerMode: 'VNPAY_SANDBOX', acceptingNewPayments: 'false' }, { providerMode: 'MOCK', acceptingNewPayments: false }, { providerMode: 'VNPAY_SANDBOX', secret: 'private' }]) {
    globalThis.fetch = async () => Response.json(v); await assert.rejects(api.paymentConfiguration(), { code: 'UNAVAILABLE' });
  }
});
test('initiation sends orderId only, stable key, no bank/amount/provider/outcome', async () => {
  login(); const calls = []; globalThis.fetch = async (u, o) => { calls.push({ u, o }); return Response.json({ attemptId: id, orderId: other, provider: 'VNPAY_SANDBOX', state: 'AWAITING', paymentUrl: url }); };
  await api.initiatePayment(other, saved.key); await api.initiatePayment(other, saved.key);
  for (const { u, o } of calls) { assert(u.endsWith('/payments/vnpay/attempts')); assert.deepEqual(JSON.parse(o.body), { orderId: other }); assert.equal(o.headers['Idempotency-Key'], saved.key); }
});
for (const bad of ['https://evil.example/paymentv2/vpcpay.html?a=1', 'http://sandbox.vnpayment.vn/paymentv2/vpcpay.html?a=1',
  'https://sandbox.vnpayment.vn.evil.example/paymentv2/vpcpay.html?a=1', 'https://sandbox.vnpayment.vn/other?a=1',
  'https://user:pass@sandbox.vnpayment.vn/paymentv2/vpcpay.html?a=1', url + '#redirect', 'javascript:alert(1)', '//sandbox.vnpayment.vn/paymentv2/vpcpay.html?a=1']) test('gateway navigation rejects ' + bad, () => assert.throws(() => api.authorizedGatewayUrl(bad)));
test('zero confirmation uses only owned route, empty body/key and authoritative INTERNAL_ZERO result', async () => {
  login(); globalThis.fetch = async (u, o) => { assert(u.endsWith('/orders/' + other + '/confirm-zero')); assert.deepEqual(JSON.parse(o.body), {}); assert.equal(o.headers['Idempotency-Key'], saved.key);
    return Response.json({ payment: { orderId: other, provider: 'INTERNAL_ZERO', method: 'ZERO_TOTAL', amount: '0', status: 'SUCCEEDED' }, order: { id: other, status: 'PAID' }, loyalty: { awardedPoints: 0 } }); };
  assert.equal((await api.confirmZero(other, saved.key)).order.status, 'PAID');
  globalThis.fetch = async () => Response.json({ order: { status: 'PAID' } }); await assert.rejects(api.confirmZero(other, saved.key), { code: 'UNAVAILABLE' });
});
test('network timeout/replay preserves exact intent; no key replacement for uncertain result', () => {
  assert.equal(ctx.nextGatewayIntent(id, order, null, saved), saved);
  assert.equal(ctx.nextGatewayIntent(id, order, pending, saved), saved);
  for (const state of ['UNKNOWN', 'REVIEW']) assert.equal(ctx.gatewayPermission(order, { ...pending, effectiveState: state, canRetry: true, canResume: true }, saved), false);
  assert(ctx.gatewayPermission(order, pending, saved)); assert(ctx.gatewayPermission(order, pending, null)); // Backend resume restores the existing URL without a stored key.
});
test('new intent only for explicit backend-authorized terminal retry, zero is separate', () => {
  const failed = { ...pending, effectiveState: 'FAILED', canRetry: true, applicationState: 'APPLIED', paymentId: other };
  assert(ctx.gatewayPermission(order, failed, saved));
  const known = { ...saved, attemptId: id }; assert.notEqual(ctx.nextGatewayIntent(id, order, failed, known).key, known.key);
  assert.equal(ctx.nextGatewayIntent(id, order, failed, saved).key, saved.key); // Network outcome without ID must replay first.
  assert.equal(ctx.nextGatewayIntent(id, { ...order, total: '0' }, null, null).orderId, other);
  assert(!ctx.gatewayPermission({ ...order, total: '0' }, pending, null));
  assert(!ctx.gatewayPermission({ ...order, total: '0', status: 'PAYMENT_FAILED' }, null, null));
});
test('session context stores only P00 owner/order/key/attempt; no signed URL/JWT; account isolation', () => {
  const m = new Map(); globalThis.sessionStorage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) };
  ctx.writeGatewayContext({ ...saved, attemptId: id, accessToken: 'do-not-store', paymentUrl: url });
  assert.deepEqual(ctx.readGatewayContext(id, other), { ...saved, attemptId: id });
  assert(![...m.values()].join('').match(/do-not-store|paymentUrl|SecureHash/));
  assert.equal(ctx.readGatewayContext(other, other), null); assert.equal(m.size, 0);
});
test('storage failure blocks creating request context', () => {
  globalThis.sessionStorage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.throws(() => ctx.readGatewayContext(id, other)); assert.throws(() => ctx.writeGatewayContext(saved));
});
for (const state of ['AWAITING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'REVIEW']) test('result renders authoritative ' + state, () => {
  const a = { ...pending, effectiveState: state, ...(state === 'REVIEW' ? { requiresReview: true } : {}) };
  const html = renderToStaticMarkup(React.createElement(PaymentResultContent, { status: a })); assert(html.includes(paymentMessage(a)));
  if (['UNKNOWN', 'REVIEW', 'AWAITING'].includes(state)) { assert(!html.includes('Thanh toán thành công')); assert(!html.includes('thanh toán lại</a>')); }
});
test('paid cancellation separates payment success from cancelled Order and no refund claim', () => {
  const html = renderToStaticMarkup(React.createElement(PaymentResultContent, { status: { ...pending, effectiveState: 'SUCCEEDED', orderStatus: 'CANCELLED' } }));
  assert(html.includes('Thanh toán thành công.')); assert(html.includes('BrewLite chưa tự hoàn tiền'));
});
test('success parser rejects Return-style or unapplied/unpaid contradictory evidence', () => {
  assert.throws(() => api.parseAttempt({ vnp_ResponseCode: '00' }));
  assert.throws(() => api.parseAttempt({ ...pending, effectiveState: 'SUCCEEDED' }));
  assert.throws(() => api.parseAttempt({ ...pending, effectiveState: 'SUCCEEDED', applicationState: 'APPLIED', paymentId: id }));
  assert.equal(api.parseAttempt({ ...pending, effectiveState: 'SUCCEEDED', applicationState: 'APPLIED', paymentId: id, orderStatus: 'PAID' }).effectiveState, 'SUCCEEDED');
});
test('lost/expired session shows login only; opaque ID alone reveals no Order details', () => {
  const html = renderToStaticMarkup(React.createElement(PaymentResult, { attemptId: id })); assert(html.includes('Đăng nhập để kiểm tra')); assert(!html.includes(other));
  const invalid = renderToStaticMarkup(React.createElement(PaymentResult)); assert(invalid.includes('Không có thông tin thanh toán hợp lệ'));
});
test('returnTo only exact internal result route plus UUID; rejects arbitrary gateway query', () => {
  const valid = '/payments/vnpay/result?attemptId=' + id; assert.equal(safeReturnTo(valid), valid);
  for (const x of [valid + '&vnp_ResponseCode=00', '/payments/vnpay/result?attemptId=https://evil.example', '/payments/evil', '//evil.example', 'https://evil.example']) assert.equal(safeReturnTo(x), '/');
});
test('status ownership401/403/404 errors remain generic; no anonymous GET; token expiry clears auth', async () => {
  login(); for (const [status, code] of [[403, 'FORBIDDEN'], [404, 'PAYMENT_ATTEMPT_NOT_FOUND'], [401, 'UNAUTHORIZED']]) {
    globalThis.fetch = async () => Response.json({ error: { code } }, { status }); await assert.rejects(api.attemptStatus(id), { code });
  }
  assert.equal(useAuthStore.getState().accessToken, null);
  login(); useAuthStore.setState({ expiresAt: Date.now() - 1 }); await assert.rejects(api.attemptStatus(id), { code: 'UNAUTHORIZED' });
});
test('late status response after account switch is discarded', async () => {
  login(); globalThis.fetch = async () => { login(other); return Response.json(pending); }; await assert.rejects(api.attemptStatus(id), { code: 'UNAUTHORIZED' });
});
test('gateway/zero markup has semantic disabled controls and no Mock selector', () => {
  for (const total of ['85000', '0']) { const html = renderToStaticMarkup(React.createElement(GatewayCheckout, { order: { ...order, total }, disabled: false, onBusy() {}, async onConfirmed() {}, async onCancel() {} }));
    assert(!html.includes('<select')); assert(html.includes('aria-busy="true"')); assert(html.includes(total === '0' ? 'Xác nhận đơn 0 VND' : '>Thanh toán</button>')); assert(!html.includes('vnp_BankCode'));
  }
});
test('confirmation separates historical FAILED from current pending retry and links owned result', () => {
  const detail = { ...order, orderCode: 'BL-fixture', currency: 'VND', createdAt: '2026-10-18T00:00:00Z', subtotal: '85000', discountAmount: '0', promotionCode: null,
    items: [], paidAt: null, earnedPoints: null, paymentStatus: 'FAILED' };
  const html = renderToStaticMarkup(React.createElement(OrderDetailContent, { order: detail, attempt: pending }));
  assert(html.includes('Kết quả thanh toán cục bộ gần nhất')); assert(html.includes('Đang xác minh kết quả thanh toán.'));
  assert(html.includes('/payments/vnpay/result?attemptId=' + id)); assert(!html.includes('Thanh toán không thành công.'));
});
function clock() {
  let now = 0, next = 0, visible = true; const queue = new Map();
  return { runtime: { now: () => now, visible: () => visible, schedule: (f, ms) => { const k = ++next; queue.set(k, { f, at: now + ms }); return k; }, cancel: k => queue.delete(k) },
    hide: () => { visible = false; }, size: () => queue.size,
    async advance(ms) { const until = now + ms; for (;;) { const entry = [...queue].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!entry) break; now = entry[1].at; queue.delete(entry[0]); entry[1].f(); await Promise.resolve(); await Promise.resolve(); } now = until; } };
}
test('polling is bounded3s/60s with serial GETs; timeout never FAILED', async () => {
  const c = clock(); let reads = 0, end = 0; const states = [];
  const stop = pollPayment(async () => { reads++; return pending; }, a => states.push(a.effectiveState), assert.fail, () => end++, c.runtime);
  await Promise.resolve(); await c.advance(65000); assert.equal(reads, 20); assert.equal(end, 1); assert(states.every(x => x === 'AWAITING')); assert.equal(c.size(), 0); stop();
});
for (const state of ['SUCCEEDED', 'FAILED', 'UNKNOWN', 'REVIEW']) test('polling stops on ' + state, async () => {
  const c = clock(); let reads = 0; pollPayment(async () => { reads++; return { ...pending, effectiveState: state }; }, () => {}, assert.fail, assert.fail, c.runtime);
  await Promise.resolve(); await c.advance(65000); assert.equal(reads, 1); assert.equal(c.size(), 0);
});
test('hidden tab pauses reads but deadline remains bounded', async () => {
  const c = clock(); c.hide(); let reads = 0, end = 0; pollPayment(async () => { reads++; return pending; }, () => {}, assert.fail, () => end++, c.runtime);
  await c.advance(65000); assert.equal(reads, 0); assert.equal(end, 1);
});
test('poll cleanup aborts in-flight request and removes timers; no late state or next read', async () => {
  const c = clock(); let resolve, signal, receive = 0;
  const stop = pollPayment(s => { signal = s; return new Promise(r => { resolve = r; }); }, () => receive++, assert.fail, assert.fail, c.runtime);
  stop(); assert(signal.aborted); resolve(pending); await Promise.resolve(); await c.advance(65000); assert.equal(receive, 0); assert.equal(c.size(), 0);
});
test('polling deadline aborts slow request; technical failure stops without FAILED mutation', async () => {
  const c = clock(); let signal, ended = 0;
  pollPayment(s => { signal = s; return new Promise(() => {}); }, assert.fail, assert.fail, () => ended++, c.runtime);
  await c.advance(60000); assert(signal.aborted); assert.equal(ended, 1);
  let errors = 0; const d = clock(); pollPayment(async () => { throw Error('timeout'); }, assert.fail, () => errors++, assert.fail, d.runtime);
  await Promise.resolve(); await d.advance(65000); assert.equal(errors, 1); assert.equal(d.size(), 0);
});
