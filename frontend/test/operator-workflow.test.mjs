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
const { WorkflowControls } = require('../src/components/operator-workflow.tsx');
const { sendWorkflow, canRetryOriginal } = require('../src/lib/api/operator-workflow.ts');
const { useAuthStore } = require('../src/lib/auth-store.ts');
process.env.NEXT_PUBLIC_API_BASE_URL = 'http://localhost:3001'; const originalFetch = globalThis.fetch;
const id = randomUUID(); const actor = randomUUID();
const order = { id, orderCode: 'BL-fixture', status: 'PAID', currency: 'VND', subtotal: '120000', discountAmount: '0', total: '120000', promotionCode: null,
  createdAt: '2026-10-12T00:00:00Z', paidAt: '2026-10-12T00:01:00Z', updatedAt: '2026-10-12T00:01:00Z', version: 3, earnedPoints: 12, paymentStatus: 'SUCCEEDED',
  items: [{ productId: id, productName: 'Historical drink', size: 'M', qty: 4, unitPrice: '30000', lineTotal: '120000', toppings: [] }] };
const command = { id, sourceStatus: 'PAID', expectedVersion: 3, targetStatus: 'PREPARING' };
const session = (role = 'STAFF', owner = actor) => ({ accessToken: 'fixture-' + owner + '-' + role, expiresIn: 3600, user: { id: owner, email: 'fixture@example.invalid', role, loyaltyPoints: 0 } });
const html = (props = {}) => renderToStaticMarkup(React.createElement(WorkflowControls, { order, role: 'STAFF', phase: 'idle', message: '', act:()=>{}, confirm:()=>{}, dismiss:()=>{}, reload:()=>{}, retry:()=>{}, ...props }));
afterEach(() => { useAuthStore.getState().clear(); globalThis.fetch = originalFetch; });
test('only correct preparation action appears for PAID/PREPARING/READY', () => {
  for (const [status,target,label] of [['PAID','PREPARING','Bắt đầu pha chế'],['PREPARING','READY','Đánh dấu sẵn sàng'],['READY','COMPLETED','Hoàn thành đơn']]) {
    for (const role of ['STAFF','ADMIN']) { const value=html({order:{...order,status},role}); assert(value.includes(`data-workflow-target="${target}"`)); assert(value.includes(label)); assert.equal((value.match(/data-workflow-target/g)??[]).length,1); }
  }
});
test('unpaid/terminal Orders have no workflow or cancel action; CUSTOMER sees none', () => {
  for (const status of ['PENDING','PAYMENT_FAILED','COMPLETED','CANCELLED']) { const value=html({order:{...order,status},role:'ADMIN'}); assert(!value.includes('data-workflow-target')); assert(!value.includes('data-workflow-cancel')); }
  assert.equal(html({role:'CUSTOMER'}),'');
});
test('STAFF cannot see paid-cancel; ADMIN sees it only while PAID', () => {
  assert(!html().includes('data-workflow-cancel')); assert(html({role:'ADMIN'}).includes('data-workflow-cancel')); assert(!html({role:'ADMIN',order:{...order,status:'PREPARING'}}).includes('data-workflow-cancel'));
});
test('cancel confirmation describes stock/points/no-refund before exposing confirm button', () => {
  assert(!html({role:'ADMIN'}).includes('data-confirm-paid-cancel'));
  const value=html({role:'ADMIN',phase:'confirm'}); for(const text of ['hoàn tồn','thu hồi điểm','không đồng nghĩa hoàn tiền','Payment','Giữ đơn'])assert(value.includes(text));
  assert(value.includes('data-confirm-paid-cancel')); assert(value.includes('<legend>')); assert(!html({role:'STAFF',phase:'confirm'}).includes('data-confirm-paid-cancel'));
});
test('pending disables all mutation buttons and shows processing; no optimistic success', () => {
  const value=html({role:'ADMIN',phase:'pending'}); assert(value.includes('aria-busy="true"')); assert(value.includes('Đang xử lý thao tác')); assert.equal((value.match(/disabled/g)??[]).length,2); assert(!value.includes('data-confirm-paid-cancel')); assert(!value.includes('data-workflow-original-retry'));
});
test('409 conflict and known committed GET failure allow only read recovery', () => {
  for(const phase of ['conflict','confirmed','unresolved']) {const value=html({phase,message:'Đọc lại trạng thái'}); assert(value.includes('role="alert"')); assert(value.includes('data-workflow-reload')); assert(!value.includes('data-workflow-original-retry')); assert(value.includes('disabled'));}
});
test('uncertain unchanged command offers explicit original retry; revised current state never permits it', () => {
  assert(canRetryOriginal(command,order)); assert(!canRetryOriginal(command,{...order,version:4})); assert(!canRetryOriginal(command,{...order,status:'PREPARING'})); assert(!canRetryOriginal(command,{...order,id:randomUUID()}));
  assert(html({phase:'retry',message:'Chưa xác nhận'}).includes('data-workflow-original-retry'));
});
test('transition sends only original version+target to approved namespace, once, no automatic GET', async () => {
  useAuthStore.getState().signIn(session()); const calls=[]; globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json({...order,status:'PREPARING'});};
  await sendWorkflow(command); assert.equal(calls.length,1); assert(calls[0].url.endsWith(`/operator/orders/${id}/transitions`)); assert.deepEqual(JSON.parse(calls[0].init.body),{expectedVersion:3,targetStatus:'PREPARING'});
  assert.equal(calls[0].init.method,'POST'); assert.equal(calls[0].init.cache,'no-store'); assert.equal(calls[0].init.credentials,'omit'); assert(!Object.hasOwn(calls[0].init.headers,'Idempotency-Key'));
});
test('paid-cancel body has only version and uses distinct ADMIN endpoint', async () => {
  useAuthStore.getState().signIn(session('ADMIN')); globalThis.fetch=async(url,init)=>{assert(url.endsWith(`/admin/orders/${id}/paid-cancel`));assert.deepEqual(JSON.parse(init.body),{expectedVersion:3});return Response.json({...order,status:'CANCELLED',earnedPoints:0});}; await sendWorkflow({...command,targetStatus:'CANCELLED'});
});
test('409/400/503 never auto resubmit or change original expectedVersion', async () => {
  for(const [status,code]of [[409,'CONCURRENT_UPDATE'],[409,'INVALID_ORDER_STATE'],[400,'VALIDATION_ERROR'],[503,'SERVICE_UNAVAILABLE']]) {
    useAuthStore.getState().signIn(session());let count=0;globalThis.fetch=async(_url,init)=>{count++;assert.equal(JSON.parse(init.body).expectedVersion,3);return Response.json({error:{code,message:'private SQL'}},{status});};
    await assert.rejects(sendWorkflow(command),{code});assert.equal(count,1);
  }
});
test('401 clears current session,403 reports forbidden; invalid ID/version do not fetch', async () => {
  for(const [status,code]of [[401,'UNAUTHORIZED'],[403,'FORBIDDEN']]) {useAuthStore.getState().signIn(session());globalThis.fetch=async()=>new Response('',{status});await assert.rejects(sendWorkflow(command),{code});assert.equal(!!useAuthStore.getState().accessToken,status!==401);}
  globalThis.fetch=async()=>assert.fail('invalid command must not fetch');await assert.rejects(sendWorkflow({...command,id:'invalid'}),{code:'VALIDATION_ERROR'});await assert.rejects(sendWorkflow({...command,expectedVersion:-1}),{code:'VALIDATION_ERROR'});
});
test('logout/account switch discard late mutation response and old401 cannot clear a new session', async () => {
  for(const status of [200,401]) {useAuthStore.getState().signIn(session());let finish;globalThis.fetch=async()=>new Promise(r=>{finish=r;});const send=sendWorkflow(command);
    useAuthStore.getState().clear();useAuthStore.getState().signIn(session('ADMIN',randomUUID()));finish(status===200?Response.json({...order,status:'PREPARING'}):new Response('',{status}));
    await assert.rejects(send,{code:'UNAUTHORIZED'});assert.equal(useAuthStore.getState().user.role,'ADMIN');}
});
test('late JSON and malformed/wrong-order response cannot become authoritative', async () => {
  useAuthStore.getState().signIn(session());let finish;globalThis.fetch=async()=>({ok:true,status:200,json:()=>new Promise(r=>{finish=r;})});const send=sendWorkflow(command);await new Promise(r=>setImmediate(r));
  useAuthStore.getState().signIn(session('ADMIN',randomUUID()));finish({...order,status:'PREPARING'});await assert.rejects(send,{code:'UNAUTHORIZED'});
  for(const value of [{...order,id:randomUUID(),status:'PREPARING'},{...order,status:'PAID'},{}]) {globalThis.fetch=async()=>Response.json(value);await assert.rejects(sendWorkflow(command),{code:'UNAVAILABLE'});}
});
test('expired session sends no mutation; transport errors remain uncertain', async () => {
  useAuthStore.getState().signIn(session());useAuthStore.setState({expiresAt:Date.now()-1});globalThis.fetch=async()=>assert.fail('expired');await assert.rejects(sendWorkflow(command),{code:'UNAUTHORIZED'});
  useAuthStore.getState().signIn(session());globalThis.fetch=async()=>{throw new Error('network');};await assert.rejects(sendWorkflow(command),{code:'UNAVAILABLE'});
});
