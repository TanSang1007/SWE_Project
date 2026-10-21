// Real local Edge browser via built-in CDP/WebSocket; no browser test dependency.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import net from 'node:net';
import { randomUUID, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { verifyHistoryBrowser } from './history-browser.mjs';
import { verifyRbacBrowser } from './rbac-browser.mjs';
import { verifyOperatorBrowser } from './operator-browser.mjs';
import { verifyWorkflowBrowser } from './workflow-browser.mjs';
import { verifyProductsBrowser } from './products-browser.mjs';
import { verifyUi01Browser } from './ui01-browser.mjs';
import { verifyOptionsBrowser } from './options-browser.mjs';
import { verifyLoyaltyRedemptionBrowser } from './loyalty-redemption-browser.mjs';
import { verifyInventoryBrowser } from './inventory-browser.mjs';
import { buildWorkflowFrontend, workflowFrontendDirectory } from './workflow-build.mjs';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../..');
require('dotenv').config({ path: join(root, '.env'), quiet: true });
const { Client } = require('pg');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const browserPath = process.env.BROWSER_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
assert(existsSync(browserPath), 'Set BROWSER_PATH to a local Chromium/Edge executable');
const profile = mkdtempSync(join(tmpdir(), 'brewlite-b06-'));
const processes = [];
let socket;
const verifyLoyaltyRedemption=process.argv.includes('--loyalty-redemption');
const verifyInventory = process.argv.includes('--inventory') || verifyLoyaltyRedemption;
const verifyOptions = process.argv.includes('--options') || verifyInventory;
const verifyUi01 = process.argv.includes('--ui01') || verifyOptions;
const verifyProducts = process.argv.includes('--products') || verifyUi01;
const verifyWorkflow = process.argv.includes('--workflow') || verifyProducts;
const frontendUrl=verifyWorkflow?'http://localhost:3100':'http://localhost:3000';
const backendUrl=verifyWorkflow?'http://localhost:3101':'http://localhost:3001';
const testUrl=(value)=>value.replaceAll('http://localhost:3000',frontendUrl).replaceAll('http://localhost:3001',backendUrl);
const testParams=(value)=>JSON.parse(testUrl(JSON.stringify(value)));
function testEvent(value){
  for(const key of ['request','response']){const row=value.params?.[key];if(row?.url){row.originalUrl=row.url;row.url=row.url.replaceAll(backendUrl,'http://localhost:3001').replaceAll(frontendUrl,'http://localhost:3000');}}
  return value;
}
const originalDatabaseUrl = process.env.DATABASE_URL;
const browserSchema = verifyWorkflow ? `brewlite_${verifyLoyaltyRedemption?'l01':verifyProducts?'a04':'a03'}_browser_${randomUUID().replaceAll('-','')}` : undefined;
const browserAdmin = verifyWorkflow ? new Client({connectionString:originalDatabaseUrl}) : undefined;
let browserAdminConnected = false; let browserSchemaCreated = false; let originalPublicFingerprint;
if (verifyWorkflow) {
  assert(['localhost','127.0.0.1','::1'].includes(browserAdmin.host) && /_(dev|test)$/.test(browserAdmin.database),'Local test DB required');
  const scoped = new URL(originalDatabaseUrl); scoped.searchParams.set('options',`-c search_path=${browserSchema}`);
  process.env.DATABASE_URL = scoped.toString(); process.env.BROWSER_TEST_SCHEMA = browserSchema;
  process.env.PORT='3101';process.env.FRONTEND_ORIGIN=frontendUrl;
}
const database = new Client({ connectionString: process.env.DATABASE_URL });
let databaseConnected = false;
const report = { browser: '', viewports: [], checks: [], requests: [], runtimeExceptions: 0, hydrationWarnings: 0 };
const verifyOperator = process.argv.includes('--operator') || verifyWorkflow;
const verifyRbac = process.argv.includes('--rbac') || verifyOperator;
const verifyHistory = process.argv.includes('--history') || verifyRbac;
const evidencePrefix = process.argv.find((arg) => arg.startsWith('--evidence-prefix='))?.split('=')[1] ?? (verifyWorkflow ? 'A03' : verifyRbac ? 'A01' : undefined);
if (evidencePrefix !== undefined) assert(/^(?:[ABL]\d+|UI01)$/.test(evidencePrefix), 'Evidence prefix must be a backlog ID');
if (verifyWorkflow) assert.equal(evidencePrefix,verifyLoyaltyRedemption?'L01':verifyInventory?'A06':verifyOptions?'A05':verifyUi01?'UI01':verifyProducts?'A04':'A03','Evidence must preserve previous checkpoints');
const verifyLoyalty = process.argv.includes('--loyalty') || verifyHistory;
const verifyPromotions = process.argv.includes('--promotions') || verifyLoyalty;
const verifyCheckout = process.argv.includes('--checkout') || verifyPromotions;
const checkoutEvidencePrefix = evidencePrefix ?? (verifyHistory ? 'B15' : verifyLoyalty ? 'B14' : verifyPromotions ? 'B13' : 'B12');
const verifyPayments = process.argv.includes('--payments') || verifyCheckout;
const verifyOrders = process.argv.includes('--orders') || verifyPayments;
const verifyCart = process.argv.includes('--cart') || verifyOrders;
const verifyAuth = process.argv.includes('--auth') || verifyCart;
const reuseFrontend = process.argv.includes('--reuse-frontend');
const reuseBackend = process.argv.includes('--reuse-backend');
if (verifyWorkflow) assert(!reuseBackend&&!reuseFrontend,'A03 requires owned isolated apps');
const backendScript = verifyWorkflow ? 'test/workflow-browser-server.cjs' : 'dist/main.js';
let guardPort = 3001;
const authEmail = verifyAuth ? `${randomUUID()}@example.invalid` : null;
const authPassword = verifyAuth ? randomBytes(20).toString('hex') : null;
let loginPayload;
let orderCatalogBefore;
let promotionsBefore;
let paymentBackend;
let losePaymentResponse = false;
let loseOrderResponse = false;
let failOrderReads = false;
let failCartReads = false;
let holdPaymentResponse = false;
let heldPaymentResponse;
let holdOrderResponse = false;
let heldOrderResponse;
let loyaltyReadMode = 'real';
let heldLoyaltyRead;
let loyaltyReads = 0;
let historyReadMode = 'real';
let heldHistoryRead;
let operatorReadMode = 'real';
let heldOperatorRead;
let workflowMutationMode = 'real'; let heldWorkflowMutation;
let workflowPosts = 0;
let productReadMode='real'; let productMutationMode='real'; let heldProductRead; let heldProductMutation; let productMutations=0;
let inventoryReadMode='real'; let heldInventoryRead;
let otherLoyaltyUser;
const promotionFixtures = [];
const checkoutPosts = { create: 0, payment: 0, cancel: 0 };
const pending = new Map(); let sequence = 0;
const requestUrls = new Map();
const requestMethods = new Map();
async function freePort(port) {
  const server = net.createServer();
  await new Promise((ok, fail) => server.once('error', fail).listen(port, ok));
  const actual = server.address().port; await new Promise((ok) => server.close(ok)); return actual;
}
async function ready(url) {
  url=testUrl(url);
  const deadline=Date.now()+45000;
  while(Date.now()<deadline) {
    try { const response = await fetch(url,{signal:AbortSignal.timeout(1500)}); if (response.ok) return; } catch { /* wait for owned process */ }
    const failed = processes.find((p) => p.exitCode !== null);
    assert(!failed, `Test process ${failed?.verificationCommand} exited with ${failed?.exitCode} before readiness`); await delay(100);
  }
  throw new Error('Local server readiness timeout');
}
function launch(executable, args, cwd, env = process.env) {
  const process = spawn(executable, args, { cwd, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  process.verificationCommand = args[0];
  process.stderr.on('data', (data) => { if (/^(Auth|Workflow) verification server failed/.test(data.toString())) console.error(data.toString().trim()); });
  processes.push(process); return process;
}
function command(method, params = {}, useTestOrigins = true) {
  const id = ++sequence;
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP timeout: ${method}`)); }, method === 'Page.captureScreenshot' ? 45000 : 15000);
    pending.set(id, { ok: (value) => { clearTimeout(timer); ok(value); }, fail: (error) => { clearTimeout(timer); fail(error); } });
    socket.send(JSON.stringify({ id, method, params:useTestOrigins?testParams(params):params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  assert(!result.exceptionDetails, 'Browser expression failed'); return result.result.value;
}
async function waitText(text) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`)) return;
    await delay(100);
  }
  if (verifyCheckout) console.error(JSON.stringify({ expected:text, page:await evaluate(`({path:location.pathname,title:document.title,text:document.body.innerText.slice(0,1800)})`), checkout:await evaluate(`document.querySelector('.order-checkout')?.innerText??'No checkout rendered'`), lastResponses:report.requests.slice(-8) }));
  throw new Error(`Browser text timeout: ${text}`);
}
async function navigate(path) { await command('Page.navigate', { url: `http://localhost:3000${path}` }); }
async function publicFingerprint() {
  const tables=(await browserAdmin.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows;
  const values={};for(const {table_name:name}of tables)values[name]=(await browserAdmin.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS h FROM public."${name}" t`)).rows[0].h;
  return JSON.stringify(values);
}
try {
  if (!reuseFrontend) await freePort(Number(new URL(frontendUrl).port));
  if (!reuseBackend) await freePort(Number(new URL(backendUrl).port));
  if (verifyWorkflow) await buildWorkflowFrontend();
  if (verifyWorkflow) {
    await browserAdmin.connect();browserAdminConnected=true;originalPublicFingerprint=await publicFingerprint();
    await browserAdmin.query(`CREATE SCHEMA "${browserSchema}"`);browserSchemaCreated=true;
    await browserAdmin.query(`SET search_path TO "${browserSchema}"`);
    const dir=join(root,'backend/prisma/migrations');for(const name of readdirSync(dir).filter(n=>/^\d+_/.test(n)).sort())await browserAdmin.query(readFileSync(join(dir,name,'migration.sql'),'utf8'));
  }
  await database.connect();
  databaseConnected = true;
  if (verifyWorkflow) await require('../../backend/prisma/seed.cjs').seed(database);
  const snapshot = async () => JSON.stringify((await database.query('SELECT id,price::text,stock,version,updated_at::text FROM products ORDER BY id')).rows);
  const before = await snapshot();
  if (verifyPromotions) promotionsBefore = JSON.stringify((await database.query('SELECT * FROM promotions ORDER BY id')).rows);
  const expectedCards = (await database.query('SELECT count(*)::int AS n FROM products')).rows[0].n;
  if (verifyAuth) {
    guardPort = await freePort(0);
    launch(process.execPath, ['test/auth-browser-server.cjs'], join(root, 'backend'), { ...process.env, AUTH_VERIFY_PORT: String(guardPort) });
  }
  assert(!verifyPayments || verifyWorkflow,'Financial browser tests require an owned UUID schema; use test:loyalty-redemption:browser');
  assert(!verifyPayments || !reuseBackend, 'Payment verification must own backend for server mock mode changes');
  if (!reuseBackend) paymentBackend = launch(process.execPath, [backendScript], join(root, 'backend'), { ...process.env, PAYMENT_MOCK_MODE: 'SUCCESS' });
  if (!reuseFrontend) launch(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', new URL(frontendUrl).port], verifyWorkflow?workflowFrontendDirectory:join(root, 'frontend'), { ...process.env, NODE_ENV: 'production' });
  await ready('http://localhost:3001/health'); await ready('http://localhost:3000');
  if (verifyAuth) await ready(`http://127.0.0.1:${guardPort}/health`);
  const debugPort = await freePort(0);
  launch(browserPath, ['--headless=new', '--disable-extensions', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, 'about:blank'], root);
  await ready(`http://127.0.0.1:${debugPort}/json/version`);
  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(); report.browser = version.Browser;
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', fail, { once: true }); });
  socket.addEventListener('message', ({ data }) => {
    const event = testEvent(JSON.parse(data));
    if (event.method === 'Runtime.exceptionThrown') report.runtimeExceptions++;
    if (event.method === 'Runtime.consoleAPICalled' && event.params.args.some(a => typeof a.value === 'string' && /hydrat/i.test(a.value))) report.hydrationWarnings++;
    if (event.id) { const task = pending.get(event.id); pending.delete(event.id); if (event.error) task?.fail(new Error(event.error.message)); else task?.ok(event.result); }
    if (event.method === 'Network.requestWillBeSent') {
      requestUrls.set(event.params.requestId, event.params.request.url); requestMethods.set(event.params.requestId, event.params.request.method);
      if (verifyCheckout && event.params.request.method === 'POST') {
        const path = new URL(event.params.request.url).pathname;
        if (path === '/orders') checkoutPosts.create++; else if (path === '/payments') checkoutPosts.payment++; else if (path.endsWith('/cancel')) checkoutPosts.cancel++;
      }
      if (verifyWorkflow && event.params.request.method==='POST' && /\/(transitions|paid-cancel)$/.test(new URL(event.params.request.url).pathname)) workflowPosts++;
    }
    if (verifyProducts && event.method==='Network.requestWillBeSent' && event.params.request.url.startsWith('http://localhost:3001/admin/products') && ['POST','PATCH','DELETE'].includes(event.params.request.method)) productMutations++;
    if (event.method === 'Network.requestWillBeSent' && event.params.request.url === 'http://localhost:3001/loyalty' && event.params.request.method === 'GET') loyaltyReads++;
    if (event.method === 'Network.responseReceived' && (event.params.response.url.startsWith('http://localhost:3001/admin/inventory') || event.params.response.url.startsWith('http://localhost:3001/admin/toppings') || event.params.response.url.startsWith('http://localhost:3001/admin/products') || event.params.response.url.startsWith('http://localhost:3001/admin/orders') || event.params.response.url.startsWith('http://localhost:3001/operator/orders') || event.params.response.url.startsWith('http://localhost:3001/products') || event.params.response.url.startsWith('http://localhost:3001/auth/') || event.params.response.url.startsWith('http://localhost:3001/cart') || event.params.response.url.startsWith('http://localhost:3001/orders') || event.params.response.url.startsWith('http://localhost:3001/payments') || event.params.response.url === 'http://localhost:3001/loyalty')) {
      report.requests.push({ method: requestMethods.get(event.params.requestId) ?? (event.params.type === 'Preflight' ? 'OPTIONS' : 'GET'), url: event.params.response.originalUrl??event.params.response.url, status: event.params.response.status });
    }
    if (verifyAuth && event.method === 'Network.loadingFinished' && requestUrls.get(event.params.requestId) === 'http://localhost:3001/auth/login') {
      void command('Network.getResponseBody', { requestId: event.params.requestId }).then((response) => {
        const body = JSON.parse(response.body); if (body.accessToken) loginPayload = body;
      }).catch(() => {});
    }
  });
  await command('Page.enable'); await command('Runtime.enable'); await command('Network.enable');
  for (const [width, height] of [[390, 844], [768, 1024], [1366, 768]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await navigate('/'); await waitText('Cappuccino'); await waitText('Latte');
    assert(await evaluate("document.querySelector('.hero h1').innerText.includes('Chọn một ly.')"));
    assert.equal(await evaluate("document.querySelectorAll('.campaign-banner,.campaign-grid,a[href=\"/promotions\"]').length"),0);
    for(const path of ['/promotions','/admin/promotions','/admin/promotions/campaigns/new','/admin/promotions/codes/new'])assert.equal((await fetch(frontendUrl+path)).status,404);
    await navigate('/promotions');await waitText('404');await navigate('/');await waitText('Cappuccino');
    report.checks.push('A07 rollback: original L01 homepage hero, no campaign/banner/navigation; removed customer/admin routes return404 and customer discovery browser404');
    await delay(200);
    const layout = await evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,cards:document.querySelectorAll('.product-card').length,columns:getComputedStyle(document.querySelector('.product-grid')).gridTemplateColumns.split(' ').length,alt:[...document.querySelectorAll('.product-image')].every(i=>!!i.alt),prices:[...document.querySelectorAll('.price')].map(i=>i.innerText)})`);
    assert(!layout.overflow); assert.equal(layout.cards, expectedCards); assert(layout.alt); assert(layout.prices.some((p) => p.includes('45.000'))); assert(layout.prices.some((p) => p.includes('40.000')));
    report.viewports.push({ width, height, ...layout });
    if (!verifyAuth) {
      const menuScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(join(root, `Docs/B06-menu-${width}.png`), Buffer.from(menuScreenshot.data, 'base64'));
    }
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert(await evaluate(`document.activeElement.tagName==='A'`));
    await evaluate(`document.querySelector('.detail-link').click()`); await waitText('Giá cơ bản'); await waitText('Size L');
    assert(await evaluate(`document.querySelector('h1').innerText==='Cappuccino' && document.body.innerText.includes('Kem') && document.body.innerText.includes('Caramel') && document.body.innerText.includes('10.000') && document.body.innerText.includes('7.000')`));
    assert(!(await evaluate('document.documentElement.scrollWidth>innerWidth')));
    await command('Page.reload', { ignoreCache: true }); await waitText('Giá cơ bản'); await waitText('Size L');
    if (!verifyAuth) {
      const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(join(root, `Docs/B06-detail-${width}.png`), Buffer.from(screenshot.data, 'base64'));
    }
  }
  report.checks.push('seed menu, prices, detail click, sizes/toppings, direct refresh, 3 viewports no overflow, image alt, keyboard link focus');
  await navigate('/products/invalid'); await waitText('Đường dẫn món chưa hợp lệ');
  await navigate('/products/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); await waitText('Không tìm thấy món này');
  report.checks.push('invalid ID and real backend 404 are friendly states');
  // Controlled browser-only fault fixtures; never change database/backend data.
  let intercept = 'loading';
  socket.addEventListener('message', async ({ data }) => {
    const event = testEvent(JSON.parse(data)); if (event.method !== 'Fetch.requestPaused') return;
    const id = event.params.requestId;
    try {
      // Fault fixtures target business requests; CORS preflights must reach the real backend.
      if (event.params.request.method === 'OPTIONS') {
        await command(event.params.responseStatusCode ? 'Fetch.continueResponse' : 'Fetch.continueRequest', { requestId:id });
        return;
      }
      if (verifyInventory && event.params.request.url === 'http://localhost:3001/admin/inventory') {
        if (inventoryReadMode==='hold') heldInventoryRead=id;
        else if (inventoryReadMode==='error') await command('Fetch.failRequest',{requestId:id,errorReason:'ConnectionRefused'});
        else if (['empty','unauthorized','forbidden'].includes(inventoryReadMode)) await command('Fetch.fulfillRequest',{requestId:id,responseCode:inventoryReadMode==='empty'?200:inventoryReadMode==='unauthorized'?401:403,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:frontendUrl}],body:Buffer.from(inventoryReadMode==='empty'?'{"items":[]}':'{}').toString('base64')});
        else await command('Fetch.continueRequest',{requestId:id});
        return;
      }
      if (verifyProducts && (event.params.request.url.startsWith('http://localhost:3001/admin/products') || (verifyOptions && event.params.request.url.startsWith('http://localhost:3001/admin/toppings')))) {
        if (event.params.responseStatusCode) {
          if (event.params.request.method!=='GET' && productMutationMode==='hold') heldProductMutation=id;
          else if (event.params.request.method!=='GET' && productMutationMode==='lose') {productMutationMode='real';await command('Fetch.failRequest',{requestId:id,errorReason:'ConnectionReset'});}
          else await command('Fetch.continueResponse',{requestId:id});
        } else if (event.params.request.method==='GET' && productReadMode==='hold') heldProductRead=id;
        else if (event.params.request.method==='GET' && productReadMode==='error') await command('Fetch.failRequest',{requestId:id,errorReason:'ConnectionRefused'});
        else if (event.params.request.method==='GET' && productReadMode==='unauthorized') await command('Fetch.fulfillRequest',{requestId:id,responseCode:401,responseHeaders:[{name:'Access-Control-Allow-Origin',value:'http://localhost:3000'}]});
        else await command('Fetch.continueRequest',{requestId:id});
        return;
      }
      if (verifyWorkflow && event.params.request.method==='POST' && /\/(transitions|paid-cancel)$/.test(new URL(event.params.request.url).pathname)) {
        if (!event.params.responseStatusCode) {
          if (workflowMutationMode==='block') {workflowMutationMode='real';await command('Fetch.failRequest',{requestId:id,errorReason:'ConnectionRefused'});}
          else await command('Fetch.continueRequest',{requestId:id});
        } else if (workflowMutationMode==='hold') heldWorkflowMutation=id;
        else if (workflowMutationMode==='lose') {workflowMutationMode='real';await command('Fetch.failRequest',{requestId:id,errorReason:'ConnectionReset'});}
        else await command('Fetch.continueResponse',{requestId:id});
        return;
      }
      if (verifyOperator && event.params.request.url.startsWith('http://localhost:3001/operator/orders') && event.params.request.method === 'GET') {
        report.operatorReadFixtures ??= [];
        report.operatorReadFixtures.push({ path: new URL(event.params.request.url).pathname, mode: operatorReadMode });
        if (operatorReadMode === 'real') { await command(event.params.responseStatusCode?'Fetch.continueResponse':'Fetch.continueRequest', { requestId: id }); return; }
        if (operatorReadMode === 'hold') { heldOperatorRead = id; return; }
        if (operatorReadMode === 'error') await command('Fetch.failRequest', { requestId: id, errorReason: 'ConnectionRefused' });
        else await command('Fetch.fulfillRequest', { requestId: id, responseCode: operatorReadMode === 'unauthorized' ? 401 : operatorReadMode === 'forbidden' ? 403 : 200,
          responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: 'http://localhost:3000' }, { name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ items: [] })).toString('base64') });
        return;
      }
      if (verifyHistory && historyReadMode !== 'real' && event.params.request.url.startsWith('http://localhost:3001/orders/') && event.params.request.method === 'GET') {
        if (historyReadMode === 'hold') { heldHistoryRead = id; return; }
        if (historyReadMode === 'error') await command('Fetch.failRequest', { requestId:id, errorReason:'ConnectionRefused' });
        else await command('Fetch.fulfillRequest', { requestId:id,responseCode:401,responseHeaders:[{name:'Access-Control-Allow-Origin',value:'http://localhost:3000'}] });
        return;
      }
      if (verifyLoyalty && event.params.request.url === 'http://localhost:3001/loyalty') {
        if (event.params.request.method !== 'GET') { await command('Fetch.continueRequest', { requestId: id }); return; }
        if (loyaltyReadMode === 'hold') { heldLoyaltyRead = id; return; }
        if (loyaltyReadMode === 'error') await command('Fetch.failRequest', { requestId: id, errorReason: 'ConnectionRefused' });
        else if (loyaltyReadMode === 'unauthorized') await command('Fetch.fulfillRequest', { requestId: id, responseCode: 401, responseHeaders: [{ name:'Access-Control-Allow-Origin', value:'http://localhost:3000' }] });
        else await command('Fetch.continueRequest', { requestId: id });
        return;
      }
      if (verifyCheckout && event.params.request.url.startsWith('http://localhost:3001/orders') && event.params.request.method === 'GET') {
        if (failOrderReads) await command('Fetch.failRequest', { requestId: id, errorReason: 'ConnectionRefused' });
        else await command(event.params.responseStatusCode ? 'Fetch.continueResponse' : 'Fetch.continueRequest', { requestId: id });
        return;
      }
      if (verifyCheckout && event.params.request.url === 'http://localhost:3001/orders' && event.params.responseStatusCode) {
        if (holdOrderResponse && event.params.request.method === 'POST') { heldOrderResponse = id; return; }
        if (loseOrderResponse && event.params.request.method === 'POST') { loseOrderResponse = false; await command('Fetch.failRequest', { requestId: id, errorReason: 'ConnectionReset' }); }
        else await command('Fetch.continueResponse', { requestId: id });
        return;
      }
      if (verifyCheckout && event.params.request.url === 'http://localhost:3001/cart') {
        if (failCartReads && event.params.request.method === 'GET') await command('Fetch.failRequest', { requestId: id, errorReason: 'ConnectionRefused' });
        else await command(event.params.responseStatusCode ? 'Fetch.continueResponse' : 'Fetch.continueRequest', { requestId: id });
        return;
      }
      if (event.params.request.url.endsWith('/payments') && event.params.responseStatusCode) {
        if (holdPaymentResponse && event.params.request.method === 'POST') { heldPaymentResponse = id; return; }
        if (losePaymentResponse && event.params.request.method === 'POST') { losePaymentResponse = false; await command('Fetch.failRequest', { requestId: id, errorReason: 'ConnectionReset' }); }
        else await command('Fetch.continueResponse', { requestId: id });
        return;
      }
      if (intercept === 'loading') { await delay(800); await command('Fetch.continueRequest', { requestId: id }); }
      else if (intercept === 'empty') await command('Fetch.fulfillRequest', { requestId: id, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: 'http://localhost:3000' }], body: Buffer.from(JSON.stringify({ items: [], currency: 'VND' })).toString('base64') });
      else await command('Fetch.failRequest', { requestId: id, errorReason: 'ConnectionRefused' });
    } catch (error) { if (verifyOperator && event.params.request.url.startsWith('http://localhost:3001/operator/orders')) console.error(`A02 interceptor error: ${error.message}`); }
  });
  await command('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:3001/products', requestStage: 'Request' }] });
  await navigate('/'); await waitText('Đang tải thực đơn'); await waitText('Cappuccino');
  intercept = 'empty'; await navigate('/'); await waitText('Thực đơn đang được cập nhật');
  intercept = 'error'; await navigate('/'); await waitText('Chưa tải được thực đơn');
  assert(!(await evaluate(`/SQL|Prisma|DATABASE_URL|stack trace/.test(document.body.innerText)`)));
  await command('Fetch.disable'); await evaluate(`document.querySelector('.button').click()`); await waitText('Cappuccino');
  report.checks.push('browser-only delayed loading, empty fixture, network-failure fixture and retry recovery');
  if (verifyAuth) {
    assert.equal(new URL(process.env.DATABASE_URL).pathname, '/brewlite_dev', 'Auth browser verification requires development database');
    async function fill(id, value) {
      let hydrated = false;
      for (let i = 0; i < 100; i++) {
        hydrated = await evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});return !!input&&!input.disabled&&Object.keys(input).some(key=>key.startsWith('__reactProps$')&&typeof input[key].onChange==='function');})()`);
        if (hydrated) break; await delay(100);
      }
      assert(hydrated, 'Auth input hydration timeout');
      await evaluate(`(()=>{const input=document.getElementById(${JSON.stringify(id)});input.focus();input.select();})()`);
      await command('Input.insertText', { text: value });
    }
    async function submit() { await evaluate(`document.querySelector('.auth-submit').click()`); }
    async function showLoyalty(points) {
      await evaluate(`document.querySelector('.auth-nav a[href="/loyalty"]').click()`);
      await waitText('Số điểm hiện tại');
      for (let i=0;i<100;i++) {
        if (await evaluate(`document.querySelector('[data-loyalty-points]')?.getAttribute('data-loyalty-points')===${JSON.stringify(String(points))}`)) break;
        await delay(50);
      }
      assert.equal(await evaluate(`document.querySelector('[data-loyalty-points]')?.getAttribute('data-loyalty-points')`), String(points));
      assert.equal(await evaluate(`document.querySelectorAll('[data-loyalty-points]').length`), 1);
    }
    await navigate('/register'); await waitText('Tạo tài khoản');
    await fill('auth-email', 'invalid'); await fill('auth-password', authPassword); await submit(); await waitText('Vui lòng nhập email hợp lệ');
    await fill('auth-email', authEmail); await submit(); await waitText('Đăng ký thành công');
    assert(await evaluate(`location.pathname==='/login' && !document.body.innerText.includes('Đăng xuất')`));
    const row = (await database.query('SELECT id,password_hash FROM users WHERE email=$1', [authEmail])).rows[0];
    assert(row); assert.equal(bcrypt.getRounds(row.password_hash), 10); assert(await bcrypt.compare(authPassword, row.password_hash));
    await fill('auth-email', authEmail); await fill('auth-password', randomBytes(20).toString('hex')); await submit(); await waitText('Email hoặc mật khẩu chưa đúng');
    await fill('auth-password', authPassword); await submit(); await waitText('Đăng xuất'); await waitText('Cappuccino');
    for (let i = 0; i < 50 && !loginPayload; i++) await delay(100);
    assert(loginPayload?.accessToken && loginPayload.expiresIn === 3600 && loginPayload.tokenType === 'Bearer');
    assert(!('passwordHash' in loginPayload.user));
    assert(await evaluate(`!document.body.innerText.includes(${JSON.stringify(loginPayload.accessToken)}) && ![...Object.values(localStorage),...Object.values(sessionStorage)].some(v=>v.includes(${JSON.stringify(loginPayload.accessToken)}))`));
    const guard = await evaluate(`(async()=>{const r=await fetch('http://127.0.0.1:${guardPort}/__auth_verify',{headers:{Authorization:'Bearer '+${JSON.stringify(loginPayload.accessToken)}}});const b=await r.json();return {status:r.status,valid:b.authenticated===true&&b.user?.id===${JSON.stringify(row.id)},keys:Object.keys(b.user??{}).sort()};})()`);
    assert.equal(guard.status, 200); assert(guard.valid); assert.deepEqual(guard.keys, ['email','id','loyaltyPoints','role']);
    assert.equal(await evaluate(`fetch('http://127.0.0.1:${guardPort}/__auth_verify').then(r=>r.status)`), 401);
    assert.equal(await evaluate(`fetch('http://localhost:3001/__auth_verify').then(r=>r.status)`), 404);
    if (verifyLoyalty) {
      await showLoyalty(0); await waitText('Bạn chưa có điểm tích lũy');
      await evaluate(`document.querySelector('.auth-nav a[href="/"]').click()`); await waitText('Cappuccino');
      report.checks.push('B14 initial authenticated user: GET /loyalty shows zero and Vietnamese zero-points state');
    }
    if (verifyCart) {
      // Client navigation preserves B07 memory auth; full reload requires login again.
      await evaluate(`document.querySelector('.detail-link').click()`); await waitText('Thêm vào giỏ');
      await evaluate(`document.querySelector('.cart-options input[value="M"]').click();document.querySelector('.cart-options input[type="checkbox"]').click()`);
      await evaluate(`document.querySelector('.cart-confirm').click()`); await waitText('Đã thêm vào giỏ.');
      await evaluate(`[...document.querySelectorAll('a')].find(a=>a.textContent==='Xem giỏ').click()`); await waitText('Tạm tính:');
      assert(await evaluate(`document.querySelector('.cart-subtotal').textContent.includes('55.000') && document.querySelector('.cart-qty').textContent==='1'`));
      await evaluate(`document.querySelector('[aria-label="Tăng Cappuccino"]').click()`); await waitText('110.000');
      await evaluate(`[...document.querySelectorAll('.cart-item button')].find(b=>b.textContent==='Chỉnh sửa').click()`); await waitText('Lưu thay đổi');
      await evaluate(`document.querySelector('.cart-editor input[value="L"]').click();document.querySelector('.cart-editor input[type="checkbox"]').click();document.querySelector('.cart-editor .cart-confirm').click()`);
      await waitText('Size L · Không topping'); await waitText('110.000');
      // A second edit selects a different topping, retaining qty=2.
      await evaluate(`[...document.querySelectorAll('.cart-item button')].find(b=>b.textContent==='Chỉnh sửa').click()`); await waitText('Lưu thay đổi');
      await evaluate(`document.querySelectorAll('.cart-editor input[type="checkbox"]')[1].click();document.querySelector('.cart-editor .cart-confirm').click()`);
      await waitText('Caramel'); await waitText('124.000');
      await evaluate(`[...document.querySelectorAll('.auth-nav a')].find(a=>a.textContent==='Thực đơn').click()`); await waitText('Thực đơn hôm nay');
      await evaluate(`document.querySelector('.detail-link').click()`); await waitText('Thêm vào giỏ');
      await evaluate(`document.querySelector('.cart-options input[value="L"]').click();document.querySelectorAll('.cart-options input[type="checkbox"]')[1].click();document.querySelector('.cart-confirm').click()`);
      await waitText('Đã thêm vào giỏ.');
      await evaluate(`[...document.querySelectorAll('a')].find(a=>a.textContent==='Xem giỏ').click()`); await waitText('186.000');
      assert.equal(await evaluate(`document.querySelectorAll('.cart-item').length`), 1);
      assert.equal(await evaluate(`document.querySelector('.cart-qty').textContent`), '3');
      const persisted = (await database.query('SELECT ci.qty,ci.size FROM cart_items ci JOIN carts c ON c.id=ci.cart_id WHERE c.user_id=$1', [row.id])).rows;
      assert.deepEqual(persisted, [{ qty: 3, size: 'L' }]);
      await command('Page.reload', { ignoreCache: true }); await waitText('Đăng nhập để tải giỏ');
      assert(!(await evaluate(`document.body.innerText.includes('Đăng xuất')`)));
      await evaluate(`[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')==='/login?returnTo=/cart').click()`); await waitText('Chào bạn trở lại');
      await fill('auth-email', authEmail); await fill('auth-password', authPassword); await submit(); await waitText('186.000');
      assert.equal(await evaluate(`document.querySelector('.cart-qty').textContent`), '3');
      assert(await evaluate(`sessionStorage.getItem('brewlite-order-context')===null && sessionStorage.getItem('brewlite-payment-context')===null && ![...Object.values(localStorage),...Object.values(sessionStorage)].some(v=>v.includes(${JSON.stringify(loginPayload.accessToken)}))`));
      report.checks.push('B08 real FE/BE/PostgreSQL: add M+Kem 55000, qty2 subtotal110000, edit L/no topping then Caramel subtotal124000, duplicate merge qty3 subtotal186000, reload/login restores DB cart; no web storage');
    }
    await evaluate(`document.querySelector('.nav-button').click()`); await waitText('Đăng nhập');
    assert(!(await evaluate(`document.body.innerText.includes('Đăng xuất')`)));
    await navigate('/login'); await waitText('Chào bạn trở lại'); await fill('auth-email', authEmail); await fill('auth-password', authPassword); await submit(); await waitText('Đăng xuất'); await waitText('Cappuccino');
    if (verifyCart) {
      await evaluate(`[...document.querySelectorAll('.auth-nav a')].find(a=>a.getAttribute('href')==='/cart').click()`); await waitText('186.000');
      if (verifyOrders) {
        const productId = '11111111-1111-4111-8111-111111111111';
        orderCatalogBefore = (await database.query('SELECT id,price::text,stock,version,updated_at::text FROM products WHERE id=$1', [productId])).rows[0];
        assert(orderCatalogBefore.stock >= 3);
        const clickButton = async (label) => {
          for (let i = 0; i < 100; i++) {
            const clicked = await evaluate(`(()=>{const b=[...document.querySelectorAll('.order-checkout button')].find(b=>(b.textContent===${JSON.stringify(label)}||b.textContent.startsWith(${JSON.stringify(label+' · ')}))&&!b.disabled);if(!b)return false;b.click();return true;})()`);
            if(clicked)return;
            await delay(100);
          }
          console.error('Checkout readiness diagnostics',JSON.stringify(await evaluate(`({checkout:document.querySelector('.order-checkout')?.innerText,buttons:[...document.querySelectorAll('.order-checkout button')].map(b=>({text:b.textContent,disabled:b.disabled})),points:document.querySelector('#checkout-points')?.value,promo:document.querySelector('#checkout-promotion')?.value})`)));
          throw new Error(`Checkout button readiness timeout: ${label}`);
        };
        const repeatHandler = async (action) => {
          for (let i=0;i<100;i++) {
            if (await evaluate(`!!document.querySelector('[data-checkout-action="${action}"]:not(:disabled)')`)) {
              await evaluate(`(()=>{const b=document.querySelector('[data-checkout-action="${action}"]');const p=Object.keys(b).find(k=>k.startsWith('__reactProps$'));b[p].onClick();b[p].onClick();b[p].onClick();})()`); return;
            }
            await delay(100);
          }
          throw new Error('Repeated-click fixture could not find an enabled action');
        };
        async function captureCheckout(state) {
          if (!verifyCheckout) return;
          const layouts = [];
          for (const [width, height] of [[390,844],[768,1024],[1366,768]]) {
            await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
            await evaluate('document.activeElement?.blur();window.scrollTo(0,0)'); await delay(100);
            const layout = await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,labeled:[...document.querySelectorAll('.order-checkout input,.order-checkout select')].every(e=>e.labels.length>0),minActionHeight:Math.min(...[...document.querySelectorAll('.order-checkout button')].map(e=>e.getBoundingClientRect().height))})`);
            assert(!layout.overflow); assert(layout.labeled); assert(layout.minActionHeight >= 44);
            layouts.push({ width, height, ...layout });
            if (!verifyLoyalty) { const shot = await command('Page.captureScreenshot', { format:'png',captureBeyondViewport:true }); writeFileSync(join(root, `Docs/${checkoutEvidencePrefix}-${state}-${width}.png`), Buffer.from(shot.data,'base64')); }
          }
          report.checkoutLayouts ??= {}; report.checkoutLayouts[state] = layouts;
        }
        if (verifyCheckout) {
          await database.query('UPDATE cart_items SET qty=2 WHERE cart_id IN (SELECT id FROM carts WHERE user_id=$1)',[row.id]);
          await clickButton('Đặt hàng'); await waitText('Giỏ hoặc tồn kho đã thay đổi.'); await waitText('124.000');
          assert.equal(await evaluate(`document.querySelector('.cart-qty').textContent`),'2');
          assert.equal((await database.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1',[row.id])).rows[0].n,0);
          await database.query('UPDATE cart_items SET qty=3 WHERE cart_id IN (SELECT id FROM carts WHERE user_id=$1)',[row.id]);
          await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Tải lại giỏ').click()`); await waitText('186.000');
          await fill('checkout-promotion','ABSENT'); await clickButton('Đặt hàng'); await waitText('Mã giảm giá không hợp lệ');
          assert.equal(await evaluate(`document.querySelector('#checkout-promotion').value`),'ABSENT');
          await fill('checkout-promotion',' ');
          report.checks.push('B12 stale Cart CONCURRENT_UPDATE reloads authoritative qty while retaining size/topping; invalid promotion preserves typed code and Cart; no Order/stock/payment/award side effect');
        }
        // Drift in current DB price before checkout; catalog changes restored below.
        await database.query('UPDATE products SET price=price+1 WHERE id=$1', [productId]);
        const beforeCreatePosts = checkoutPosts.create;
        if (verifyCheckout) { await delay(200); await repeatHandler('create'); } else await clickButton('Đặt hàng');
        await waitText('Trạng thái: PENDING'); await waitText('186.003');
        if (verifyCheckout) { assert.equal(checkoutPosts.create - beforeCreatePosts, 1); await waitText('Giá món đã thay đổi'); assert(await evaluate(`document.querySelector('[data-checkout-action="payment"]').textContent.includes('186.003')`)); }
        const order = (await database.query('SELECT id,status,subtotal::text,total::text FROM orders WHERE user_id=$1', [row.id])).rows[0];
        assert.equal(order.status, 'PENDING'); assert.equal(order.total, '186003');
        const item = (await database.query('SELECT unit_price::text,line_total::text,qty,base_price::text FROM order_items WHERE order_id=$1', [order.id])).rows[0];
        assert.deepEqual(item, { unit_price: '62001', line_total: '186003', qty: 3, base_price: '45001' });
        assert.equal((await database.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock, orderCatalogBefore.stock - 3);
        assert.equal((await database.query('SELECT count(*)::int AS n FROM cart_items ci JOIN carts c ON c.id=ci.cart_id WHERE c.user_id=$1', [row.id])).rows[0].n, 1);
        assert(await evaluate(`[...document.querySelectorAll('.cart-item button')].every(b=>b.disabled)`));
        // Restore current price: Order snapshot must retain checkout price.
        await database.query('UPDATE products SET price=$2 WHERE id=$1', [productId, orderCatalogBefore.price]);
        await clickButton('Mở / tải lại đơn hiện tại'); await waitText('186.003');
        if (!verifyLoyalty) {
          const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          writeFileSync(join(root, verifyCheckout ? `Docs/${checkoutEvidencePrefix}-order-pending.png` : verifyPayments ? 'Docs/B11-order-pending.png' : 'Docs/B10-order-pending.png'), Buffer.from(screenshot.data, 'base64'));
        }
        await captureCheckout('pending');
        await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        assert(!(await evaluate('document.documentElement.scrollWidth>innerWidth')), 'PENDING summary must fit mobile viewport');
        await command('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
        // Remove all UX cache, reload and login: backend new-key discovery remains authoritative.
        await evaluate('sessionStorage.clear()'); await command('Page.reload', { ignoreCache: true }); await waitText('Đăng nhập để tải giỏ');
        await evaluate(`[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')==='/login?returnTo=/cart').click()`); await waitText('Chào bạn trở lại');
        await fill('auth-email', authEmail); await fill('auth-password', authPassword); await submit(); await waitText('186.000');
        await clickButton('Đặt hàng'); await waitText('Bạn đang có đơn chưa hoàn tất'); await waitText('Trạng thái: PENDING');
        assert.equal((await database.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1', [row.id])).rows[0].n, 1);
        assert(await evaluate(`[...document.querySelectorAll('.cart-item button')].every(b=>b.disabled)`));
        await clickButton('Hủy đơn chưa thanh toán'); await waitText('Trạng thái: CANCELLED');
        assert.equal((await database.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock, orderCatalogBefore.stock);
        assert(await evaluate(`[...document.querySelectorAll('.cart-item button')].find(b=>b.textContent==='Chỉnh sửa').disabled===false`));
        // Insufficient stock is a definite failure: Cart remains, no extra Order/claim.
        await database.query('UPDATE products SET stock=2 WHERE id=$1', [productId]);
        const insufficientPosts=checkoutPosts.create;await clickButton('Đặt hàng');await waitText('Không đủ tồn kho');
        for(let n=0;n<100;n++){if(checkoutPosts.create>insufficientPosts&&await evaluate(`document.querySelector('.order-checkout').getAttribute('aria-busy')==='false'&&sessionStorage.getItem('brewlite-order-context')===null`))break;await delay(100);}
        assert.equal(checkoutPosts.create,insufficientPosts+1);
        assert(await evaluate(`document.querySelector('.order-checkout').getAttribute('aria-busy')==='false'&&sessionStorage.getItem('brewlite-order-context')===null`));
        assert.equal((await database.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1', [row.id])).rows[0].n, 1);
        assert.equal((await database.query('SELECT stock FROM products WHERE id=$1', [productId])).rows[0].stock, 2);
        assert.equal((await database.query('SELECT count(*)::int AS n FROM cart_items ci JOIN carts c ON c.id=ci.cart_id WHERE c.user_id=$1', [row.id])).rows[0].n, 1);
        assert.equal((await database.query('SELECT count(*)::int AS n FROM payments WHERE user_id=$1', [row.id])).rows[0].n, 0);
        assert.equal((await database.query('SELECT loyalty_points FROM users WHERE id=$1', [row.id])).rows[0].loyalty_points, 0);
        if (verifyPayments) {
          await database.query('UPDATE products SET stock=$2,version=version+1 WHERE id=$1', [productId, orderCatalogBefore.stock]);
          const stock = async () => (await database.query('SELECT stock,version FROM products WHERE id=$1', [productId])).rows[0];
          const latest = async () => (await database.query('SELECT id,status,total::text,paid_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [row.id])).rows[0];
          const counts = async () => (await database.query("SELECT (SELECT count(*)::int FROM payments WHERE user_id=$1 AND status='SUCCEEDED') AS successes,(SELECT count(*)::int FROM loyalty_awards WHERE user_id=$1) AS awards,(SELECT loyalty_points FROM users WHERE id=$1) AS balance", [row.id])).rows[0];
          async function mode(value) {
            const old = paymentBackend; const stopped = new Promise((ok) => old.once('exit', ok)); old.kill(); await stopped;
            processes.splice(processes.indexOf(old), 1);
            paymentBackend = launch(process.execPath, [backendScript], join(root, 'backend'), { ...process.env, PAYMENT_MOCK_MODE: value });
            await ready('http://localhost:3001/health');
          }
          async function addAgain() {
            await evaluate(`[...document.querySelectorAll('.auth-nav a')].find(a=>a.textContent==='Thực đơn').click()`); await waitText('Thực đơn hôm nay');
            await evaluate(`document.querySelector('.detail-link').click()`); await waitText('Thêm vào giỏ');
            await evaluate(`document.querySelector('.cart-options input[value="L"]').click();document.querySelectorAll('.cart-options input[type="checkbox"]')[1].click();document.querySelector('.cart-confirm').click()`); await waitText('Đã thêm vào giỏ.');
            await evaluate(`[...document.querySelectorAll('a')].find(a=>a.textContent==='Xem giỏ').click()`); await waitText('62.000');
          }
          if (verifyCheckout) {
            // A committed create response is lost, then reload/login while GET recovery is offline.
            loseOrderResponse = true;
            await command('Fetch.enable', { patterns: [{urlPattern:'http://localhost:3001/orders',requestStage:'Response'}] });
            await clickButton('Đặt hàng'); await waitText('Chưa xác nhận được kết quả đặt đơn');
            const original = await evaluate(`JSON.parse(sessionStorage.getItem('brewlite-order-context'))`);
            const committed = await latest(); assert.equal(committed.status,'PENDING'); const beforeResume = checkoutPosts.create;
            const committedOrderCount = (await database.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1',[row.id])).rows[0].n;
            await command('Fetch.disable'); failOrderReads = true;
            await command('Fetch.enable', { patterns:[{urlPattern:'http://localhost:3001/orders/*',requestStage:'Request'}] });
            await command('Page.reload',{ignoreCache:true}); await waitText('Đăng nhập để tải giỏ');
            await evaluate(`[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')==='/login?returnTo=/cart').click()`); await waitText('Chào bạn trở lại');
            await fill('auth-email',authEmail); await fill('auth-password',authPassword); await submit(); await waitText('Thử lại cùng yêu cầu');
            assert(await evaluate(`[...document.querySelectorAll('.cart-item button')].every(b=>b.disabled)`));
            await clickButton('Thử lại cùng yêu cầu'); await waitText('Chưa tải được trạng thái đơn');
            const after = await evaluate(`JSON.parse(sessionStorage.getItem('brewlite-order-context'))`);
            assert(after.key===original.key,'Original create key must be preserved'); assert.deepEqual(after.payload,original.payload); assert.equal(after.orderId,committed.id);
            assert.equal(checkoutPosts.create-beforeResume,1);
            const beforeReadOnly = checkoutPosts.create; await clickButton('Thử lại cùng yêu cầu'); await waitText('Chưa tải được trạng thái đơn');
            assert.equal(checkoutPosts.create,beforeReadOnly);
            failOrderReads = false; await command('Fetch.disable'); await clickButton('Mở / tải lại đơn hiện tại'); await waitText('Trạng thái: PENDING');
            assert.equal((await database.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1',[row.id])).rows[0].n,committedOrderCount);
            report.checks.push('B12 lost Order response/reload/login/GET outage: original create key/payload retained, one historical create replay, known ID retry reads GET only, Cart locked until recovery; one Order created');
          } else { await clickButton('Đặt hàng'); await waitText('Trạng thái: PENDING'); }
          const pendingStock = await stock();
          if (verifyCheckout) {
            holdPaymentResponse = true; heldPaymentResponse = undefined;
            await command('Fetch.enable',{patterns:[{urlPattern:'http://localhost:3001/payments',requestStage:'Response'}]});
            const beforePaymentPosts = checkoutPosts.payment; await repeatHandler('payment');
            for (let i=0;i<100&&!heldPaymentResponse;i++) await delay(50);
            assert(heldPaymentResponse); assert.equal(checkoutPosts.payment-beforePaymentPosts,1);
            assert(await evaluate(`document.querySelector('.order-checkout').getAttribute('aria-busy')==='true' && document.body.innerText.includes('Trạng thái: PENDING') && !document.body.innerText.includes('Thanh toán thành công.')`));
            holdPaymentResponse = false; await command('Fetch.continueResponse',{requestId:heldPaymentResponse}); await command('Fetch.disable');
          } else await clickButton('Thanh toán');
          await waitText('Trạng thái: PAID'); await waitText('Giỏ đang trống');
          assert.deepEqual(await stock(), pendingStock); assert.deepEqual(await counts(), { successes: 1, awards: 1, balance: 18 });
          const paid = await latest(); assert(paid.paid_at); assert.equal(paid.total, '186000');
          report.checks.push('B11 A: login/add/create PENDING/pay WALLET success → PAID; Payment amount186000/SUCCEEDED, award18/balance18, purchased Cart empty/unlocked, stock/version unchanged during success');
          await addAgain(); await clickButton('Đặt hàng'); await waitText('Trạng thái: PENDING');
          await mode('FAILURE');
          if (verifyCheckout) {
            await evaluate(`document.querySelector('#checkout-method').focus()`);
            await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}); await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
            assert(await evaluate(`document.activeElement.dataset.checkoutAction==='payment' && !document.activeElement.disabled && document.activeElement.matches(':focus-visible') && parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0`));
            await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13}); await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
          } else await clickButton('Thanh toán');
          await waitText('Trạng thái: PAYMENT_FAILED'); await waitText('Thanh toán thất bại.'); await captureCheckout('failed');
          assert.equal((await stock()).stock, orderCatalogBefore.stock - 3); assert.deepEqual(await counts(), { successes: 1, awards: 1, balance: 18 });
          assert(await evaluate(`[...document.querySelectorAll('.cart-item button')].every(b=>b.disabled)`));
          const failedOrder = await latest();
          assert.equal((await database.query("SELECT status,failure_code,amount::text FROM payments WHERE order_id=$1", [failedOrder.id])).rows[0].failure_code, 'MOCK_DECLINED');
          await clickButton('Thử lại thanh toán'); await waitText('Thanh toán thất bại.');
          for (let i = 0; i < 50; i++) { if ((await database.query('SELECT count(*)::int AS n FROM payments WHERE order_id=$1', [failedOrder.id])).rows[0].n === 2) break; await delay(100); }
          assert.equal((await stock()).stock, orderCatalogBefore.stock - 3);
          if (verifyCheckout) {
            const releasedStock = await stock();
            await database.query('UPDATE products SET stock=0,version=version+1 WHERE id=$1',[productId]);
            await clickButton('Thử lại thanh toán'); await waitText('Không đủ tồn kho để thử lại thanh toán.');
            assert.equal((await latest()).status,'PAYMENT_FAILED');
            assert.equal((await database.query('SELECT count(*)::int AS n FROM payments WHERE order_id=$1',[failedOrder.id])).rows[0].n,2);
            assert.deepEqual(await counts(),{successes:1,awards:1,balance:18});
            await database.query('UPDATE products SET stock=$2,price=price+7,version=version+1 WHERE id=$1',[productId,releasedStock.stock]);
          }
          await mode('SUCCESS');
          await evaluate(`const select=document.querySelector('.order-checkout select');select.value='CARD';select.dispatchEvent(new Event('change',{bubbles:true}))`);
          await clickButton('Thử lại thanh toán'); await waitText('Trạng thái: PAID'); await waitText('Giỏ đang trống');
          assert.equal((await stock()).stock, orderCatalogBefore.stock - 4); assert.deepEqual(await counts(), { successes: 2, awards: 2, balance: 24 });
          assert.equal((await database.query("SELECT method FROM payments WHERE order_id=$1 AND status='SUCCEEDED'", [failedOrder.id])).rows[0].method, 'CARD');
          if (verifyCheckout) {
            assert.equal((await database.query("SELECT amount::text FROM payments WHERE order_id=$1 AND status='SUCCEEDED'",[failedOrder.id])).rows[0].amount,'62000');
            await database.query('UPDATE products SET price=$2 WHERE id=$1',[productId,orderCatalogBefore.price]);
            report.checks.push('B12 failed retry stock exhaustion returns actionable OUT_OF_STOCK without Payment/award; replenished retry ignores changed catalog price and pays immutable62000 snapshot exactly once');
          }
          report.checks.push('B11 B/C: server FAILURE → PAYMENT_FAILED/MOCK_DECLINED, restore once, Cart preserved/locked/no award; failed retry reacquires/restores; server SUCCESS then CARD retry → PAID on same snapshot, stock reacquired, award6/balance24, one success/order, Cart cleared');
          await addAgain(); await clickButton('Đặt hàng'); await waitText('Trạng thái: PENDING'); await mode('FAILURE');
          await clickButton('Thanh toán'); await waitText('Trạng thái: PAYMENT_FAILED'); const beforeCancel = await stock();
          await clickButton('Hủy đơn chưa thanh toán'); await waitText('Trạng thái: CANCELLED'); assert.deepEqual(await stock(), beforeCancel);
          assert(await evaluate(`[...document.querySelectorAll('.cart-item button')].find(b=>b.textContent==='Chỉnh sửa').disabled===false`));
          assert.deepEqual(await counts(), { successes: 2, awards: 2, balance: 24 });
          report.checks.push('B11 D: PAYMENT_FAILED cancel → CANCELLED, stock/version unchanged (no double restore), Cart preserved/unlocked, no additional award');
          await mode('SUCCESS'); await clickButton('Đặt hàng'); await waitText('Trạng thái: PENDING');
          losePaymentResponse = true; await command('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:3001/payments', requestStage: 'Response' }] });
          await clickButton('Thanh toán'); await waitText('Chưa xác nhận được kết quả');
          assert.equal((await latest()).status, 'PAID'); const beforeReplay = await counts(); const beforeReplayStock = await stock(); assert.deepEqual(beforeReplay, { successes: 3, awards: 3, balance: 30 });
          assert(await evaluate(`!!JSON.parse(sessionStorage.getItem('brewlite-payment-context')).key`));
          await command('Fetch.disable');
          // Reload/login preserves the transport key and reads current PAID before replay.
          const originalPayment = verifyCheckout ? await evaluate(`JSON.parse(sessionStorage.getItem('brewlite-payment-context'))`) : null;
          if (verifyCheckout) {
            failOrderReads = true;
            await command('Fetch.enable',{patterns:[{urlPattern:'http://localhost:3001/orders/*',requestStage:'Request'}]});
          }
          await command('Page.reload', { ignoreCache: true }); await waitText('Đăng nhập để tải giỏ');
          await evaluate(`[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')==='/login?returnTo=/cart').click()`); await waitText('Chào bạn trở lại');
          await fill('auth-email', authEmail); await fill('auth-password', authPassword); await submit(); await waitText('Thử lại cùng yêu cầu thanh toán');
          if (verifyCheckout) {
            await waitText('Chưa tải được trạng thái đơn');
            const retained = await evaluate(`JSON.parse(sessionStorage.getItem('brewlite-payment-context'))`);
            assert(retained.key===originalPayment.key,'Original payment key must be preserved'); assert.deepEqual(retained.payload,originalPayment.payload);
            assert(await evaluate(`!document.body.innerText.includes('Thanh toán thành công.') && document.querySelector('#checkout-method').disabled`));
            failOrderReads = false; failCartReads = true;
            await command('Fetch.enable',{patterns:[{urlPattern:'http://localhost:3001/cart',requestStage:'Request'}]});
          }
          await clickButton('Thử lại cùng yêu cầu thanh toán'); await waitText('Thanh toán thành công.'); await waitText('Giỏ đang trống');
          if (verifyCheckout) {
            await waitText('Đã đọc trạng thái đơn nhưng chưa tải được giỏ.');
            assert(await evaluate(`document.querySelector('[data-checkout-action="create"]').disabled && !document.querySelector('[data-checkout-action="payment"]') && !document.body.innerText.includes('Giỏ đã được cập nhật.')`));
            failCartReads = false; await command('Fetch.disable'); await clickButton('Mở / tải lại đơn hiện tại'); await waitText('Giỏ đã được cập nhật.');
            report.checks.push('B12 payment GET recovery outage preserves method/key/payload and shows no fake PAID; successful replay plus Cart GET outage keeps PAID but blocks new checkout until readonly refresh, never charges again');
          }
          for (let i = 0; i < 100; i++) {
            if (await evaluate(`sessionStorage.getItem('brewlite-payment-context')===null`)) break;
            await delay(100);
          }
          assert.deepEqual(await counts(), beforeReplay); assert(await evaluate(`sessionStorage.getItem('brewlite-payment-context')===null`));
          assert.deepEqual(await stock(), beforeReplayStock);
          report.checks.push('B11 lost response after real committed success: UI retains key/payload, reload/login reads current PAID, same-key replay causes no duplicate Payment/award/balance/stock, Cart remains empty');
          for (const width of [390, 1366]) { await command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false }); assert(!(await evaluate('document.documentElement.scrollWidth>innerWidth'))); }
          await captureCheckout('paid');
          if (!verifyLoyalty) { const paidScreenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(root, verifyCheckout ? `Docs/${checkoutEvidencePrefix}-order-paid.png` : 'Docs/B11-order-paid.png'), Buffer.from(paidScreenshot.data, 'base64')); }
          report.paymentVerification = { success: true, failure: true, retryFailure: true, retrySuccess: true, failedCancel: true, lostResponseReplay: true, postgres: await counts(), humanManualQA: false };
          if (verifyCheckout) {
            report.checkoutAcceptance = { repeatedHandlersSinglePost:true, lostOrderResponse:true, orderReadOutage:true, paymentReadOutage:true, cartReadOutage:true, keyboardPayment:true, snapshotPriceDrift:true, staleCart:true, promotionInputRetained:true, retryStockExhaustion:true, noFakePaid:true };
            await command('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
            assert(await evaluate(`(()=>{const probe=document.createElement('div');probe.className='loading-mark';document.body.append(probe);const stopped=getComputedStyle(probe).animationName==='none';probe.remove();return matchMedia('(prefers-reduced-motion: reduce)').matches&&stopped;})()`));
            report.checks.push('B12 focus-visible keyboard Tab/Enter payment, explicit labels/status/busy/44px controls, reduced-motion media respected; PENDING/FAILED/PAID at390/768/1366 without overflow');
          }
          if (verifyPromotions) {
            const promotionId = randomUUID(); const promotionCode = 'B13' + randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase();
            promotionFixtures.push(promotionId);
            await database.query(`INSERT INTO promotions(id,code,discount_amount,minimum_subtotal,starts_at,ends_at,is_active)
              VALUES($1,$2,10000,62000,'2020-01-01Z','2100-01-01Z',true)`, [promotionId, promotionCode]);
            const promotionOrder = async (id) => (await database.query('SELECT id,status,subtotal::text,discount_amount::text,total::text,promotion_id,promotion_code_snapshot FROM orders WHERE id=$1', [id])).rows[0];
            const promotionPayment = async (id) => (await database.query('SELECT amount::text,status FROM payments WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [id])).rows[0];
            await addAgain();
            await fill('checkout-promotion', ` ${promotionCode.toLowerCase()} `);
            assert(await evaluate(`!document.querySelector('.order-summary') && document.querySelector('#checkout-promotion-note').textContent.includes('Mã được kiểm tra')`));
            holdOrderResponse = true; heldOrderResponse = undefined;
            await command('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:3001/orders', requestStage: 'Response' }] });
            await clickButton('Đặt hàng');
            for (let i = 0; i < 100 && !heldOrderResponse; i++) await delay(50);
            assert(heldOrderResponse);
            assert(await evaluate(`document.querySelector('.order-checkout').getAttribute('aria-busy')==='true' && document.querySelector('#checkout-promotion').disabled && !document.querySelector('.order-summary')`));
            holdOrderResponse = false; await command('Fetch.continueResponse', { requestId: heldOrderResponse }); await command('Fetch.disable');
            await waitText('Trạng thái: PENDING'); await waitText('52.000'); await waitText(promotionCode);
            const a = await latest(); const aSnapshot = await promotionOrder(a.id);
            assert.deepEqual(aSnapshot, { id: a.id, status: 'PENDING', subtotal: '62000', discount_amount: '10000', total: '52000', promotion_id: promotionId, promotion_code_snapshot: promotionCode });
            assert(await evaluate(`document.querySelector('[data-checkout-action="payment"]').textContent.includes('52.000')`));
            await captureCheckout('promotion-pending');
            await clickButton('Thanh toán'); await waitText('Trạng thái: PAID'); await waitText('Giỏ đang trống');
            assert.deepEqual(await promotionPayment(a.id), { amount: '52000', status: 'SUCCEEDED' });
            assert.deepEqual(await counts(), { successes: 4, awards: 4, balance: 35 });
            report.checks.push('B13 A: valid normalized DB code, minimum equality, loading input disabled/no premature confirmed discount, snapshot62000-10000=52000, WALLET Payment52000, award5 once, Cart clear');
            await addAgain(); await fill('checkout-promotion', 'B13ABSENT');
            const bStock = await stock(); const bCounts = await counts();
            const bOrders = (await database.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1', [row.id])).rows[0].n;
            await clickButton('Đặt hàng'); await waitText('Mã giảm giá không hợp lệ');
            assert.equal(await evaluate(`document.querySelector('#checkout-promotion').value`), 'B13ABSENT');
            assert.equal((await database.query('SELECT count(*)::int AS n FROM orders WHERE user_id=$1', [row.id])).rows[0].n, bOrders);
            assert.deepEqual(await stock(), bStock); assert.deepEqual(await counts(), bCounts);
            assert.equal((await database.query('SELECT ci.qty FROM cart_items ci JOIN carts c ON c.id=ci.cart_id WHERE c.user_id=$1', [row.id])).rows[0].qty, 1);
            report.checks.push('B13 B: invalid code422 shown safely with typed code retained, Cart qty1 preserved, no Order/stock/Payment/Loyalty mutation');
            await fill('checkout-promotion', promotionCode); await clickButton('Đặt hàng'); await waitText('Trạng thái: PENDING');
            const c = await latest();
            await mode('FAILURE'); await clickButton('Thanh toán'); await waitText('Trạng thái: PAYMENT_FAILED');
            assert.deepEqual(await counts(), bCounts);
            await database.query(`UPDATE promotions SET code=$2,discount_amount=1,minimum_subtotal=999999999999,is_active=false,ends_at='2021-01-01Z',updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [promotionId, 'CHANGED' + promotionCode]);
            // A resolved failure clears transport cache; backend unpaid discovery restores the snapshot.
            await command('Page.reload', { ignoreCache: true }); await waitText('Đăng nhập để tải giỏ');
            await evaluate(`[...document.querySelectorAll('a')].find(a=>a.getAttribute('href')==='/login?returnTo=/cart').click()`); await waitText('Chào bạn trở lại');
            await fill('auth-email', authEmail); await fill('auth-password', authPassword); await submit(); await waitText('62.000');
            await clickButton('Đặt hàng'); await waitText('Trạng thái: PAYMENT_FAILED'); await waitText(promotionCode); await waitText('52.000');
            await mode('SUCCESS'); await clickButton('Thử lại thanh toán'); await waitText('Trạng thái: PAID'); await waitText('Giỏ đang trống');
            assert.deepEqual(await promotionPayment(c.id), { amount: '52000', status: 'SUCCEEDED' });
            assert.deepEqual(await counts(), { successes: 5, awards: 5, balance: 40 });
            assert.equal((await promotionOrder(c.id)).promotion_code_snapshot, promotionCode);
            await captureCheckout('promotion-paid');
            report.checks.push('B13 C: failed Payment no award; promotion code/amount/minimum/active/expiry changed after create; reload/login restores original snapshot; retry pays52000 and awards5 once, no reprice');
            report.promotionVerification = { A: aSnapshot, B: { rejected: true, cartPreserved: true, noSideEffects: true }, C: await promotionOrder(c.id), postgres: await counts(), humanManualQA: false };
          }
          if (verifyLoyalty) {
            // All B06-B13 browser regression has finished; exercise B14 against the same real apps/database.
            const baseline = (await counts()).balance; assert.equal(baseline, 40);
            loyaltyReadMode = 'hold'; heldLoyaltyRead = undefined;
            await command('Fetch.enable', { patterns:[{urlPattern:'http://localhost:3001/loyalty',requestStage:'Request'}] });
            await evaluate(`document.querySelector('.auth-nav a[href="/loyalty"]').click()`); await waitText('Đang tải điểm tích lũy');
            for (let i=0;i<100&&!heldLoyaltyRead;i++) await delay(50);
            assert(heldLoyaltyRead); assert(await evaluate(`document.querySelector('.loyalty-panel').getAttribute('aria-busy')==='true' && document.querySelector('.loyalty-panel button').disabled && !document.querySelector('[data-loyalty-points]')`));
            loyaltyReadMode='real'; await command('Fetch.continueRequest',{requestId:heldLoyaltyRead}); await waitText('Số điểm hiện tại');
            assert.equal(await evaluate(`document.querySelector('[data-loyalty-points]').getAttribute('data-loyalty-points')`), '40');
            const layouts=[];
            for (const [width,height] of [[390,844],[768,1024],[1366,768]]) {
              await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false}); await delay(100);
              const layout=await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,buttonHeight:document.querySelector('.loyalty-panel button').getBoundingClientRect().height})`);
              assert(!layout.overflow); assert(layout.buttonHeight>=44); layouts.push({width,height,...layout});
              await command('Page.bringToFront');
              const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); writeFileSync(join(root,`Docs/${checkoutEvidencePrefix}-loyalty-${width}.png`),Buffer.from(shot.data,'base64'));
            }
            const readsBefore=loyaltyReads;
            await evaluate(`document.querySelector('.auth-nav a[href="/"]').click()`); await waitText('Cappuccino'); await showLoyalty(40); assert(loyaltyReads>readsBefore);
            loyaltyReadMode='error'; await evaluate(`document.querySelector('.loyalty-panel button').click()`); await waitText('Chưa tải được điểm tích lũy');
            assert(await evaluate(`!!document.querySelector('[role="alert"]')&&!document.querySelector('[data-loyalty-points]')&&!/Prisma|SELECT|password_hash/.test(document.body.innerText)`));
            loyaltyReadMode='real';
            await evaluate(`document.querySelector('.loyalty-panel button').focus()`);
            await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}); await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
            await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',modifiers:8,windowsVirtualKeyCode:9}); await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',modifiers:8,windowsVirtualKeyCode:9});
            assert(await evaluate(`document.activeElement===document.querySelector('.loyalty-panel button')&&document.activeElement.matches(':focus-visible')&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0`));
            await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13}); await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
            await waitText('Số điểm hiện tại'); assert.equal(await evaluate(`document.querySelector('[data-loyalty-points]').getAttribute('data-loyalty-points')`),'40');
            await command('Fetch.disable');
            await command('Page.reload',{ignoreCache:true}); await waitText('Đăng nhập để xem điểm tích lũy');
            await evaluate(`document.querySelector('a[href="/login?returnTo=/loyalty"]').click()`); await waitText('Chào bạn trở lại');
            await fill('auth-email',authEmail); await fill('auth-password',authPassword); await submit(); await waitText('Số điểm hiện tại');
            assert.equal(await evaluate(`document.querySelector('[data-loyalty-points]').getAttribute('data-loyalty-points')`),'40');
            // Payment failure preserves balance. Read actual API during failure; then retry SUCCESS and open UI again.
            await addAgain(); await clickButton('Đặt hàng'); await waitText('Trạng thái: PENDING'); const loyaltyOrder=await latest();
            await mode('FAILURE'); await clickButton('Thanh toán'); await waitText('Trạng thái: PAYMENT_FAILED'); assert.equal((await counts()).balance,40);
            const failedBalance=await evaluate(`fetch('http://localhost:3001/loyalty',{cache:'no-store',headers:{Authorization:'Bearer '+${JSON.stringify(loginPayload.accessToken)}}}).then(async r=>({status:r.status,...await r.json()}))`);
            assert.deepEqual(failedBalance,{status:200,loyaltyPoints:40,reservedPoints:0,outstandingReversalPoints:'0',pointValueVnd:'100'});
            await showLoyalty(40); await evaluate(`document.querySelector('.auth-nav a[href="/cart"]').click()`); await waitText('62.000');
            await clickButton('Đặt hàng'); await waitText('Trạng thái: PAYMENT_FAILED');
            await mode('SUCCESS'); await clickButton('Thử lại thanh toán'); await waitText('Trạng thái: PAID'); await waitText('Giỏ đang trống');
            assert.deepEqual(await counts(),{successes:6,awards:6,balance:46}); await showLoyalty(46);
            const success=(await database.query("SELECT idempotency_key,method FROM payments WHERE order_id=$1 AND status='SUCCEEDED'",[loyaltyOrder.id])).rows[0];
            const replayStatus=await evaluate(`fetch('http://localhost:3001/payments',{method:'POST',headers:{Authorization:'Bearer '+${JSON.stringify(loginPayload.accessToken)},'Content-Type':'application/json','Idempotency-Key':${JSON.stringify(success.idempotency_key)}},body:JSON.stringify({orderId:${JSON.stringify(loyaltyOrder.id)},method:${JSON.stringify(success.method)}})}).then(r=>r.status)`);
            assert.equal(replayStatus,200); await evaluate(`document.querySelector('.loyalty-panel button').click()`); await waitText('Số điểm hiện tại');
            assert.deepEqual(await counts(),{successes:6,awards:6,balance:46});
            assert.equal(await evaluate(`document.querySelector('[data-loyalty-points]').getAttribute('data-loyalty-points')`),'46');
            // A second real user has zero points and cannot see the first user's balance.
            const otherEmail=`${randomUUID()}@example.invalid`;
            otherLoyaltyUser=(await database.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) RETURNING id',[randomUUID(),otherEmail,await bcrypt.hash(authPassword,10)])).rows[0].id;
            await evaluate(`document.querySelector('.nav-button').click()`); await waitText('Đăng nhập để xem điểm tích lũy');
            await evaluate(`document.querySelector('a[href="/login?returnTo=/loyalty"]').click()`); await waitText('Chào bạn trở lại');
            await fill('auth-email',otherEmail); await fill('auth-password',authPassword); await submit(); await waitText('Bạn chưa có điểm tích lũy');
            assert.equal(await evaluate(`document.querySelector('[data-loyalty-points]').getAttribute('data-loyalty-points')`),'0');
            loyaltyReadMode='unauthorized'; await command('Fetch.enable',{patterns:[{urlPattern:'http://localhost:3001/loyalty',requestStage:'Request'}]});
            await evaluate(`document.querySelector('.loyalty-panel button').click()`); await waitText('Đăng nhập để xem điểm tích lũy');
            assert(await evaluate(`!document.querySelector('[data-loyalty-points]')&&!document.querySelector('.nav-button')`));
            loyaltyReadMode='real'; await command('Fetch.disable');
            await database.query('DELETE FROM carts WHERE user_id=$1',[otherLoyaltyUser]);
            await database.query('DELETE FROM users WHERE id=$1',[otherLoyaltyUser]); otherLoyaltyUser=null;
            await evaluate(`document.querySelector('a[href="/login?returnTo=/loyalty"]').click()`); await waitText('Chào bạn trở lại');
            await fill('auth-email',authEmail); await fill('auth-password',authPassword); await submit(); await waitText('Số điểm hiện tại');
            assert.equal(await evaluate(`document.querySelector('[data-loyalty-points]').getAttribute('data-loyalty-points')`),'46');
            report.loyaltyVerification={initial:0,afterRegression:40,afterFailedPayment:failedBalance.loyaltyPoints,afterRetry:46,replayBalance:46,otherUser:0,reads:loyaltyReads,layouts,postgres:await counts(),humanManualQA:false};
            report.checks.push('B14: fresh owned DB balance rather than login snapshot, loading/no cached balance, route re-entry re-fetch, network error and keyboard Enter Retry, reload/login re-fetch, FAILURE unchanged40, retry SUCCESS46 once, replay/refetch unchanged46, second real account0,401 clears UI/session; responsive390/768/1366');
            await evaluate(`document.querySelector('.auth-nav a[href="/cart"]').click()`); await waitText('Giỏ đang trống');
          }
          if (verifyHistory) await verifyHistoryBrowser({ evaluate,command,waitText,delay,database,root,report,evidencePrefix:checkoutEvidencePrefix,ownerId:row.id,email:authEmail,password:authPassword,
            fill,submit,addAgain,clickButton,latest,mode,checkoutPosts,promotionFixtures,token:(id)=>loginPayload?.user?.id===id?loginPayload.accessToken:null,
            setReadMode:(value)=>{historyReadMode=value;if(value==='hold')heldHistoryRead=undefined;},heldRead:()=>heldHistoryRead });
          if (verifyRbac) await verifyRbacBrowser({ evaluate, command, waitText, navigate, database, root, report, guardPort,
            evidencePrefix: checkoutEvidencePrefix, loginPayload: () => loginPayload, customerEmail: authEmail, customerPassword: authPassword });
          if (verifyOperator) await verifyOperatorBrowser({ evaluate, command, waitText, navigate, delay, database, root, report,
            evidencePrefix:checkoutEvidencePrefix,
            customerId: row.id, customerEmail: authEmail, customerPassword: authPassword, loginPayload: () => loginPayload, checkoutPosts,
            setReadMode: (value) => { operatorReadMode = value; if (value === 'hold') heldOperatorRead = undefined; }, heldRead: () => heldOperatorRead });
          if (verifyWorkflow) await verifyWorkflowBrowser({evaluate,command,waitText,navigate,delay,database,root,report,backendUrl,customerId:row.id,customerEmail:authEmail,customerPassword:authPassword,loginPayload:()=>loginPayload,
            posts:()=>workflowPosts,setMutationMode:(value)=>{workflowMutationMode=value;heldWorkflowMutation=undefined;},heldMutation:()=>heldWorkflowMutation,
            setReadMode:(value)=>{operatorReadMode=value;},evidencePrefix:checkoutEvidencePrefix});
          if(verifyProducts)await verifyProductsBrowser({evaluate,command,waitText,navigate,delay,database,root,report,backendUrl,customerId:row.id,customerEmail:authEmail,customerPassword:authPassword,loginPayload:()=>loginPayload,clickButton,mode,posts:()=>productMutations,setReadMode:value=>{productReadMode=value;heldProductRead=undefined;},heldRead:()=>heldProductRead,setMutationMode:value=>{productMutationMode=value;heldProductMutation=undefined;},heldMutation:()=>heldProductMutation,evidencePrefix:checkoutEvidencePrefix});
          if(verifyUi01)await verifyUi01Browser({evaluate,command,waitText,navigate,delay,database,root,report,backendUrl,loginPayload:()=>loginPayload,mode,customerEmail:authEmail,customerPassword:authPassword,evidencePrefix:checkoutEvidencePrefix});
          if(verifyOptions)await verifyOptionsBrowser({evaluate,command,waitText,navigate,delay,database,root,report,backendUrl,loginPayload:()=>loginPayload,customerEmail:authEmail,customerPassword:authPassword,setMutationMode:value=>{productMutationMode=value;heldProductMutation=undefined;},heldMutation:()=>heldProductMutation,evidencePrefix:checkoutEvidencePrefix});
          if(verifyInventory)await verifyInventoryBrowser({evaluate,command,waitText,navigate,delay,database,root,report,backendUrl,loginPayload:()=>loginPayload,customerEmail:authEmail,customerPassword:authPassword,posts:()=>productMutations,setMutationMode:value=>{productMutationMode=value;heldProductMutation=undefined;},heldMutation:()=>heldProductMutation,setReadMode:value=>{inventoryReadMode=value;heldInventoryRead=undefined;},heldRead:()=>heldInventoryRead,evidencePrefix:checkoutEvidencePrefix});
          if(verifyLoyaltyRedemption)await verifyLoyaltyRedemptionBrowser({evaluate,command,waitText,navigate,delay,database,root,report,backendUrl,loginPayload:()=>loginPayload,customerEmail:authEmail,customerPassword:authPassword,setPaymentMode:async value=>{await mode(value);}});
          if(!verifyWorkflow)await database.query('DELETE FROM payments WHERE user_id=$1', [row.id]); if(!verifyWorkflow)await database.query('DELETE FROM loyalty_awards WHERE user_id=$1', [row.id]);
        }
        if(!verifyWorkflow){ await database.query('UPDATE products SET price=$2,stock=$3,version=$4,updated_at=$5 WHERE id=$1', [productId, orderCatalogBefore.price, orderCatalogBefore.stock, orderCatalogBefore.version, orderCatalogBefore.updated_at]);
        orderCatalogBefore = null;
        await database.query('DELETE FROM idempotency_requests WHERE user_id=$1', [row.id]);
        await database.query('DELETE FROM order_item_toppings WHERE order_item_id IN (SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.user_id=$1)', [row.id]);
        await database.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id=$1)', [row.id]);
        await database.query('DELETE FROM orders WHERE user_id=$1', [row.id]);
        if (verifyPromotions) {
          for (const id of promotionFixtures) await database.query('DELETE FROM promotions WHERE id=$1', [id]);
          assert.equal(JSON.stringify((await database.query('SELECT * FROM promotions ORDER BY id')).rows), promotionsBefore);
          report.checks.push('B13 fixture Promotion rows removed; all pre-existing Promotion rows unchanged');
        }
        }
        await evaluate('sessionStorage.clear()');
        report.checks.push('B10 real browser: PENDING creation price drift/snapshots, stock -3, Cart preserved and write controls locked; storage removed/reload/login/new-key discovers existingOrderId, one Order only; cancel restores stock/unlocks; insufficient stock preserves Cart/no partial Order; zero Payment/Loyalty; all fixture history and catalog changes restored');
      }
      if (!verifyPayments) await evaluate(`[...document.querySelectorAll('.cart-item button')].find(b=>b.textContent==='Xóa').click()`); await waitText('Giỏ đang trống');
      assert.equal((await database.query('SELECT count(*)::int AS n FROM cart_items ci JOIN carts c ON c.id=ci.cart_id WHERE c.user_id=$1', [row.id])).rows[0].n, 0);
      report.checks.push(verifyPayments ? 'B08 logout/login retains cart; B11 purchased Cart clear renders empty and DB has zero items; all catalog price/stock/version/updated_at restored' : 'B08 logout/login retains cart, remove renders empty and DB has zero items; all catalog price/stock/version/updated_at unchanged');
    }
    await command('Page.reload', { ignoreCache: true }); await waitText('Đăng nhập'); await waitText(verifyCart ? 'Đăng nhập để tải giỏ' : 'Cappuccino');
    assert(!(await evaluate(`document.body.innerText.includes('Đăng xuất')`)));
    // Only fixture row created by this run; no cascade or bulk cleanup.
    if (verifyCart) await database.query('DELETE FROM carts WHERE user_id=$1', [row.id]);
    if(!verifyWorkflow)await database.query('DELETE FROM users WHERE id=$1 AND email=$2', [row.id, authEmail]);
    loginPayload = null;
    report.checks.push('auth browser: validation/register/login error/success, bcrypt10 DB hash, no auto-login, guard200/no-token401 on verification-only endpoint, logout clear, reload loses memory, fixture user removed; no credentials/tokens in evidence');
  }
  if(!verifyWorkflow)assert.equal(await snapshot(), before); assert(report.requests.some((r) => r.url === backendUrl+'/products' && r.status === 200));
  assert(report.requests.some((r) => r.url.endsWith('/11111111-1111-4111-8111-111111111111') && r.status === 200));
  report.checks.push('real browser Network events confirm backend GETs and database unchanged');
  if (verifyProducts) { assert.equal(report.runtimeExceptions, 0); assert.equal(report.hydrationWarnings, 0); }
  report.verifiedAt = new Date().toISOString();
  report.frontendMode = reuseFrontend ? 'existing local frontend reused; never stopped by harness' : 'owned compiled frontend process';
  report.backendMode = reuseBackend ? 'existing backend3001 reused; guard probe on owned separate verification port' : `owned compiled backend${new URL(backendUrl).port} (NODE_ENV=${process.env.NODE_ENV}); guard probe on separate verification port`;
  if(verifyWorkflow)report.testEnvironment={frontendUrl,backendUrl,frontend:'compiled byte-identical source snapshot in owned .tmp directory',developmentServersPreserved:true};
  writeFileSync(join(root, evidencePrefix && verifyHistory ? `Docs/${evidencePrefix}_CUSTOMER_REGRESSION_BROWSER_EVIDENCE.json` : verifyHistory ? 'Docs/B15_ORDER_HISTORY_BROWSER_EVIDENCE.json' : verifyLoyalty ? 'Docs/B14_LOYALTY_BROWSER_EVIDENCE.json' : verifyPromotions ? 'Docs/B13_PROMOTION_BROWSER_EVIDENCE.json' : verifyCheckout ? 'Docs/B12_CHECKOUT_BROWSER_EVIDENCE.json' : verifyPayments ? 'Docs/B11_PAYMENT_BROWSER_EVIDENCE.json' : verifyOrders ? 'Docs/B10_ORDER_BROWSER_EVIDENCE.json' : verifyCart ? 'Docs/B08_CART_BROWSER_EVIDENCE.json' : verifyAuth ? 'Docs/B07_AUTH_BROWSER_EVIDENCE.json' : 'Docs/B06_BROWSER_EVIDENCE.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  socket?.close(); for (const process of processes.reverse()) process.kill();
  if (otherLoyaltyUser) {
    await database.query('DELETE FROM carts WHERE user_id=$1', [otherLoyaltyUser]);
    await database.query('DELETE FROM users WHERE id=$1', [otherLoyaltyUser]);
  }
  if (authEmail && databaseConnected && !verifyWorkflow) { try {
    if (verifyOrders) {
      if (orderCatalogBefore) await database.query('UPDATE products SET price=$2,stock=$3,version=$4,updated_at=$5 WHERE id=$1', [orderCatalogBefore.id, orderCatalogBefore.price, orderCatalogBefore.stock, orderCatalogBefore.version, orderCatalogBefore.updated_at]);
      if (verifyPayments) {
        await database.query('DELETE FROM payments WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [authEmail]);
        await database.query('DELETE FROM loyalty_awards WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [authEmail]);
      }
      await database.query('DELETE FROM idempotency_requests WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [authEmail]);
      await database.query('DELETE FROM order_item_toppings WHERE order_item_id IN (SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN users u ON u.id=o.user_id WHERE u.email=$1)', [authEmail]);
      await database.query('DELETE FROM order_items WHERE order_id IN (SELECT o.id FROM orders o JOIN users u ON u.id=o.user_id WHERE u.email=$1)', [authEmail]);
      await database.query('DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [authEmail]);
    }
    for (const id of promotionFixtures) await database.query('DELETE FROM promotions WHERE id=$1', [id]);
    if (verifyCart) await database.query('DELETE FROM carts WHERE user_id IN (SELECT id FROM users WHERE email=$1)', [authEmail]);
    await database.query('DELETE FROM users WHERE email=$1', [authEmail]);
  } catch { /* no fixture if startup failed */ } }
  if (databaseConnected) await database.end(); await delay(1500);
  if (browserSchemaCreated) {
    await browserAdmin.query('SET search_path TO public');await browserAdmin.query(`DROP SCHEMA "${browserSchema}" CASCADE`);
    assert.equal(await publicFingerprint(),originalPublicFingerprint,'A03 browser must preserve all public development tables');
    report.databaseIsolation={schema:'owned UUID schema',cleanup:true,publicFingerprintUnchanged:true,productionDataUsed:false};
    if(report.verifiedAt)writeFileSync(join(root,`Docs/${evidencePrefix}_CUSTOMER_REGRESSION_BROWSER_EVIDENCE.json`),JSON.stringify(report,null,2)+'\n');
    console.log('A03 isolated schema cleaned; all public development table fingerprints unchanged');
  }
  if(browserAdminConnected)await browserAdmin.end();
  const expectedRoot = resolve(tmpdir()) + sep;
  if (resolve(profile).startsWith(expectedRoot) && profile.split(sep).at(-1).startsWith('brewlite-b06-')) {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { console.log('Owned browser temporary profile remains locked; no workspace data affected'); }
  }
}
