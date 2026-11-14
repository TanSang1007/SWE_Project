import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,file)=>module._compile(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},fileName:file}).outputText,file);
require.extensions['.css']=()=>{};
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {normalizeQuantity,quantityDifference,ingredientRequest,loadIngredientSections,getIngredientSummary,saveIngredientCommand,readIngredientCommand,clearIngredientCommand,inventoryCategory,listedIngredientSummary}=require('../src/lib/api/ingredients.ts');
const {IngredientTable,IngredientSummaryCards}=require('../src/components/ingredient-inventory.tsx');
const {NewIngredientForm,CountForm,ReceiptForm,ReviewCount}=require('../src/components/ingredient-forms.tsx');
const {useAuthStore}=require('../src/lib/auth-store.ts');
const originalFetch=globalThis.fetch,originalStorage=globalThis.sessionStorage;
process.env.NEXT_PUBLIC_API_BASE_URL='http://127.0.0.1:3001';
const actor={id:randomUUID(),email:'fixture@example.invalid'},id=randomUUID(),now='2026-10-29T10:00:00.000Z';
const item={id,name:'Sữa tươi',unit:'L',quantity:'15.500',lowStockThreshold:'2.000',version:1,status:'IN_STOCK',createdBy:actor,updatedBy:actor,createdAt:now,updatedAt:now};
function login(role='ADMIN',owner=actor.id){useAuthStore.getState().signIn({accessToken:'fixture-token-'+owner,tokenType:'Bearer',expiresIn:3600,user:{id:owner,email:actor.email,role,loyaltyPoints:0}});}
const html=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
afterEach(()=>{useAuthStore.getState().clear();globalThis.fetch=originalFetch;globalThis.sessionStorage=originalStorage;});
test('quantities accept Vietnamese decimal comma and preserve exact3 digits',()=>{assert.equal(normalizeQuantity('15,5','L'),'15.500');assert.equal(normalizeQuantity('0.001','KG'),'0.001');assert.equal(normalizeQuantity('200','PIECE'),'200.000');assert.equal(quantityDifference('8.250','10.000'),'-1.750');assert.equal(quantityDifference('0.300','0.100'),'0.200');});
test('negative/exponential/excess-precision/overflow/empty/partial values and fractional pieces fail',()=>{for(const v of ['-1','1e3','0.0001','1000000000','','1.','Infinity'])assert.equal(normalizeQuantity(v,'L'),null);assert.equal(normalizeQuantity('1.5','PIECE'),null);assert.equal(normalizeQuantity('0','L',true),null);assert.equal(normalizeQuantity('0','L'),'0.000');});
test('inventory shows real units, warnings, actor and no misleading total across units',()=>{const markup=html(IngredientTable,{items:[item,{...item,id:randomUUID(),name:'Đường',quantity:'1.500',unit:'KG',status:'LOW_STOCK'},{...item,id:randomUUID(),name:'Ly',quantity:'0.000',unit:'PIECE',status:'OUT_OF_STOCK'}]});for(const value of ['Sữa tươi','lít','kg','cái','Sắp hết','Hết hàng','Người cập nhật',actor.email])assert(markup.includes(value));});
test('ingredient/receipt forms explain zero opening and separate draft from confirmation',()=>{assert(html(NewIngredientForm,{busy:false,submit:()=>{}}).includes('Tồn ban đầu là 0'));const markup=html(ReceiptForm,{items:[item],busy:false,submit:()=>{}});assert(markup.includes('Tạo phiếu chưa cộng tồn'));assert(markup.includes('Số lượng thực nhận'));});
test('Staff count form has actual/note workflow and no official stock or approval control',()=>{const markup=html(CountForm,{items:[item],busy:false,submit:()=>{},recount:null,cancel:()=>{}});assert(markup.includes('Gửi Admin phê duyệt'));assert(markup.includes('Tồn chính thức chỉ thay đổi'));assert(!markup.includes('Xác nhận nhập hàng'));assert(!markup.includes('Phê duyệt kiểm kê'));});
test('stale approval form blocks approval and offers explicit reason/recount',()=>{const doc={id:randomUUID(),version:0,lines:[{stale:true}]};const markup=html(ReviewCount,{doc,busy:false,submit:()=>{}});assert(markup.includes('không thể ghi đè'));assert(markup.includes('Yêu cầu kiểm kê lại'));assert(markup.includes('Từ chối'));assert.match(markup,/disabled=""[^>]*>Phê duyệt kiểm kê/);});
test('guest/customer request denied before network',async()=>{let calls=0;globalThis.fetch=async(url)=>{if(String(url).includes('ingredient-inventory'))calls++;return Response.json({items:[]});};await assert.rejects(()=>ingredientRequest('ingredients'),{code:'UNAUTHORIZED'});login('CUSTOMER');await assert.rejects(()=>ingredientRequest('ingredients'),{code:'FORBIDDEN'});assert.equal(calls,0);});
test('request uses current JWT/no-store and exact payload/key',async()=>{login();let captured;globalThis.fetch=async(url,init)=>{captured={url,init};return Response.json({id});};const body={name:'Sữa',unit:'L',lowStockThreshold:'2.000'},key=randomUUID();await ingredientRequest('ingredients',body,key);assert.equal(captured.init.cache,'no-store');assert.equal(captured.init.headers['Idempotency-Key'],key);assert.equal(captured.init.headers.Authorization,'Bearer fixture-token-'+actor.id);assert.deepEqual(JSON.parse(captured.init.body),body);});
test('backend stale conflict retains explicit code and unknown network result is not success',async()=>{login();globalThis.fetch=async()=>Response.json({error:{code:'INVENTORY_CHANGED'}},{status:409});await assert.rejects(()=>ingredientRequest('counts/'+randomUUID()+'/review',{action:'APPROVE'}),{code:'INVENTORY_CHANGED'});globalThis.fetch=async()=>{throw Error('network');};await assert.rejects(()=>ingredientRequest('receipts',{lines:[]}),{code:'UNAVAILABLE'});});
test('session change while response is in flight cannot present previous actor success',async()=>{login();globalThis.fetch=async()=>{login('STAFF',randomUUID());return Response.json({id});};await assert.rejects(()=>ingredientRequest('ingredients'),{code:'UNAUTHORIZED'});});
test('recovery command survives same owner but is discarded across owner/role boundaries',()=>{const store=new Map();globalThis.sessionStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};const c={userId:actor.id,role:'ADMIN',path:'receipts',key:randomUUID(),body:{lines:[{ingredientId:id,quantity:'2.000'}]}};assert(saveIngredientCommand(c));assert.deepEqual(readIngredientCommand(actor.id,'ADMIN'),c);assert.equal(readIngredientCommand(actor.id,'STAFF'),null);saveIngredientCommand(c);assert.equal(readIngredientCommand(randomUUID(),'ADMIN'),null);saveIngredientCommand(c);clearIngredientCommand();assert.equal(readIngredientCommand(actor.id,'ADMIN'),null);});
test('Staff recovery cannot replay an injected Admin mutation',()=>{const c={userId:actor.id,role:'STAFF',path:'receipts',key:randomUUID(),body:{}};let stored=JSON.stringify(c);globalThis.sessionStorage={getItem:()=>stored,removeItem:()=>{stored=null;}};assert.equal(readIngredientCommand(actor.id,'STAFF'),null);});
test('empty real inventory still loads independently when movement history returns503',async()=>{login();const seen=[];globalThis.fetch=async(url)=>{const p=new URL(url).pathname;if(p.endsWith('/movements'))return Response.json({error:{code:'SERVICE_UNAVAILABLE'}},{status:503});if(p.endsWith('/summary'))return Response.json({totalIngredients:0,inStock:0,lowStock:0,outOfStock:0,pendingCounts:0});return Response.json({items:[],nextCursor:null});};const r=await loadIngredientSections(true,undefined,{ingredients:v=>seen.push(v.items),summary:v=>seen.push(v.totalIngredients)});assert.equal(r.ingredients.status,'fulfilled');assert.equal(r.summary.status,'fulfilled');assert.equal(r.movements.status,'rejected');assert.deepEqual(seen,[[],0]);});
test('Staff loads stock/counts/summary without requesting Admin-only endpoints',async()=>{login('STAFF');const paths=[];globalThis.fetch=async(url)=>{const p=new URL(url).pathname;paths.push(p);return Response.json(p.endsWith('/summary')?{totalIngredients:0,inStock:0,lowStock:0,outOfStock:0,pendingCounts:0}:{items:[],nextCursor:null});};await loadIngredientSections(false);assert.equal(paths.length,3);assert(!paths.some(p=>/movements|receipts/.test(p)));});
test('summary cards include total and pending counts supplied by server',()=>{const markup=html(IngredientSummaryCards,{admin:true,summary:{totalIngredients:60,inStock:50,lowStock:8,outOfStock:2,pendingCounts:55}});for(const s of ['Tổng mặt hàng','Phiếu chờ duyệt','60','55'])assert(markup.includes(s));});
test('supplies use pieces; materials offer liters/kg/eggs with fixed warnings',()=>{const supplies=html(NewIngredientForm,{category:'supplies',busy:false,submit:()=>{}}),materials=html(NewIngredientForm,{category:'materials',busy:false,submit:()=>{}});assert(supplies.includes('Thêm vật dụng'));assert(supplies.includes('dưới 10 cái'));assert(supplies.includes('value="PIECE"'));assert(!supplies.includes('value="L"'));for(const unit of ['L','KG','EGG'])assert(materials.includes(`value="${unit}"`));assert(materials.includes('quả'));for(const unit of ['PIECE','ML','G'])assert(!materials.includes(`value="${unit}"`));assert(!materials.includes('inputMode="decimal"'));assert(materials.includes('dưới 10 kg'));});
test('eggs remain in materials and only whole egg quantities are accepted',()=>{assert.equal(inventoryCategory('EGG'),'materials');assert.equal(normalizeQuantity('12','EGG'),'12.000');assert.equal(normalizeQuantity('1,5','EGG'),null);const markup=html(IngredientTable,{category:'materials',items:[{...item,name:'Trứng',unit:'EGG',quantity:'9.000',lowStockThreshold:'10.000',status:'LOW_STOCK'}]});assert(markup.includes('Trứng'));assert(markup.includes('9 quả'));assert(markup.includes('Sắp hết'));});
test('unit grouping and low-stock links open correct receiving category',()=>{assert.equal(inventoryCategory('PIECE'),'supplies');for(const unit of ['L','KG','ML','G'])assert.equal(inventoryCategory(unit),'materials');const markup=html(IngredientTable,{category:'supplies',receivingLinks:true,items:[{...item,unit:'PIECE',quantity:'9.000',lowStockThreshold:'10.000',status:'LOW_STOCK'}]});assert(markup.includes('Tồn kho vật dụng'));assert(markup.includes('/admin/receipts?category=supplies'));assert(markup.includes('Cảnh báo khi dưới'));});
test('malformed summary is an explicit error rather than fabricated zero statistics',async()=>{login();globalThis.fetch=async()=>Response.json({totalIngredients:10,inStock:0,lowStock:0,outOfStock:0,pendingCounts:0});await assert.rejects(()=>getIngredientSummary(),{code:'UNAVAILABLE'});});

