import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:filename}).outputText,filename);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {parseTracking,remainingPaidWindow,trackingRequest,getTracking}=require('../src/lib/api/order-tracking.ts');
const {TrackingPhase}=require('../src/components/order-tracking.tsx');
const {WorkflowControls}=require('../src/components/operator-workflow.tsx');
const {useAuthStore}=require('../src/lib/auth-store.ts');
const id=randomUUID(),originalFetch=globalThis.fetch;
const base={orderId:id,status:'PAID',serverNow:'2026-11-15T00:00:30Z',cancelUntil:'2026-11-15T00:02:00Z',canCancelPaid:true,canStartPreparing:false,refund:null,supportRequests:[],events:[]};
const html=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const session=()=>useAuthStore.getState().signIn({accessToken:'synthetic-tracking-token',expiresIn:3600,user:{id:randomUUID(),email:'tracking@example.invalid',role:'CUSTOMER',loyaltyPoints:0}});
afterEach(()=>{globalThis.fetch=originalFetch;useAuthStore.getState().clear();});
test('tracking parser whitelists fields and refuses missing or malformed status, deadline and refund data',()=>{
 assert.deepEqual(parseTracking({...base,secret:'hidden'}),base);
 for(const change of [{status:'UNKNOWN'},{serverNow:'invalid'},{cancelUntil:42},{refund:{}},{canCancelPaid:'true'},{events:null},{supportRequests:[{}]}])assert.throws(()=>parseTracking({...base,...change}));
});
test('unapproved or unprocessed refunds cannot render as successful',()=>{
 const r={id:randomUUID(),status:'SUCCEEDED',amount:'10000',approved:false,version:1,createdAt:base.serverNow,processedAt:base.serverNow,failureReason:null};
 assert.throws(()=>parseTracking({...base,refund:r}));assert.throws(()=>parseTracking({...base,refund:{...r,approved:true,processedAt:null}}));
 assert.equal(parseTracking({...base,refund:{...r,status:'FAILED',approved:true,failureReason:'Rejected transfer'}}).refund.status,'FAILED');
});
test('server time governs the 119/120/121 second boundary regardless of browser wall clock',()=>{
 const paid='2026-11-15T00:00:00Z';
 assert.equal(remainingPaidWindow(paid,'2026-11-15T00:01:59Z'),1);assert.equal(remainingPaidWindow(paid,'2026-11-15T00:02:00Z'),0);
 assert.equal(remainingPaidWindow(paid,'2026-11-15T00:02:01Z'),0);assert.equal(remainingPaidWindow(paid,base.serverNow,90000),0);assert.equal(remainingPaidWindow(null,base.serverNow),null);
});
test('customer can confirm cancellation or confirm no cancellation during the window, then sees waiting Staff rather than preparing',()=>{
 const props={data:base,customer:true,disabled:false,confirm:false,setConfirm:()=>{},cancel:()=>{},confirmNoCancel:()=>{}};
 const active=html(TrackingPhase,props);
 assert(active.includes('Hủy đơn hàng'));assert(active.includes('Xác nhận không hủy đơn'));assert(active.includes('data-confirm-no-cancel'));
 assert(html(TrackingPhase,{...props,confirm:true}).includes('Xác nhận hủy đơn hàng'));
 const noCancel=html(TrackingPhase,{...props,data:{...base,canCancelPaid:false,noCancelConfirmedAt:'2026-11-15T00:00:45Z'}});
 assert(noCancel.includes('Đã xác nhận không hủy'));assert(noCancel.includes('disabled'));assert(!noCancel.includes('data-confirm-no-cancel'));
 const expired=html(TrackingPhase,{...props,data:{...base,serverNow:'2026-11-15T00:02:01Z',canCancelPaid:false,canStartPreparing:true}});
 assert(expired.includes('Chờ nhân viên bắt đầu'));assert(!expired.includes('Đang pha chế'));assert(expired.includes('Hủy đơn hàng'));assert(expired.includes('disabled'));assert(expired.includes('Đã hết thời hạn hủy 120 giây'));
 assert(!html(TrackingPhase,{...props,customer:false}).includes('Hủy đơn hàng'));
});

test('paid cancellation stays visible with an explanation after preparation; cancelled orders cannot cancel again',()=>{
 const props={data:{...base,status:'PREPARING',canCancelPaid:false},customer:true,disabled:false,confirm:false,setConfirm:()=>{},cancel:()=>{}};
 const preparing=html(TrackingPhase,props);
 assert(preparing.includes('Hủy đơn hàng'));assert(preparing.includes('disabled'));assert(preparing.includes('Đơn đã bắt đầu được xử lý'));
 const missingDeadline=html(TrackingPhase,{...props,data:{...base,cancelUntil:null,canCancelPaid:false}});
 assert(missingDeadline.includes('Hủy đơn hàng'));assert(missingDeadline.includes('disabled'));assert(missingDeadline.includes('Chưa xác định được thời hạn hủy từ máy chủ'));
 assert(!html(TrackingPhase,{...props,data:{...props.data,status:'CANCELLED'}}).includes('Hủy đơn hàng'));
});
test('Staff preparation is enabled immediately on PAID orders without waiting 120s',()=>{
 const paidOrder={id,orderCode:'BL-test',status:'PAID',currency:'VND',subtotal:'10000',discountAmount:'0',total:'10000',promotionCode:null,createdAt:'2026-11-15T00:00:00Z',paidAt:'2026-11-15T00:00:00Z',serverNow:'2026-11-15T00:00:10Z',updatedAt:'2026-11-15T00:00:00Z',version:1,earnedPoints:1,paymentStatus:'SUCCEEDED',items:[]};
 const markup=html(WorkflowControls,{order:paidOrder,role:'STAFF',phase:'idle',message:'',act:()=>{},confirm:()=>{},dismiss:()=>{},reload:()=>{},retry:()=>{}});
 assert(markup.includes('data-workflow-target="PREPARING"'));assert(!markup.includes('disabled'));
});
test('tracking transport uses current auth/no-store; a lost response never retries a mutation automatically',async()=>{
 process.env.NEXT_PUBLIC_API_BASE_URL='http://localhost:3001';session();let count=0;
 globalThis.fetch=async(_url,options)=>{count++;assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,'Bearer synthetic-tracking-token');throw Error('lost response');};
 await assert.rejects(trackingRequest('/orders/'+id+'/cancel',{}));assert.equal(count,1);
});
test('late responses cannot cross sessions and another order response cannot masquerade as this order',async()=>{
 session();globalThis.fetch=async()=>Response.json({...base,orderId:randomUUID()});await assert.rejects(getTracking(id));
 globalThis.fetch=async()=>{useAuthStore.getState().clear();return Response.json(base);};await assert.rejects(getTracking(id));
});
