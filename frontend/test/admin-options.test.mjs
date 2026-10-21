import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);const ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:filename}).outputText,filename);
const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
const {parseTopping,parseToppings,parseSizes,parseAssociations,getSizes,getTopping,getToppings,optionRequest,optionMessage,validOptionMoney}=require('../src/lib/api/admin-options.ts');
const {ToppingForm,SizeForm,Feedback,AdminToppings,AdminProductOptions}=require('../src/components/admin-options.tsx');
const {CartOptions}=require('../src/components/cart-options.tsx');const {useAuthStore}=require('../src/lib/auth-store.ts');
const originalFetch=globalThis.fetch;process.env.NEXT_PUBLIC_API_BASE_URL='http://localhost:3001';
const id=randomUUID();const actor=randomUUID();const stamp='2026-10-13T00:00:00.000Z';
const top={id,name:'Cream',price:'5000',isActive:true,version:7,createdAt:stamp,updatedAt:stamp};
const size={productId:id,size:'M',extraPrice:'7000',isActive:true};
const session=(role='ADMIN',owner=actor)=>useAuthStore.getState().signIn({accessToken:`fixture-${owner}-${role}`,tokenType:'Bearer',expiresIn:3600,user:{id:owner,email:'fixture@example.invalid',role,loyaltyPoints:0}});
const html=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
afterEach(()=>{globalThis.fetch=originalFetch;useAuthStore.getState().clear();});
test('A05 exact AdminTopping/Size/association projections retain current OCC and strip secrets',()=>{
  assert.deepEqual(parseTopping({...top,passwordHash:'discard',stock:7}),top);
  assert.deepEqual(parseToppings({items:[top]}),[top]);assert.deepEqual(parseToppings({items:[]}),[]);
  assert.deepEqual(parseSizes({items:[{...size,version:99}],productVersion:3},id),{items:[size],productVersion:3});
  assert.deepEqual(parseAssociations({items:[top],productVersion:3}),{items:[top],productVersion:3});
});
test('A05 rejects malformed lifecycle/version/money/duplicates/mismatched product',()=>{
  for(const version of [undefined,null,-1,1.5,'7',2147483648])assert.throws(()=>parseTopping({...top,version}));
  for(const isActive of [undefined,null,'true',1])assert.throws(()=>parseTopping({...top,isActive}));
  assert.throws(()=>parseToppings({items:[top,top]}));assert.throws(()=>parseSizes({items:[size,size],productVersion:0},id));
  assert.throws(()=>parseSizes({items:[size],productVersion:0},randomUUID()));assert.throws(()=>parseSizes({items:[{...size,size:'XL'}],productVersion:0},id));
  for(const price of ['-1','1.1','01','1000000000000',5000])assert.throws(()=>parseTopping({...top,price}));
  assert(validOptionMoney('999999999999'));assert(validOptionMoney('0'));
});
test('A05 create/edit forms label price/lifecycle, preserve original revision and pending gates',()=>{
  const create=html(ToppingForm,{busy:false,save:()=>{},cancel:()=>{}});assert(create.includes('topping-name'));assert(create.includes('topping-price'));assert(!create.includes('name="isActive"'));assert(!create.includes('name="version"'));
  const edit=html(ToppingForm,{topping:top,busy:true,save:()=>{},cancel:()=>{}});assert(edit.includes('Phiên bản đã đọc: 7'));assert(edit.includes('name="isActive"'));assert(edit.includes('disabled'));
  const addSize=html(SizeForm,{available:['S','L'],busy:false,save:()=>{},cancel:()=>{}});assert(addSize.includes('<option>S</option>'));assert(!addSize.includes('<option>M</option>'));
  const editSize=html(SizeForm,{size,busy:true,available:[],save:()=>{},cancel:()=>{}});assert(editSize.includes('7000'));assert(editSize.includes('name="isActive"'));assert(editSize.includes('disabled'));
});
test('A05 loading/error/review/confirmed states announce errors and require explicit review',()=>{
  const props={busy:false,error:optionMessage('CONCURRENT_UPDATE'),success:'',review:true,canReview:false,refresh:()=>{},acknowledge:()=>{}};
  const value=html(Feedback,props);assert(value.includes('role="alert"'));assert(value.includes('Dữ liệu đã thay đổi'));assert(value.includes('Không tự gửi lại'));assert(value.includes('data-options-review'));assert(value.includes('disabled'));
  assert(html(Feedback,{...props,busy:true,review:false,error:''}).includes('role="status"'));
});
test('retired selected size/topping remain explicit, not replaced and cannot submit until corrected',()=>{
  const product={id,name:'Drink',price:'50000',available:true,sizes:[{size:'S',extraPrice:'0'}],toppings:[]};
  const value=html(CartOptions,{product,initial:{productId:id,size:'M',toppingIds:[id],qty:1},busy:false,onConfirm:()=>{},label:'Lưu'});
  assert(value.includes('cấu hình cũ vẫn được giữ trong giỏ'));assert(value.includes('Topping đã chọn không còn được cung cấp'));assert(value.includes('disabled'));assert(!value.includes('Giá dự tính mỗi ly:'));
  assert(!/<input[^>]*value="S"[^>]*checked/.test(value));
});
test('valid current option price preview remains exact BigInt VND',()=>{
  const value=html(CartOptions,{product:{id,name:'Drink',price:'50000',available:true,sizes:[{size:'M',extraPrice:'7000'}],toppings:[{id,name:'Cream',price:'10000'}]},initial:{productId:id,size:'M',toppingIds:[id],qty:1},busy:false,onConfirm:()=>{},label:'Thêm'});
  assert(value.includes('67.000'));assert(!value.includes('cấu hình cũ'));
});
test('STAFF/CUSTOMER and guests never render A05 private screens or fetch mutation data',async()=>{
  for(const role of ['STAFF','CUSTOMER']){session(role);assert.equal(html(AdminToppings), '');assert.equal(html(AdminProductOptions,{id}),'');globalThis.fetch=()=>assert.fail('forbidden must not fetch');await assert.rejects(getToppings(),{code:'FORBIDDEN'});}
  useAuthStore.getState().clear();await assert.rejects(getToppings(),{code:'UNAUTHORIZED'});
});
test('A05 GETs are exact namespace/no-store/JWT and preserve strict current revisions',async()=>{
  session();const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('/sizes')?{items:[size],productVersion:4}:top);};
  assert.equal((await getSizes(id)).productVersion,4);assert.deepEqual(await getTopping(id),top);
  for(const {init} of calls){assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');assert.equal(init.body,undefined);}
});
test('409 mutation sends original version once, reports conflict and never retries/overwrites',async()=>{
  session();const calls=[];globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json({error:{code:'CONCURRENT_UPDATE'}},{status:409});};
  await assert.rejects(optionRequest('PATCH','/admin/toppings/'+id,{expectedVersion:7,price:'9000'}),{code:'CONCURRENT_UPDATE'});
  assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].init.body),{expectedVersion:7,price:'9000'});
});
test('logout/account switch discards delayed success/401 and never clears new session',async()=>{
  for(const status of [200,401]){session();let finish;globalThis.fetch=async()=>new Promise(r=>{finish=r;});const read=getToppings();session('ADMIN',randomUUID());finish(status===200?Response.json({items:[top]}):new Response('',{status}));await assert.rejects(read,{code:'UNAUTHORIZED'});assert(useAuthStore.getState().accessToken);}
});
test('expired current session is cleared and invalid paths/mismatched IDs never accepted',async()=>{
  session();useAuthStore.setState({expiresAt:Date.now()-1});globalThis.fetch=()=>assert.fail('expired must not fetch');await assert.rejects(getToppings(),{code:'UNAUTHORIZED'});
  session();await assert.rejects(optionRequest('GET','/admin/toppings?role=ADMIN'),{code:'VALIDATION_ERROR'});
  globalThis.fetch=async()=>Response.json({...top,id:randomUUID()});await assert.rejects(getTopping(id),{code:'UNAVAILABLE'});
});