test('server catalog controls stock and receipt options without special cases for item names',()=>{
  const hidden={...item,id:randomUUID(),name:'Mặt hàng bất kỳ đã bỏ',isListed:false};
  const active={...item,isListed:true,displayName:'Tên hiển thị mới'};
  for(const component of [IngredientTable,ReceiptForm]){
    const markup=html(component,{items:[hidden,active],busy:false,submit:()=>{}});
    assert(!markup.includes(hidden.name));assert(markup.includes(active.displayName));
  }
  const markup=html(ReceiptForm,{items:[hidden,active],busy:false,submit:()=>{}});
  assert(markup.includes(`value="${active.id}" selected=""`));
  const empty=html(ReceiptForm,{items:[hidden],busy:false,submit:()=>{}});
  assert(empty.includes('<fieldset disabled=""'));assert(!empty.includes('<option'));
  assert(html(ReceiptForm,{items:[{...hidden,isListed:true}],busy:false,submit:()=>{}}).includes(hidden.name));
});

test('visible stock totals follow catalog while pending counts remain supplied by server',()=>{
  const items=[{...item,isListed:true},{...item,id:randomUUID(),isListed:false,status:'OUT_OF_STOCK'},
    {...item,id:randomUUID(),isListed:true,status:'LOW_STOCK'}];
  const summary={totalIngredients:3,inStock:1,lowStock:1,outOfStock:1,pendingCounts:80};
  assert.deepEqual(listedIngredientSummary(items,summary),{totalIngredients:2,inStock:1,lowStock:1,outOfStock:0,pendingCounts:80});
  assert.equal(items.length,3);assert.equal(summary.totalIngredients,3);
});

test('new counts omit delisted items while historical recount still includes its original rows',()=>{
  const hidden={...item,isListed:false,name:'Hàng ngừng nhập'},props={items:[hidden],busy:false,submit:()=>{},cancel:()=>{}};
  assert(!html(CountForm,{...props,recount:null}).includes(hidden.name));
  assert(html(CountForm,{...props,recount:{id:randomUUID(),reviewNote:'Đếm lại',lines:[{ingredient:{id:hidden.id}}]}}).includes(hidden.name));
});
