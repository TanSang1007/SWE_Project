// Frontend-only synthetic HTTP transport + real Edge. Never connects to VNPAY or a DB.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '../..');
const build = resolve(root, process.env.BREWLITE_BROWSER_BUILD_DIR ?? '.tmp/c2-dev-frontend'), origin = 'http://localhost:3200';
assert(existsSync(join(build, '.next/BUILD_ID')), 'Prepare an isolated frontend production build first');
assert(process.env.BROWSER_PATH, 'Configure BROWSER_PATH for the installed Chromium/Edge executable');
const evidencePrefix = process.env.BREWLITE_BROWSER_EVIDENCE_PREFIX ?? 'c2-browser';
assert(/^[a-z0-9-]+$/.test(evidencePrefix));
const owner = randomUUID(), other = randomUUID(), orderId = randomUUID(), attemptId = randomUUID(), productId = randomUUID();
let mode = 'VNPAY_SANDBOX', configFail = false, current = false, outcome = 'AWAITING', statusError = 0;
let loseInitiation = false, loseCreation = false, holdInitiation = false, releaseInitiation;
let zero = false, orderExists = true, orderStatus = 'PENDING', activeOwner = owner;
let rejectMinimum = false;
let acceptingNew = true;
let customerCancelled = false;
const requests = [], checks = [], exceptions = [], gatewayNavigations = [], hydrationWarnings = [];
const total = () => zero ? '0' : '85000';
const snapshot = () => ({ id: orderId, orderCode: 'BL-SYNTHETIC', status: orderStatus, total: total(), subtotal: '85000', discountAmount: zero ? '85000' : '0', promotionCode: zero ? 'ZERO-FIXTURE' : null,
  paidAt: orderStatus === 'PAID' ? '2026-10-18T00:01:00Z' : null, earnedPoints: orderStatus === 'PAID' ? zero ? 0 : 8 : null,
  paymentStatus: orderStatus === 'PAID' ? 'SUCCEEDED' : current ? 'FAILED' : null,
  currency: 'VND', createdAt: '2026-10-18T00:00:00Z', items: [{ productId, productName: 'Synthetic coffee', size: 'S', qty: 1, unitPrice: '85000', lineTotal: '85000', toppings: [] }] });
const status = () => ({ attemptId, orderId, provider: 'VNPAY_SANDBOX', amount: '85000', currency: 'VND', effectiveState: outcome,
  applicationState: ['SUCCEEDED', 'FAILED'].includes(outcome) ? 'APPLIED' : outcome === 'REVIEW' ? 'REVIEW' : 'PENDING',
  orderStatus: outcome === 'SUCCEEDED' ? 'PAID' : outcome === 'FAILED' ? 'PAYMENT_FAILED' : 'PENDING', paymentId: ['SUCCEEDED', 'FAILED'].includes(outcome) ? randomUUID() : null,
  canResume: acceptingNew && outcome === 'AWAITING', canRetry: acceptingNew && outcome === 'FAILED', canCancel: outcome === 'FAILED', requiresReview: outcome === 'REVIEW',
  ...(customerCancelled && outcome === 'FAILED' ? { failureReason:'CUSTOMER_CANCELLED' } : {}) });
