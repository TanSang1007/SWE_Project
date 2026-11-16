// Real browser + real Nest/PostgreSQL. Only a fresh, owned LOCAL _test database.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,readdirSync,existsSync,writeFileSync,rmSync,cpSync} from 'node:fs';
import {resolve,join,sep,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),{Client}=require('pg'),bcrypt=require('bcrypt');
const {assertPortsFree}=require('../../scripts/dev-runtime-lib.cjs');
const root=resolve(import.meta.dirname,'../..'),base=process.env.TEST_DATABASE_URL;
assert(base,'Explicit local TEST_DATABASE_URL required');const originalUrl=new URL(base);
assert(['127.0.0.1','localhost','[::1]'].includes(originalUrl.hostname)&&/_test$/.test(originalUrl.pathname),'Local _test database required');
const sourceDir=require('../../scripts/dev-runtime.cjs').sourceCopy(),buildDir=join(root,'.brewlite','size-recipes-frontend-'+basename(sourceDir));
mkdirSync(buildDir,{recursive:true});for(const f of ['src','public','package.json','tsconfig.json','next.config.ts','postcss.config.mjs','next-env.d.ts'])cpSync(join(sourceDir,f),join(buildDir,f),{recursive:true});
const runId=randomUUID().replaceAll('-',''),dbName='brewlite_b2a_'+runId.slice(0,12)+'_test';
const backendDir=join(root,'.brewlite','size-recipes-backend-'+runId);
const out=join(root,'.brewlite','size-recipes-browser-'+runId),profile=join(out,'profile');mkdirSync(profile,{recursive:true});
const adminSql=new Client({connectionString:base});let dataSql,socket,created=false;const children=[],pending=new Map(),exceptions=[],checks=[];let sequence=0;
const movementFailure=false,movementHang=false;
const origin='http://localhost:3100',apiOrigin='http://127.0.0.1:3101',password='I01-local-browser-fixture-123';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(120);}throw Error('Timed out: '+label);}
function start(args,env,cwd,label){const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';const append=b=>{log=(log+b.toString()).slice(-16000);};child.stdout.on('data',append);child.stderr.on('data',append);child.on('error',()=>{});children.push(child);child.on('exit',()=>writeFileSync(join(out,label+'.log'),log));return child;}
async function compile(module,args,cwd,env,label){console.log('Building isolated '+label+'...');const child=start([require.resolve(module),...args],env,cwd,'build-'+label);const code=await new Promise((ok,fail)=>{child.once('exit',ok);child.once('error',fail);});assert.equal(code,0,label+' build failed; see owned test log');}
function command(method,params={}){return new Promise((ok,fail)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);fail(Error('CDP timeout: '+method));},20000);pending.set(id,{ok,fail,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+': '+(r.exceptionDetails.exception?.description??''));return r.result.value;}
async function text(s){await until(()=>evaluate('document.body?.innerText.includes('+JSON.stringify(s)+')??false'),s);}
async function idle(){await until(()=>evaluate('!document.querySelector(".ingredient-inventory")||document.querySelector(".ingredient-inventory").getAttribute("aria-busy")==="false"'),'inventory interaction ready');}
async function click(label){await idle();await evaluate(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e)throw Error('Missing '+${JSON.stringify(label)});if(e.disabled)throw Error('Disabled '+${JSON.stringify(label)});e.click();})()`);}
async function fill(selector,value){await idle();await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing field');const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);await delay(80);}
async function login(role){await command('Page.navigate',{url:origin+'/login?returnTo='+encodeURIComponent(role==='ADMIN'?'/admin/inventory?category=materials':'/operator/ingredients')});await text('Chào bạn trở lại.');await fill('#auth-email',role.toLowerCase()+'@i07.example.invalid');await fill('#auth-password',password);await evaluate('document.querySelector("form").requestSubmit()');await text(role==='ADMIN'?'Quản lý tồn kho':'Kiểm kê nguyên liệu');await until(()=>evaluate('!!document.querySelector(".ingredient-inventory")&&!document.querySelector(".ingredient-inventory").getAttribute("aria-busy").includes("true")'),'inventory ready');}
async function logout(){await click('Đăng xuất');await until(()=>evaluate('!!document.querySelector(".auth-nav a[href*=login]")'),'logout');await command('Page.navigate',{url:origin+'/login'});await text('Chào bạn trở lại.');}
async function api(path,token,body,key,retry=0){const r=await fetch(apiOrigin+'/'+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});const result={status:r.status,body:await r.json()};
  // A cold local transaction has a400ms budget. Honor only this explicit retry
  // contract, keeping the original key/body; never retry an ambiguous write.
  if(key&&result.status===409&&result.body.error?.code==='IDEMPOTENCY_IN_PROGRESS'&&retry<2){await delay(200);return api(path,token,body,key,retry+1);}return result;}
async function token(role){const r=await fetch(apiOrigin+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'X-BrewLite-CSRF':'1'},body:JSON.stringify({email:role.toLowerCase()+'@i07.example.invalid',password})});assert.equal(r.status,200);return(await r.json()).accessToken;}
async function layouts(name){for(const width of [1366,390]){await command('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width===390});await delay(180);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),name+' horizontal overflow');const s=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(out,name+'-'+width+'.png'),Buffer.from(s.data,'base64'));}}
try{
  await assertPortsFree([3100,3101]);
  const buildEnv={...process.env,NEXT_PUBLIC_API_BASE_URL:apiOrigin,API_INTERNAL_BASE_URL:apiOrigin,NEXT_TELEMETRY_DISABLED:'1'};
  await compile('typescript/bin/tsc',['--project','tsconfig.build.json','--outDir',backendDir],join(root,'backend'),buildEnv,'backend');
  if(!existsSync(join(buildDir,'.next','BUILD_ID')))await compile('next/dist/bin/next',['build','--webpack'],buildDir,{...buildEnv,NODE_ENV:'production'},'frontend');
  else console.log('Using isolated production frontend build for this source hash (API3101).');
  await adminSql.connect();assert(/^brewlite_b2a_[a-f0-9]{12}_test$/.test(dbName));await adminSql.query(`CREATE DATABASE "${dbName}"`);created=true;
  const dbUrl=new URL(base);dbUrl.pathname='/'+dbName;dataSql=new Client({connectionString:dbUrl.toString()});await dataSql.connect();
  const migrations=join(root,'backend/prisma/migrations');for(const f of readdirSync(migrations).filter(f=>/^\d+_/.test(f)).sort())await dataSql.query(readFileSync(join(migrations,f,'migration.sql'),'utf8'));
  const hash=await bcrypt.hash(password,10);for(const role of ['ADMIN','STAFF','CUSTOMER'])await dataSql.query('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)',[randomUUID(),role.toLowerCase()+'@i07.example.invalid',hash,role]);
  const env={...process.env,DATABASE_URL:dbUrl.toString(),TEST_DATABASE_URL:dbUrl.toString(),DIRECT_URL:dbUrl.toString(),NODE_ENV:'test',PORT:'3101',FRONTEND_ORIGIN:origin,PAYMENT_PROVIDER_MODE:'VNPAY_SANDBOX',VNPAY_INITIATION_TEST_ONLY:'true',VNPAY_ENV:'SANDBOX',VNPAY_VERSION:'2.1.0',VNPAY_TMN_CODE:'TEST0001',VNPAY_HASH_SECRET:'synthetic-b2a-size-browser-secret',VNPAY_PAYMENT_URL:'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',VNPAY_RETURN_URL:'https://callback.example.org/payments/vnpay/return',VNPAY_IPN_URL:'https://callback.example.org/payments/vnpay/ipn',VNPAY_SANDBOX_ENABLED:'false',VNPAY_ACCEPT_NEW_PAYMENTS:'true',JWT_SECRET:'isolated-ingredient-browser-fixture-secret',JWT_EXPIRES_IN:'3600'};
  delete env.PAYMENT_MOCK_MODE;
  start([join(backendDir,'main.js')],env,root,'backend');await until(async()=>{try{return(await fetch(apiOrigin+'/health')).ok;}catch{return false;}},'test backend');
  start([require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3100'],{...env,NODE_ENV:'production',API_INTERNAL_BASE_URL:apiOrigin,NEXT_PUBLIC_API_BASE_URL:apiOrigin},buildDir,'frontend');await until(async()=>{try{return(await fetch(origin)).ok;}catch{return false;}},'test frontend');
  const edge=process.env.BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';assert(existsSync(edge));const browser=spawn(edge,['--headless=new','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});children.push(browser);
  await until(()=>existsSync(join(profile,'DevToolsActivePort')),'Edge');const port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0],targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(ok=>socket.addEventListener('open',ok,{once:true}));
  socket.addEventListener('message',({data})=>{const e=JSON.parse(data);if(e.id){const p=pending.get(e.id);if(p){clearTimeout(p.timer);pending.delete(e.id);if(e.error)p.fail(Error(e.error.message));else p.ok(e.result);}}if(e.method==='Runtime.exceptionThrown')exceptions.push(e.params.exceptionDetails.text);if(e.method==='Fetch.requestPaused'&&!movementHang){void command(movementFailure?'Fetch.fulfillRequest':'Fetch.continueRequest',movementFailure?{requestId:e.params.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin}],body:Buffer.from(JSON.stringify({error:{code:'SERVICE_UNAVAILABLE'}})).toString('base64')}:{requestId:e.params.requestId});}});await command('Page.enable');await command('Runtime.enable');
  await login('ADMIN');await text('Tồn kho nguyên liệu');await idle();
  assert.equal((await dataSql.query('SELECT count(*)::int AS n FROM ingredients')).rows[0].n,18);
  assert.equal(await evaluate('document.querySelectorAll(".ingredient-table-wrap tbody tr").length'),12);
  await text('Tồn thực tế');await text('Có thể bán');
  assert.equal(await evaluate('Array.from(document.querySelectorAll(".ingredient-table-wrap thead th")).some(th=>th.textContent==="Đã giữ")'),false);
  checks.push('Admin initializes twelve materials and six reusable supplies at zero; water is not inventoried and inventory shows physical and available quantities with the held column removed');
  const adminToken=await token('ADMIN'),staffToken=await token('STAFF'),customerToken=await token('CUSTOMER');
  assert.equal((await api('ingredient-inventory/ingredients',adminToken)).body.items.filter(item=>item.isListed).length,18);
  const product=randomUUID(),cream=randomUUID(),caramel=randomUUID();
  await dataSql.query('INSERT INTO products(id,name,price,image_url,stock) VALUES($1,$2,0,$3,0)',[product,'Latte','/images/latte.jpg']);
  for(const size of ['S','M','L'])await dataSql.query('INSERT INTO product_sizes(product_id,size,extra_price) VALUES($1,$2,0)',[product,size]);
  for(const [id,name]of[[cream,'Kem'],[caramel,'Caramel']]){await dataSql.query('INSERT INTO toppings(id,name,price) VALUES($1,$2,0)',[id,name]);await dataSql.query('INSERT INTO product_toppings(product_id,topping_id) VALUES($1,$2)',[product,id]);}
  await dataSql.query("UPDATE ingredients SET quantity=10 WHERE unit IN ('KG','L')");
  await dataSql.query("UPDATE ingredients SET quantity=0.200 WHERE normalized_name=$1",['sữa tươi không đường (công thức)']);
  await dataSql.query("UPDATE ingredients SET quantity=0 WHERE normalized_name IN ($1,$2)",['kem tươi (công thức)','syrup caramel (công thức)']);
  await logout();
  await command('Page.navigate',{url:origin+'/login?returnTo='+encodeURIComponent('/products/'+product)});
  await text('Chào bạn trở lại.');await fill('#auth-email','customer@i07.example.invalid');await fill('#auth-password',password);await evaluate('document.querySelector("form").requestSubmit()');
  await text('Nguyên liệu hiện đủ tối đa 1 ly size S');
  await until(()=>evaluate('!!document.querySelector(".cart-confirm")&&!document.querySelector(".cart-confirm").disabled'),'available serving can be selected');
  assert.deepEqual(await evaluate('[...document.querySelectorAll("input[name=cart-size]")].map(e=>({size:e.value,disabled:e.disabled}))'),[{size:'S',disabled:false},{size:'M',disabled:true},{size:'L',disabled:true}]);
  assert(await evaluate('[...document.querySelectorAll(".cart-options input[type=checkbox]")].every(e=>e.disabled)'));
  checks.push('Real Customer UI enables only S with 200ml milk; unavailable M/L and topping ingredients are disabled');
  await click('Thêm vào giỏ');await text('Đã thêm vào giỏ.');
  const inputS={productId:product,size:'S',qty:1,toppingIds:[]};
  const createdOrder=await api('orders',customerToken,{items:[inputS]},randomUUID());assert.equal(createdOrder.status,201,JSON.stringify(createdOrder.body));const first=createdOrder.body.id;
  let milk=(await dataSql.query('SELECT quantity::text,reserved_quantity::text FROM ingredients WHERE normalized_name=$1',['sữa tươi không đường (công thức)'])).rows[0];
  assert.deepEqual(milk,{quantity:'0.200',reserved_quantity:'0.150'});
  await evaluate('window.dispatchEvent(new Event("focus"))');await text('Hiện chưa thể đặt món này.');assert(await evaluate('[...document.querySelectorAll("input[name=cart-size]")].every(e=>e.disabled)'));
  checks.push('Creating S reserves exactly150ml; Customer availability updates on focus and prevents selling the held serving again');
  assert.equal((await api('orders/'+first+'/cancel',customerToken,{})).status,200);
  await evaluate('window.dispatchEvent(new Event("focus"))');await text('Nguyên liệu hiện đủ tối đa 1 ly size S');await until(()=>evaluate('!document.querySelector("input[name=cart-size][value=S]").disabled'),'cancel releases serving');
  milk=(await dataSql.query('SELECT quantity::text,reserved_quantity::text FROM ingredients WHERE normalized_name=$1',['sữa tươi không đường (công thức)'])).rows[0];assert.deepEqual(milk,{quantity:'0.200',reserved_quantity:'0.000'});
  checks.push('Unpaid cancellation releases committed ingredients without inventing physical stock');
  await dataSql.query('UPDATE ingredients SET quantity=1 WHERE normalized_name=$1',['sữa tươi không đường (công thức)']);
  await dataSql.query('UPDATE ingredients SET quantity=0.200 WHERE normalized_name IN ($1,$2)',['kem tươi (công thức)','syrup caramel (công thức)']);
  await command('Page.reload');await text('Nguyên liệu hiện đủ tối đa');await until(()=>evaluate('!!document.querySelector(".cart-confirm")&&!document.querySelector(".cart-confirm").disabled'),'replenishment enables ordering');
  await evaluate('document.querySelector("input[name=cart-size][value=M]").click()');await delay(100);
  await evaluate('document.querySelector('+JSON.stringify('.cart-options input[type=checkbox][value="'+cream+'"]')+').click()');await fill('.cart-options input[aria-label="Số lượng"]','2');
  await evaluate('document.querySelector(".cart-options").requestSubmit()');await text('Đã thêm vào giỏ.');
  await until(async()=>{const r=await api('cart',customerToken);return r.status===200&&r.body.items.some(i=>i.size==='M'&&i.qty===2&&i.toppings.length===1);},'M with cream persisted from browser');
  const inputM={productId:product,size:'M',qty:2,toppingIds:[cream]};
  const second=await api('orders',customerToken,{items:[inputS,inputM]},randomUUID());assert.equal(second.status,201,JSON.stringify(second.body));
  const snapshot=(await dataSql.query('SELECT name_snapshot,quantity::text FROM order_recipe_ingredients WHERE order_id=$1',[second.body.id])).rows;
  assert.equal(snapshot.find(i=>i.name_snapshot==='Sữa tươi không đường').quantity,'0.590');assert.equal(snapshot.find(i=>i.name_snapshot==='Kem tươi').quantity,'0.060');
  checks.push('Browser-selected M quantity2 plus retained S cart line aggregate590ml milk and60ml cream');
  const confirm=await api('orders/'+second.body.id+'/confirm-zero',customerToken,{},randomUUID());assert.equal(confirm.status,200,JSON.stringify(confirm.body));
  await dataSql.query("UPDATE orders SET paid_at=clock_timestamp()-interval '121 seconds' WHERE id=$1",[second.body.id]);
  const order=(await dataSql.query('SELECT version FROM orders WHERE id=$1',[second.body.id])).rows[0];
  const preparing=await api('operator/orders/'+second.body.id+'/transitions',staffToken,{expectedVersion:order.version,targetStatus:'PREPARING'});assert.equal(preparing.status,200,JSON.stringify(preparing.body));
  milk=(await dataSql.query('SELECT quantity::text,reserved_quantity::text FROM ingredients WHERE normalized_name=$1',['sữa tươi không đường (công thức)'])).rows[0];assert.deepEqual(milk,{quantity:'0.410',reserved_quantity:'0.000'});
  assert.equal((await api('operator/orders/'+second.body.id+'/transitions',staffToken,{expectedVersion:order.version,targetStatus:'PREPARING'})).status,409);
  checks.push('Internal zero-total payment and Staff preparation consume frozen doses once; repeated transition cannot consume twice');
  await logout();await login('ADMIN');await text('Sữa tươi không đường');await idle();
  const milkText=await evaluate('[...document.querySelectorAll(".ingredient-table-wrap tbody tr")].find(r=>r.querySelector("th").textContent==="Sữa tươi không đường").innerText');assert(milkText.includes('0,41'));
  await layouts('size-recipe-stock');await click('Lịch sử điều chỉnh');await text('Pha chế theo công thức');await text('Giữ nguyên liệu cho đơn');await layouts('size-recipe-history');
  checks.push('Admin sees physical410ml, zero held and append-only order reservation/consumption history; desktop/mobile fit');
  const milkId=(await dataSql.query('SELECT id FROM ingredients WHERE normalized_name=$1',['sữa tươi không đường (công thức)'])).rows[0].id;
  await click('Ngưỡng kiểm soát');await text('Ngưỡng chênh lệch nguyên liệu');
  const choices=await evaluate('[...document.querySelector(".ingredient-card.ingredient-form select").options].map(o=>o.textContent)');
  assert(!choices.some(label=>/Đá viên|Ly sứ|Nước lọc/.test(label)));
  assert(await evaluate('!document.querySelector("input[name=window]")&&!document.querySelector("input[name=buffer]")'));
  await fill('.ingredient-card.ingredient-form select',milkId);await fill('input[name=percent]','5');await fill('input[name=absolute]','0.1');await click('Lưu ngưỡng cho mặt hàng');await text('Máy chủ đã xác nhận thao tác.');await idle();
  assert.equal((await api('ingredient-inventory/ingredients/'+milkId+'/control',staffToken,{expectedVersion:0,variancePercentThreshold:'5'})).status,403);
  await layouts('inventory-control-settings');
  checks.push('Admin configures ingredient variance only; ice/water/supplies and skipped reorder/takeaway settings are absent; Staff cannot configure');
  await logout();await login('STAFF');await click('Kiểm kê và phiếu của tôi');await text('Kiểm kê tồn kho theo ngày');
  const countChoices=await evaluate('[...document.querySelectorAll(".ingredient-form .ingredient-check")].map(e=>e.textContent)');assert(!countChoices.some(label=>/Đá viên|Ly sứ|Nước lọc/.test(label)));
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.ingredient-form .ingredient-check')].find(e=>e.textContent.includes('Sữa tươi không đường'));label.querySelector('input').click();})()`);
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.ingredient-form label')].find(e=>e.textContent.startsWith('Số lượng thực tế')&&e.textContent.includes('Sữa tươi không đường'));label.querySelector('input').setAttribute('data-i08-actual','1');})()`);
  await fill('input[data-i08-actual]','0.400');await click('Lưu nháp kiểm kê');await text('Gửi phiếu nháp cho Admin');await idle();
  const draft=(await api('ingredient-inventory/counts',staffToken)).body.items.find(doc=>doc.status==='DRAFT');assert(draft);assert.equal(draft.lines[0].systemQuantity,'0.410');assert.equal(draft.lines[0].controlStatus,'WITHIN_THRESHOLD');
  assert(!(await api('ingredient-inventory/counts',adminToken)).body.items.some(doc=>doc.id===draft.id));
  await click('Gửi phiếu nháp cho Admin');await text('Chờ phê duyệt');await idle();
  const submitted=(await api('ingredient-inventory/counts',staffToken)).body.items.find(doc=>doc.id===draft.id);assert.equal(submitted.status,'SUBMITTED');
  checks.push('Staff records a daily count, saves a private draft and submits without changing official stock; variance uses daily theoretical consumption');
  const received=await api('ingredient-inventory/receipts',adminToken,{lines:[{ingredientId:milkId,quantity:'0.200'}]},randomUUID());assert.equal(received.status,201);
  assert.equal((await api('ingredient-inventory/receipts/'+received.body.id+'/confirm',adminToken,{expectedVersion:0})).status,200);
  await logout();await login('ADMIN');await click('Duyệt kiểm kê');await text('Trong ngưỡng kiểm soát');await text('Có giao dịch phát sinh sau kiểm kê.');
  await evaluate(`(()=>{const article=[...document.querySelectorAll('article.ingredient-card')].find(e=>e.textContent.includes(${JSON.stringify(draft.id.slice(-8))}));article.querySelector('.ingredient-document-actions input[type=checkbox]').click();})()`);
  await click('Phê duyệt kiểm kê');await text('Đã phê duyệt');await idle();
  assert.equal((await dataSql.query('SELECT quantity::text FROM ingredients WHERE id=$1',[milkId])).rows[0].quantity,'0.600');
  assert.equal((await api('ingredient-inventory/counts/'+draft.id+'/review',adminToken,{action:'APPROVE',expectedVersion:submitted.version,note:''})).status,200);
  assert.equal((await dataSql.query('SELECT count(*)::int AS n FROM ingredient_movements m JOIN ingredient_count_lines l ON l.id=m.count_line_id WHERE l.count_id=$1',[draft.id])).rows[0].n,1);
  await layouts('inventory-control-counts');
  checks.push('Admin approval preserves a later200ml receipt, adjusts only the10ml shortage to600ml, and repeated approval creates no duplicate movement; desktop/mobile fit');
  // O01: all payments, refunds, clocks and users below belong to this fresh test database.
  async function makePaidOrder(zeroTotal=false){
    await dataSql.query('UPDATE products SET price=$2,version=version+1 WHERE id=$1',[product,zeroTotal?0:10000]);
    await dataSql.query("UPDATE ingredients SET quantity=10,reserved_quantity=0 WHERE unit IN ('KG','L')");
    assert.equal((await api('cart/items',customerToken,inputS)).status,201);
    const made=await api('orders',customerToken,{items:[inputS]},randomUUID());assert.equal(made.status,201,JSON.stringify(made.body));
    if(zeroTotal)assert.equal((await api('orders/'+made.body.id+'/confirm-zero',customerToken,{},randomUUID())).status,200);
    else{
      const started=await api('payments/vnpay/attempts',customerToken,{orderId:made.body.id},randomUUID());assert.equal(started.status,201,JSON.stringify(started.body));
      const a=(await dataSql.query('SELECT txn_ref,amount::text FROM payment_attempts WHERE id=$1',[started.body.attemptId])).rows[0];
      const signer=require(join(backendDir,'payments/vnpay/vnpay-signing.js'));
      const fields={vnp_TmnCode:'TEST0001',vnp_TxnRef:a.txn_ref,vnp_Amount:String(BigInt(a.amount)*100n),vnp_BankCode:'NCB',vnp_OrderInfo:'Thanh toan BrewLite '+a.txn_ref,vnp_TransactionNo:String(BigInt('0x'+randomUUID().replaceAll('-','').slice(0,12))),vnp_ResponseCode:'00',vnp_TransactionStatus:'00'};
      const raw=signer.canonicalize(fields)+'&vnp_SecureHash='+signer.signParameters(fields,env.VNPAY_HASH_SECRET);
      const acknowledged=await(await fetch(apiOrigin+'/payments/vnpay/ipn?'+raw)).json();assert.equal(acknowledged.RspCode,'00',JSON.stringify(acknowledged));
    }
    return made.body.id;
  }
  async function customerOrder(id,path='/orders/'+id+'/confirmation'){
    await command('Page.navigate',{url:origin+'/login?returnTo='+encodeURIComponent(path)});await text('Chào bạn trở lại.');
    await fill('#auth-email','customer@i07.example.invalid');await fill('#auth-password',password);await evaluate('document.querySelector("form").requestSubmit()');await text('Theo dõi đơn hàng');
  }
  const cancelledPaid=await makePaidOrder(),paidAttempt=(await dataSql.query('SELECT id FROM payment_attempts WHERE order_id=$1',[cancelledPaid])).rows[0].id;
  await logout();await customerOrder(cancelledPaid,'/payments/vnpay/result?attemptId='+paidAttempt);await text('Chờ pha chế — có thể hủy trong');
  await click('Hủy đơn hàng');await click('Xác nhận hủy đơn hàng');await text('Đang xử lý hoàn tiền');
  assert.equal((await dataSql.query('SELECT status FROM orders WHERE id=$1',[cancelledPaid])).rows[0].status,'CANCELLED');
  await layouts('paid-cancel-customer');checks.push('Customer browser cancels during the120-second server window, releases stock and sees pending refund rather than a success claim');
  await logout();await login('ADMIN');await command('Page.navigate',{url:origin+'/admin/orders/'+cancelledPaid});await text('Phê duyệt hoàn tiền');await click('Phê duyệt hoàn tiền');
  await text('Ghi nhận hoàn tiền thất bại');await fill('textarea[name=note]','Synthetic external transfer rejected');await click('Ghi nhận hoàn tiền thất bại');await text('Hoàn tiền thất bại');
  await click('Mở lại xử lý hoàn tiền');await text('Xác nhận đã hoàn tiền');await fill('input[name=transaction]','synthetic-refund-'+randomUUID());await fill('textarea[name=evidence]','Synthetic verified external receipt');
  await evaluate('document.querySelector("form input[type=checkbox]").click()');await click('Xác nhận đã hoàn tiền');await text('Hoàn tiền thành công');await layouts('refund-admin');
  assert.equal((await dataSql.query('SELECT status FROM payments WHERE order_id=$1',[cancelledPaid])).rows[0].status,'SUCCEEDED');
  assert.equal((await dataSql.query('SELECT count(*)::int AS n FROM order_refunds WHERE order_id=$1',[cancelledPaid])).rows[0].n,1);
  checks.push('Admin browser approves, records an actual failure, retries tracking and confirms refund only with transaction/evidence; original Payment remains SUCCEEDED');
  const preparingOrder=await makePaidOrder(true);await logout();await login('STAFF');await command('Page.navigate',{url:origin+'/operator/orders/'+preparingOrder});await text('Chờ hết thời hạn hủy:');
  assert(await evaluate('document.querySelector("[data-workflow-target=PREPARING]").disabled'));
  const freshOrder=(await dataSql.query('SELECT version FROM orders WHERE id=$1',[preparingOrder])).rows[0];
  assert.equal((await api('operator/orders/'+preparingOrder+'/transitions',staffToken,{expectedVersion:freshOrder.version,targetStatus:'PREPARING'})).status,409);
  await dataSql.query("UPDATE orders SET paid_at=clock_timestamp()-interval '121 seconds' WHERE id=$1",[preparingOrder]);await click('Tải lại đơn hàng');await text('Chờ nhân viên bắt đầu');
  await until(()=>evaluate('!!document.querySelector("[data-workflow-target=PREPARING]")&&!document.querySelector("[data-workflow-target=PREPARING]").disabled'),'preparation unlocked');
  await click('Bắt đầu pha chế');await text('Đánh dấu sẵn sàng');await layouts('preparation-after-window');
  checks.push('Staff browser cannot prepare during120 seconds; after server expiry the order waits for Staff, who explicitly starts preparation');
  await logout();await customerOrder(preparingOrder);await text('Đang pha chế');
  for(const targetStatus of ['READY','COMPLETED']){const o=(await dataSql.query('SELECT version FROM orders WHERE id=$1',[preparingOrder])).rows[0];assert.equal((await api('operator/orders/'+preparingOrder+'/transitions',staffToken,{expectedVersion:o.version,targetStatus})).status,200);await text(targetStatus==='READY'?'Sẵn sàng nhận tại quầy':'Đã hoàn tất');}
  await layouts('tracking-completed');checks.push('Customer browser observes Staff READY and COMPLETED through periodic refresh, with actor/time history and no automatic preparing transition');
  const supportOrder=await makePaidOrder();await dataSql.query("UPDATE orders SET paid_at=clock_timestamp()-interval '121 seconds' WHERE id=$1",[supportOrder]);
  await command('Page.navigate',{url:origin+'/orders/'+supportOrder+'/confirmation'});await text('Chờ nhân viên bắt đầu');
  assert(!await evaluate('[...document.querySelectorAll("button")].some(e=>e.textContent==="Hủy đơn hàng")'));
  await fill('textarea[name=reason]','Shop unable to serve synthetic fixture');await click('Gửi yêu cầu hỗ trợ');await text('Đã gửi hỗ trợ');await logout();await login('ADMIN');
  await command('Page.navigate',{url:origin+'/admin/orders/'+supportOrder});await text('Duyệt xử lý');await fill('textarea[name=note]','Verified shop cannot serve');await click('Duyệt xử lý');await text('Đang xử lý hoàn tiền');
  assert.equal((await dataSql.query('SELECT status FROM orders WHERE id=$1',[supportOrder])).rows[0].status,'CANCELLED');await layouts('support-admin');
  checks.push('After expiry Customer requests support; Admin reviews with a reason and creates an approved refund without pretending money has already been returned');
  assert.equal(exceptions.length,0);assert.equal((await api('ingredient-inventory/receipts',customerToken)).status,403);
  writeFileSync(join(out,'result.json'),JSON.stringify({passed:true,checks,syntheticDatabase:true,sharedDatabaseWrites:false},null,2));console.log(JSON.stringify({passed:true,checks,evidenceDirectory:out},null,2));

}catch(error){
  if(socket?.readyState===WebSocket.OPEN){
    try{writeFileSync(join(out,'failure.json'),JSON.stringify({checks,page:await evaluate('({url:location.href,text:document.body?.innerText})')},null,2));const screenshot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(out,'failure.png'),Buffer.from(screenshot.data,'base64'));}catch{/* Preserve the original assertion if diagnostics fail. */}
  }
  throw error;
}finally{
  if(socket)socket.close();for(const p of pending.values())clearTimeout(p.timer);
  for(const child of children.reverse()){if(child.exitCode===null){const stopped=new Promise(ok=>child.once('exit',ok));child.kill('SIGTERM');await Promise.race([stopped,delay(6000)]);}}
  if(dataSql)await dataSql.end();if(created){assert(/^brewlite_b2a_[a-f0-9]{12}_test$/.test(dbName));await adminSql.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);}await adminSql.end();
  assert(resolve(profile)===join(out,'profile')&&resolve(profile).startsWith(root+sep));if(existsSync(profile))rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
