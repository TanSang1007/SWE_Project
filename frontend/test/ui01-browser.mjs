import { keepJournalFixtures } from './journal-browser-cleanup.mjs';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require=createRequire(import.meta.url);
const { provisionOperator }=require('../../backend/scripts/provision-operator.cjs');
const { JwtService }=require('@nestjs/jwt');

export async function verifyUi01Browser({evaluate,command,waitText,navigate,delay,database,root,report,backendUrl,loginPayload,mode,customerEmail,customerPassword,evidencePrefix='UI01'}) {
  const statuses=['PENDING','PAYMENT_FAILED','PAID','PREPARING','READY','COMPLETED','CANCELLED'];
  const orders=new Map(); const operators=[]; const customerIds=[]; let productBefore;
  async function api(method,path,token,body,key) {
    const response=await fetch(backendUrl+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:response.status===204?null:await response.json()};
  }
  async function fill(id,value) { await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`); }
  async function login(actor,expected,path) {
    await navigate('/login'+(path?'?returnTo='+encodeURIComponent(path):'')); await waitText('Chào bạn trở lại');
    await fill('auth-email',actor.email); await fill('auth-password',actor.password); await evaluate("document.querySelector('.auth-submit').click()"); await waitText(expected);
    assert.equal(loginPayload().user.role,actor.role);
    return loginPayload().accessToken;
  }
  async function loaded(selector) { for(let n=0;n<100;n++){if(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`))return;await delay(100);}throw new Error('UI01 browser data timeout: '+selector); }
  async function fingerprint() {
    const tables=(await database.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name")).rows;
    const values={};for(const {table_name:name} of tables) values[name]=(await database.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS h FROM "${name}" t`)).rows[0].h;
    return JSON.stringify(values);
  }
  try {
    for(const role of ['STAFF','ADMIN']) {const email=randomUUID()+'@example.invalid';const password=randomBytes(20).toString('hex');const row=await provisionOperator(database,{email,password,role},{...process.env,NODE_ENV:'development',ALLOW_OPERATOR_PROVISIONING:'true'});operators.push({...row,email,password});}
    const [staff,admin]=operators;
    const adminToken=(await api('POST','/auth/login',null,{email:admin.email,password:admin.password})).body.accessToken;
    const catalog=(await api('GET','/products')).body.items;
    const product=catalog.find(p=>p.available); assert(product,'Real isolated catalog must have available Product');
    assert(/^brewlite_(?:a04|l01)_browser_[a-f0-9]{32}$/.test((await database.query('SELECT current_schema() AS schema')).rows[0].schema));
    productBefore=(await database.query('SELECT id,stock,version,updated_at FROM products WHERE id=$1',[product.id])).rows[0];
    // Trusted test fixture setup only; all Orders/Payments/statuses below use real business APIs.
    await database.query('UPDATE products SET stock=stock+20,version=version+1 WHERE id=$1',[product.id]);
    const productDetail=(await api('GET','/products/'+product.id)).body;
    for(const status of statuses) {
      const email=randomUUID()+'@example.invalid';const password=randomBytes(20).toString('hex');
      const registration=await api('POST','/auth/register',null,{email,password});assert.equal(registration.status,201);customerIds.push(registration.body.user.id);
      const token=(await api('POST','/auth/login',null,{email,password})).body.accessToken;
      const item={productId:product.id,size:productDetail.sizes[0].size,qty:1,toppingIds:[]};
      assert.equal((await api('POST','/cart/items',token,item)).status,201);
      const created=await api('POST','/orders',token,{items:[item]},randomUUID());assert.equal(created.status,201);
      const id=created.body.id;
      if(status!=='PENDING') {
        await mode(status==='PAYMENT_FAILED'?'FAILURE':'SUCCESS');
        assert.equal((await api('POST','/payments',token,{orderId:id,method:'WALLET'},randomUUID())).status,200);
        if(status==='CANCELLED') assert.equal((await api('POST','/admin/orders/'+id+'/paid-cancel',adminToken,{expectedVersion:(await api('GET','/operator/orders/'+id,adminToken)).body.version})).status,200);
        else if(['PREPARING','READY','COMPLETED'].includes(status)) for(const targetStatus of ['PREPARING','READY','COMPLETED']) {
          const current=(await api('GET','/operator/orders/'+id,adminToken)).body;
          assert.equal((await api('POST','/operator/orders/'+id+'/transitions',adminToken,{expectedVersion:current.version,targetStatus})).status,200);if(targetStatus===status)break;
        }
      }
      assert.equal((await api('GET','/orders/'+id,token)).body.status,status);
      orders.set(status,{id,code:created.body.orderCode});
    }
    await mode('SUCCESS');
    const before=await fingerprint();
    const staffToken=await login(staff,'Đơn cần xử lý'); await loaded('[data-operator-order]');
    assert.equal(await evaluate('location.pathname'),'/operator/orders');
    assert(await evaluate("!document.querySelector('.auth-nav,.site-header,.site-footer')"));
    const staffList=(await api('GET','/operator/orders',staffToken)).body.items;
    assert(staffList.every(o=>['PAID','PREPARING','READY'].includes(o.status)));
    for(const status of ['PAID','PREPARING','READY']) assert(staffList.some(o=>o.id===orders.get(status).id));
    const expected=(await database.query("SELECT id FROM orders WHERE status IN ('PAID','PREPARING','READY') ORDER BY created_at DESC,id DESC")).rows.map(o=>o.id);
    assert.deepEqual(staffList.map(o=>o.id),expected);
    for(const status of ['PENDING','PAYMENT_FAILED','CANCELLED']) {
      assert.equal((await api('GET','/operator/orders?status='+status,staffToken)).status,403);
      assert.equal((await api('GET','/operator/orders/'+orders.get(status).id,staffToken)).status,404);
      await login(staff,'Không tìm thấy đơn hàng','/operator/orders/'+orders.get(status).id);
      assert(await evaluate("!document.querySelector('[data-operator-detail],[data-workflow-target],[data-workflow-cancel]')"));
    }
    const forged=new JwtService().sign({sub:staff.id,role:'ADMIN'},{secret:process.env.JWT_SECRET,expiresIn:3600,algorithm:'HS256'});
    assert.equal((await api('GET','/operator/orders?status=CANCELLED',forged)).status,403);
    await login(staff,'Đã hoàn thành','/operator/orders/completed'); await loaded('[data-operator-order]');
    assert((await api('GET','/operator/orders?status=COMPLETED',staffToken)).body.items.every(o=>o.status==='COMPLETED'));
    await evaluate(`document.querySelector('[data-operator-order="${orders.get('COMPLETED').id}"] a').click()`); await waitText('Phiên bản hiện tại');
    assert(await evaluate("!document.querySelector('[data-workflow-target],[data-workflow-cancel]')"));
    await login(admin,'Tổng quan'); await loaded('.overview-grid');assert.equal(await evaluate('location.pathname'),'/admin');
    const rollbackLayouts=[];
    for (const [path,title] of [['/admin','Tổng quan'],['/admin/orders','Đơn hàng'],['/admin/products','Quản lý sản phẩm'],['/admin/products/inventory','Quản lý tồn kho']]) {
      await login(admin,title,path); await loaded('.operations-sidebar');
      for (const [width,height] of [[390,844],[768,1024],[1366,768]]) {
        await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(150);
        const layout=await evaluate("({sidebars:document.querySelectorAll('.operations-sidebar').length,headers:document.querySelectorAll('.operations-topbar').length,overflow:document.documentElement.scrollWidth>innerWidth,promotionLinks:document.querySelectorAll('a[href^=\"/admin/promotions\"]').length})");
        assert.deepEqual(layout,{sidebars:1,headers:1,overflow:false,promotionLinks:0});rollbackLayouts.push({path,width,...layout});
      }
    }
    for (const path of ['/admin/campaigns','/admin/promotions','/campaigns','/campaigns/featured']) assert.equal((await api('GET',path,adminToken)).status,404);
    report.a07Rollback={adminLayouts:rollbackLayouts,removedBackendRoutes404:true};
    await login(admin,'Tổng quan'); await loaded('.overview-grid');
    const all=(await api('GET','/operator/orders',adminToken)).body.items;
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.overview-grid dd')].map(e=>Number(e.textContent))"),['PENDING','PAYMENT_FAILED','PAID','CANCELLED','PREPARING','READY','COMPLETED'].map(s=>all.filter(o=>o.status===s).length));
    await evaluate("document.querySelector('a[href=\"/admin/orders\"]').click()"); await loaded('[data-operator-order]');
    for(const status of statuses) {
      await evaluate(`(()=>{const e=document.getElementById('operator-status');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(status)});e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await loaded(`[data-operator-order="${orders.get(status).id}"]`);
      assert(await evaluate(`[...document.querySelectorAll('[data-operator-order] [data-order-status]')].every(e=>e.dataset.orderStatus===${JSON.stringify(status)})`));
      assert.equal((await api('GET','/operator/orders/'+orders.get(status).id,adminToken)).status,200);
    }
    assert.equal(await fingerprint(),before,'UI01 successful/denied GETs and login must not mutate business data');
    const layouts=[];
    for(const [width,height] of [[390,844],[768,1024],[1366,768]]) {
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const layout=await evaluate("({overflow:document.documentElement.scrollWidth>innerWidth,links:[...document.querySelectorAll('.operator-navigation a')].map(a=>a.getBoundingClientRect().height)})");
      assert(!layout.overflow&&layout.links.every(h=>h>=44));layouts.push({width,height,...layout});
      const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(root,`Docs/${evidencePrefix}-admin-orders-${width}.png`),Buffer.from(shot.data,'base64'));
    }
    const paid=orders.get('PAID');await login(staff,'Phiên bản hiện tại','/operator/orders/'+paid.id); await loaded('[data-workflow-target]');
    const version=(await api('GET','/operator/orders/'+paid.id,adminToken)).body.version;
    assert.equal((await api('POST','/admin/orders/'+paid.id+'/paid-cancel',adminToken,{expectedVersion:version})).status,200);
    await evaluate("document.querySelector('[data-operator-retry]').click()");await waitText('Không tìm thấy đơn hàng');
    assert(await evaluate("!document.querySelector('[data-operator-detail],[data-workflow-target]')"));
    await evaluate("document.querySelector('a[href=\"/operator/orders\"]').click()");await loaded('[data-operator-order]');
    assert(!await evaluate(`!!document.querySelector('[data-operator-order="${paid.id}"]')`));
    await evaluate("document.querySelector('.operations-topbar button').click()");await waitText('Chào bạn trở lại');
    assert(await evaluate("!document.querySelector('[data-operator-order],[data-operator-detail],.overview-grid')"));
    await login(admin,'Tổng quan');await loaded('.overview-grid');
    await database.query("UPDATE users SET role='STAFF' WHERE id=$1",[admin.id]);
    try { assert.equal((await api('GET','/operator/orders?status=PENDING',adminToken)).status,403); assert.equal((await api('GET','/operator/orders/'+orders.get('PENDING').id,adminToken)).status,404); }
    finally {await database.query("UPDATE users SET role='ADMIN' WHERE id=$1",[admin.id]);}
    report.ui01={realSevenStateFixtures:true,staffDefaultScope:true,staffCompletedReadOnly:true,forbiddenFilter403:true,hiddenDetail404:true,forgedRoleDenied:true,adminAllStates:true,adminActualCounts:true,sortPreserved:true,GETReadOnlyFingerprints:true,adminCancellationRaceClearsStaff:true,logoutAccountSwitch:true,DBRoleAuthoritative:true,layouts,humanManualQA:false,Firefox:false,NFR01:false};
    report.checks.push('UI01 real seven-state Customer/Payment/A03 fixtures; shared STAFF/ADMIN redirects, separate layouts, exact STAFF scopes/403/404/direct URLs, completed read-only, ADMIN all statuses/counts/filters, GET fingerprints, paid cancellation clears open STAFF view and queue, logout/switch/current DB role, responsive390/768/1366');
    await login({email:customerEmail,password:customerPassword,role:'CUSTOMER'},'Giỏ đang trống','/cart');
  } finally {
    await mode('SUCCESS');
    if (!(await keepJournalFixtures(database))) {
    // IDs belong exclusively to this run inside the asserted UUID schema.
    for(const id of customerIds) {
      await database.query('DELETE FROM payments WHERE user_id=$1',[id]);await database.query('DELETE FROM loyalty_awards WHERE user_id=$1',[id]);
      await database.query('DELETE FROM idempotency_requests WHERE user_id=$1',[id]);
      await database.query('DELETE FROM order_item_toppings WHERE order_item_id IN (SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.user_id=$1)',[id]);
      await database.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id=$1)',[id]);await database.query('DELETE FROM orders WHERE user_id=$1',[id]);
      await database.query('DELETE FROM carts WHERE user_id=$1',[id]);await database.query('DELETE FROM users WHERE id=$1',[id]);
    }
    if(productBefore) await database.query('UPDATE products SET stock=$2,version=$3,updated_at=$4 WHERE id=$1',[productBefore.id,productBefore.stock,productBefore.version,productBefore.updated_at]);
    for(const actor of operators)await database.query('DELETE FROM users WHERE id=$1 AND email=$2',[actor.id,actor.email]);
    }
  }
}