const initiation = () => ({ attemptId, orderId, provider: 'VNPAY_SANDBOX', state: 'AWAITING', amount: '85000', currency: 'VND',
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_SecureHash=synthetic-browser-fixture', expiresAt: '2099-01-01T00:00:00Z' });
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const url = new URL(req.url, 'http://localhost:3201'), chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  requests.push({ path: url.pathname, method: req.method, body, key: req.headers['idempotency-key'] });
  const send = (v, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
  const error = (code, http) => send({ error: { code } }, http);
  if (url.pathname === '/auth/login') { activeOwner = body.email.startsWith('other') ? other : owner; return send({ accessToken: 'synthetic-session-' + randomUUID(), tokenType: 'Bearer', expiresIn: 3600, user: { id: activeOwner, role: 'CUSTOMER', email: body.email, loyaltyPoints: 0 } }); }
  if (!req.headers.authorization) return error('UNAUTHORIZED', 401);
  if (url.pathname === '/payments/config') return configFail ? error('PAYMENT_UNAVAILABLE', 503) : send(mode === 'VNPAY_SANDBOX' && !acceptingNew ? { providerMode: mode, acceptingNewPayments: false } : { providerMode: mode });
  if (url.pathname === '/cart') return send({ currency: 'VND', subtotal: '85000', totalQuantity: 1, items: [{ id: randomUUID(), productId, productName: 'Synthetic coffee', imageUrl: '/images/cold-brew.svg', available: true, size: 'S', qty: 1, unitPrice: '85000', lineTotal: '85000', toppings: [] }] });
  if (url.pathname === '/orders/preview') return send({ currency: 'VND', itemSubtotal: '85000', promotionCode: null, promotionDiscount: '0', totalAfterPromotion: '85000', redeemedPoints: 0,
    pointValueVnd: '100', loyaltyDiscount: '0', finalTotal: '85000', earnedPoints: 8, availablePoints: 0, availablePointsAfterReservation: 0, reservedPoints: 0, outstandingReversalPoints: '0', maxRedeemablePoints: 0 });
  if (url.pathname === '/orders' && req.method === 'POST') { assert(req.headers['idempotency-key']); if (rejectMinimum) return error('VNPAY_MINIMUM_AMOUNT_NOT_MET', 422); orderExists = true; if (loseCreation) { loseCreation = false; return error('PAYMENT_UNAVAILABLE', 503); } return send(snapshot(), 201); }
  if (url.pathname === '/orders/' + orderId) return orderExists ? send(snapshot()) : error('ORDER_NOT_FOUND', 404);
  if (url.pathname === '/orders/' + orderId + '/payment-attempts') return send({ current: current ? status() : null, items: current ? [status()] : [], nextCursor: null });
  if (url.pathname === '/payments/vnpay/attempts') {
    assert(!zero); assert.deepEqual(body, { orderId }); assert(req.headers['idempotency-key']); current = true; outcome = 'AWAITING'; orderStatus = 'PENDING';
    if (loseInitiation) { loseInitiation = false; await new Promise(r => setTimeout(r, 5500)); if (!res.destroyed) send(initiation(), 201); return; }
    if (holdInitiation) { await new Promise(r => { releaseInitiation = r; }); holdInitiation = false; }
    return send(initiation(), 201);
  }
  if (url.pathname === '/payments/attempts/' + attemptId) {
    if (activeOwner !== owner) return error('PAYMENT_ATTEMPT_NOT_FOUND', 404);
    if (statusError) return error(statusError === 401 ? 'UNAUTHORIZED' : 'PAYMENT_ATTEMPT_NOT_FOUND', statusError);
    return send(status());
  }
  if (url.pathname === '/orders/' + orderId + '/confirm-zero') { assert(zero); assert.deepEqual(body, {}); orderStatus = 'PAID'; return send({ payment: { id: randomUUID(), orderId, amount: '0', provider: 'INTERNAL_ZERO', method: 'ZERO_TOTAL', status: 'SUCCEEDED' },
    order: { id: orderId, orderCode: 'BL-SYNTHETIC', status: 'PAID' }, loyalty: { awardedPoints: 0 } }); }
  if (url.pathname === '/orders/' + orderId + '/cancel') { if (current && outcome !== 'FAILED') return error('PAYMENT_PENDING', 409); orderStatus = 'CANCELLED'; return send(snapshot()); }
  if (url.pathname === '/payments' && req.method === 'POST') { assert.equal(mode, 'MOCK'); assert(!zero); orderStatus = 'PAID'; return send({ payment: { id: randomUUID(), orderId, status: 'SUCCEEDED', amount: '85000', method: body.method },
    order: { id: orderId, orderCode: 'BL-SYNTHETIC', status: 'PAID' }, loyalty: { awardedPoints: 8 } }); }
  if (url.pathname === '/loyalty') return send({ loyaltyPoints: 0, reservedPoints: 0, outstandingReversalPoints: '0', pointValueVnd: '100' });
  if (url.pathname === '/orders/me') return send({ items: [] });
  return error('NOT_FOUND', 404);
});
await new Promise((ok, fail) => server.once('error', fail).listen(3201, '127.0.0.1', ok));
const nextLog = [], app = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3200'], { cwd: build, env: { ...process.env, NODE_ENV: 'production' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
app.stdout.on('data', b => nextLog.push(b.toString())); app.stderr.on('data', b => nextLog.push(b.toString()));
const profile = mkdtempSync(join(tmpdir(), 'brewlite-c2-edge-'));
let edge, socket, sequence = 0; const pending = new Map(), trace = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, timeout = 15000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await check()) return; await delay(100); } throw Error('Timed out: ' + label); }
function command(method, params = {}) { return new Promise((ok, fail) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); fail(Error('CDP timeout: ' + method)); }, 20000); pending.set(id, { ok, fail, timer }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const r = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text); return r.result.value; }
async function text(value) { await until(() => evaluate('document.body.innerText.includes(' + JSON.stringify(value) + ')'), value); }
async function click(label) { await evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('missing control');b.click()})()`); }
async function navigate(path) { await command('Page.navigate', { url: origin + path }); await until(() => evaluate('document.readyState === "complete"'), 'document complete'); }
async function login(path, email = 'owner@example.invalid') {
  await navigate('/login?returnTo=' + encodeURIComponent(path)); await text('Chào bạn trở lại.');
  await evaluate(`(()=>{for(const [id,value]of [['auth-email',${JSON.stringify(email)}],['auth-password','synthetic-password-only']]){const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('form').requestSubmit()})()`);
  await until(() => evaluate('location.pathname !== "/login"'), 'login destination');
}
async function reset() { await evaluate('sessionStorage.clear()'); current = false; outcome = 'AWAITING'; statusError = 0; orderStatus = 'PENDING'; orderExists = true; configFail = false; zero = false; mode = 'VNPAY_SANDBOX'; rejectMinimum = false; acceptingNew = true; customerCancelled = false; }
const count = path => requests.filter(r => r.path === path && r.method === 'POST').length;
async function readyPay() { await until(() => evaluate('!!document.querySelector("[data-checkout-action=gateway-payment]:not(:disabled)")'), 'enabled gateway button'); }
async function layouts(name) {
  for (const width of [390, 768, 1366]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await delay(100); assert(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), name + ' overflow ' + width);
    const s = await command('Page.captureScreenshot', { format: 'png' }); mkdirSync(join(root, '.tmp', evidencePrefix), { recursive: true });
    writeFileSync(join(root, '.tmp', evidencePrefix, name + '-' + width + '.png'), Buffer.from(s.data, 'base64'));
  }
}
try {
  await until(async () => { try { return (await fetch(origin)).ok; } catch { return false; } }, 'Next startup', 30000);
  edge = spawn(process.env.BROWSER_PATH, ['--headless=new', '--disable-extensions', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  await until(() => existsSync(join(profile, 'DevToolsActivePort')), 'Edge startup'); const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(ok => socket.addEventListener('open', ok, { once: true }));
  socket.addEventListener('message', async ({ data }) => {
    const e = JSON.parse(data); trace.push(e.method ?? e.id); if (e.id) { const p = pending.get(e.id); if (p) { clearTimeout(p.timer); pending.delete(e.id); if (e.error) p.fail(Error(e.error.message)); else p.ok(e.result); } return; }
    if (e.method === 'Runtime.exceptionThrown') exceptions.push(e.params.exceptionDetails.text);
    if (e.method === 'Runtime.consoleAPICalled' && e.params.args.some(a => typeof a.value === 'string' && /hydrat/i.test(a.value))) hydrationWarnings.push('hydration console warning');
    if (e.method === 'Fetch.requestPaused') {
      const u = new URL(e.params.request.url);
      if (u.hostname === 'sandbox.vnpayment.vn') { gatewayNavigations.push({ host: u.hostname, path: u.pathname }); await command('Fetch.fulfillRequest', { requestId: e.params.requestId, responseCode: 204 }); }
      else await command('Fetch.failRequest', { requestId: e.params.requestId, errorReason: 'BlockedByClient' });
    }
  });
  await command('Page.enable'); await command('Runtime.enable');
  // Block external hosts before navigating any application page. Gateway responses are local204.
  await command('Fetch.enable', { patterns: [{ urlPattern: 'https://*', requestStage: 'Request' }] });
  await login('/cart?orderId=' + orderId); await readyPay();
  assert.equal(await evaluate('document.querySelector("#checkout-method") === null'), true);
  assert.equal(await evaluate('document.querySelector("[data-checkout-action=gateway-payment]").textContent'), 'Thanh toán');
  await layouts('checkout');
  // Keyboard focus: native semantic control receives focus and visible outline.
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await evaluate('document.querySelector("[data-checkout-action=gateway-payment]").focus()');
  assert(await evaluate('document.activeElement.matches("button") && getComputedStyle(document.activeElement).outlineStyle !== "none"'));
  holdInitiation = true; const before = count('/payments/vnpay/attempts');
  await evaluate('(()=>{const b=document.querySelector("[data-checkout-action=gateway-payment]");for(let i=0;i<5;i++)b.click()})()');
  await until(() => !!releaseInitiation, 'held initiation'); assert.equal(count('/payments/vnpay/attempts'), before + 1);
  assert(await evaluate('document.querySelector("[data-checkout-action=gateway-payment]").disabled')); releaseInitiation();
  await until(() => gatewayNavigations.length === 1, 'synthetic gateway navigation');
  await text('Nếu chưa chuyển trang'); checks.push('VNPAY exact label/no selector/keyboard/390-768-1366/double click one request/fixed gateway navigation');
  // Network outcome unknown: commit Attempt but exceed frontend5s timeout; exact key replay only.
  await reset(); loseInitiation = true; await login('/cart?orderId=' + orderId); await readyPay();
  const startPosts = count('/payments/vnpay/attempts'); await click('Thanh toán'); await text('Chưa xác nhận được kết quả thanh toán.');
  await click('Kiểm tra lại trạng thái'); await readyPay(); await click('Thanh toán');
  await until(() => count('/payments/vnpay/attempts') === startPosts + 2, 'same-key replay');
  const replay = requests.filter(r => r.path === '/payments/vnpay/attempts').slice(-2); assert.equal(replay[0].key, replay[1].key);
  await text('Nếu chưa chuyển trang'); assert.equal(count('/orders'), 0); checks.push('lost initiation response and redirect failure keep key and Order');
  await click('Xem lại đơn hàng'); await text('Kết quả thanh toán cục bộ gần nhất'); await text('Đang xác minh kết quả thanh toán.');
  await text('Kiểm tra kết quả giao dịch hiện tại'); checks.push('Order confirmation separates historical terminal failure from pending retry and recovers result link');
  // Full-page reload loses JWT; result has no anonymous status read; login preserves exact result route.
  const reads = requests.filter(r => r.path.startsWith('/payments/attempts/')).length;
  await navigate('/payments/vnpay/result?attemptId=' + attemptId); await text('Đăng nhập để kiểm tra');
  assert.equal(requests.filter(r => r.path.startsWith('/payments/attempts/')).length, reads);
  await click('Đăng nhập để kiểm tra'); await text('Chào bạn trở lại.');
  await evaluate(`(()=>{for(const[id,v]of [['auth-email','owner@example.invalid'],['auth-password','synthetic-password-only']]){const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}))}document.querySelector('form').requestSubmit()})()`);
  await text('Đang xác minh kết quả thanh toán.'); outcome = 'SUCCEEDED'; await text('Thanh toán thành công.');
  const afterPaid = requests.length; await delay(3300); assert.equal(requests.length, afterPaid); await layouts('result');
  for (const [state, message] of [['FAILED', 'Thanh toán không thành công.'], ['UNKNOWN', 'Chưa thể xác định kết quả'], ['REVIEW', 'Giao dịch đang được kiểm tra']]) {
    outcome = state; await click('Kiểm tra lại trạng thái'); await text(message);
    if (state !== 'FAILED') assert(!(await evaluate('document.querySelector(".payment-result").innerText')).includes('Mở đơn để thanh toán lại'));
  }
  checks.push('auth lost/login return/pending-to-paid polling stops/FAILED-UNKNOWN-REVIEW result/no unsafe retry');
  await navigate('/payments/vnpay/result?attemptId=' + attemptId + '&vnp_ResponseCode=00'); await text('Không có thông tin thanh toán hợp lệ');
  await login('/payments/vnpay/result?attemptId=' + attemptId, 'other@example.invalid'); await text('Không tìm thấy kết quả thanh toán của tài khoản này.');
  await login('/payments/vnpay/result?attemptId=' + attemptId); await text('Giao dịch đang được kiểm tra'); statusError = 401; await click('Kiểm tra lại trạng thái'); await text('Đăng nhập để kiểm tra'); statusError = 0;
  checks.push('invalid Return browser code ignored/cross-owner404/session401');
  // Zero never calls initiation, double-click remains one internal confirmation.
  await reset(); zero = true; await login('/cart?orderId=' + orderId); await readyPay(); const gatewayCount = count('/payments/vnpay/attempts');
  const zeroCount = count('/orders/' + orderId + '/confirm-zero');
  await evaluate('(()=>{const b=document.querySelector("[data-checkout-action=gateway-payment]");b.click();b.click()})()'); await text('Thanh toán thành công.');
  assert.equal(count('/payments/vnpay/attempts'), gatewayCount); assert.equal(count('/orders/' + orderId + '/confirm-zero'), zeroCount + 1); checks.push('zero total internal only/one request/authoritative paid');
  // Config error does not reveal Mock selector or permit any payment.
  await reset(); configFail = true; await login('/cart?orderId=' + orderId); await text('Chưa tải được cấu hình thanh toán.');
  assert(await evaluate('!document.querySelector("#checkout-method") && !document.querySelector("[data-checkout-action=gateway-payment]")'));
  configFail = false; await click('Tải lại cấu hình thanh toán'); await readyPay(); checks.push('config unavailable disables payments/no MOCK fallback/retry');
  await reset(); mode = 'MOCK'; await login('/cart?orderId=' + orderId); await until(() => evaluate('!!document.querySelector("#checkout-method")'), 'Mock selector');
  await until(() => evaluate('!!document.querySelector("[data-checkout-action=payment]:not(:disabled)")'), 'enabled Mock payment');
  const mockCount = count('/payments'); await evaluate('document.querySelector("[data-checkout-action=payment]").click()'); await text('Thanh toán thành công.'); assert.equal(count('/payments'), mockCount + 1); checks.push('existing Mock selector/payment baseline');
  // Verified backend capabilities allow cancellation despite the saved completed intent.
  await reset(); current = true; outcome = 'FAILED'; orderStatus = 'PAYMENT_FAILED';
  await evaluate('sessionStorage.setItem("brewlite-gateway-intent",' + JSON.stringify(JSON.stringify({ userId: owner, orderId, key: 'known-failed-key', kind: 'VNPAY', attemptId })) + ')');
  await login('/cart?orderId=' + orderId); await readyPay(); await text('Thanh toán không thành công.');
  await click('Hủy đơn chưa thanh toán'); await text('Đơn đã hủy.');
  await reset(); current = true; outcome = 'FAILED'; orderStatus = 'PAYMENT_FAILED';
  await evaluate('sessionStorage.setItem("brewlite-gateway-intent",' + JSON.stringify(JSON.stringify({ userId: owner, orderId, key: 'known-failed-key', kind: 'VNPAY', attemptId })) + ')');
  await login('/cart?orderId=' + orderId); await readyPay(); await click('Thanh toán'); await text('Nếu chưa chuyển trang');
  assert.notEqual(requests.filter(r => r.path === '/payments/vnpay/attempts').at(-1).key, 'known-failed-key');
  checks.push('verified FAILED capability permits cancel and explicit new-key retry; unknown intent still replays');
  // Order creation response lost: replay same create key; initiation does not create another Order.
  await reset(); orderExists = false; loseCreation = true; await login('/cart'); await text('Điểm thưởng dự kiến');
  await until(() => evaluate('!!document.querySelector("[data-checkout-action=create]:not(:disabled)")'), 'create ready');
  const creates = count('/orders'); await evaluate('document.querySelector("[data-checkout-action=create]").click()'); await text('Thử lại cùng yêu cầu');
  await until(() => evaluate('!!document.querySelector("[data-checkout-action=create]:not(:disabled)")'), 'create recovery ready');
  await evaluate('document.querySelector("[data-checkout-action=create]").click()'); await readyPay();
  const creationReplay = requests.filter(r => r.path === '/orders' && r.method === 'POST').slice(-2); assert.equal(count('/orders'), creates + 2); assert.equal(creationReplay[0].key, creationReplay[1].key);
  checks.push('Order creation uncertain response exact key/payload replay');
  await reset(); orderExists = false; rejectMinimum = true; await login('/cart'); await text('Điểm thưởng dự kiến');
  await evaluate(`(()=>{for(const[id,value]of [['checkout-promotion','INITIAL'],['checkout-points','7']]){const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
  await until(() => evaluate('!!document.querySelector("[data-checkout-action=create]:not(:disabled)")'), 'minimum create ready');
  const minimumGatewayCount = count('/payments/vnpay/attempts');
  await evaluate('document.querySelector("[data-checkout-action=create]").click()');
  await text('Thanh toán VNPAY yêu cầu số tiền tối thiểu 5.000đ.');
  assert(await evaluate('!!document.querySelector("[role=alert]") && document.body.innerText.includes("Synthetic coffee")'));
  assert.equal(await evaluate('document.getElementById("checkout-points").value'), '7');
  assert.equal(await evaluate('document.getElementById("checkout-promotion").value'), 'INITIAL');
  assert.equal(count('/payments/vnpay/attempts'), minimumGatewayCount);
  const rejectedKey = requests.filter(r => r.path === '/orders' && r.method === 'POST').at(-1).key;
  await layouts('minimum-error');
  rejectMinimum = false;
  await evaluate(`(()=>{for(const[id,value]of [['checkout-promotion','CORRECTED'],['checkout-points','0']]){const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
  await until(() => evaluate('!!document.querySelector("[data-checkout-action=create]:not(:disabled)")'), 'minimum corrected ready');
  await evaluate('document.querySelector("[data-checkout-action=create]").click()'); await readyPay();
  const corrected = requests.filter(r => r.path === '/orders' && r.method === 'POST').at(-1);
  assert.notEqual(corrected.key, rejectedKey); assert.equal(corrected.body.promotionCode, 'CORRECTED'); assert.equal(corrected.body.redeemedPoints, 0);
  checks.push('minimum422 accessible error/Cart retained/no gateway/390-768-1366/user correction new intent');
  await reset(); acceptingNew = false; current = true; await login('/cart?orderId=' + orderId); await text('Thanh toán VNPAY hiện đang tạm ngừng nhận giao dịch mới.');
  await until(() => evaluate('!!document.querySelector(".gateway-checkout")'), 'drain existing attempt');
  assert(await evaluate('document.querySelector("[data-checkout-action=gateway-payment]").disabled && !document.querySelector("#checkout-method")'));
  const drainPosts = count('/payments/vnpay/attempts'), drainReads = requests.filter(r => r.path.startsWith('/orders/') && r.path.endsWith('/payment-attempts')).length;
  await click('Kiểm tra lại trạng thái'); await until(() => requests.filter(r => r.path.endsWith('/payment-attempts')).length > drainReads, 'drain status read');
  assert.equal(count('/payments/vnpay/attempts'), drainPosts); checks.push('drain existing Attempt status readable/no resume or new payment/no Mock selector');
  await reset(); acceptingNew = false; orderExists = false; await login('/cart'); await text('Điểm thưởng dự kiến');
  await evaluate(`(()=>{for(const[id,value]of [['checkout-promotion','KEEP'],['checkout-points','7']]){const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
  await text('Thanh toán VNPAY hiện đang tạm ngừng nhận giao dịch mới.'); const drainOrders = count('/orders');
  assert(await evaluate('document.querySelector("[data-checkout-action=create]").disabled'));
  await evaluate('document.querySelector("[data-checkout-action=create]").click()'); assert.equal(count('/orders'), drainOrders);
  assert.equal(await evaluate('document.getElementById("checkout-points").value'), '7'); assert.equal(await evaluate('document.getElementById("checkout-promotion").value'), 'KEEP');
  await layouts('drain'); checks.push('drain prevents new positive Order/reservation; Cart/Promotion/points retained/responsive status');
  acceptingNew = true; await click('Cập nhật trạng thái nhận thanh toán');
  await until(()=>evaluate('!!document.querySelector("[data-checkout-action=create]:not(:disabled)")'),'reopened admission create');
  assert.equal(count('/orders'),drainOrders);checks.push('config refresh reopens legitimate Checkout without a new payment or guard override');
  await reset(); customerCancelled=true;current=true;outcome='FAILED';orderStatus='PAYMENT_FAILED';
  await login('/payments/vnpay/result?attemptId='+attemptId);
  await until(()=>evaluate('location.pathname === "/"'),'verified cancellation Home');
  await text('Bạn đã hủy giao dịch VNPAY.');
  assert(await evaluate(`Array.from(document.querySelectorAll('a')).some(a=>a.getAttribute('href')===${JSON.stringify('/orders/'+orderId+'/confirmation')})`));
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify('[aria-label="Thông báo thanh toán"]')}).innerText.includes('Thanh toán không thành công')`),true);
  checks.push('verified24 cancellation resolves through owned status then Home with notification/order link; no Return trust');
  await reset(); acceptingNew = false; zero = true; await login('/cart?orderId=' + orderId); await readyPay();
  const drainZero = count('/orders/' + orderId + '/confirm-zero'); await click('Xác nhận đơn 0 VND'); await text('Thanh toán thành công.');
  assert.equal(count('/orders/' + orderId + '/confirm-zero'), drainZero + 1); checks.push('drain preserves explicit internal zero confirmation');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  assert.equal(hydrationWarnings.length, 0);
  assert(await evaluate('Object.keys(localStorage).every(k=>!(/token|payment|jwt/i).test(k))'));
  const report = { syntheticFrontendTransport: true, actualSandbox: 'NOT RUN', databaseAccess: false, checks, gatewayNavigations, runtimeExceptions: exceptions.length, hydrationWarnings: hydrationWarnings.length,
    requests: requests.map(r => ({ path: r.path, method: r.method })), viewports: [390, 768, 1366], atUtc: new Date().toISOString() };
  writeFileSync(join(root, '.tmp', evidencePrefix + '-evidence.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: checks.length, runtimeExceptions: 0, externalGatewayCalls: 0 }));
} finally {
  if (socket) socket.close(); for (const p of pending.values()) clearTimeout(p.timer);
  if (edge) edge.kill(); app.kill(); server.closeAllConnections(); await new Promise(ok => server.close(ok));
  writeFileSync(join(root, '.tmp', evidencePrefix + '-next.log'), nextLog.join(''));
  writeFileSync(join(root, '.tmp', evidencePrefix + '-trace.json'), JSON.stringify(trace));
}
