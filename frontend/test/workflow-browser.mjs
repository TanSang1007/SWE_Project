import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url); const { provisionOperator } = require('../../backend/scripts/provision-operator.cjs');

export async function verifyWorkflowBrowser({evaluate,command,waitText,navigate,delay,database,root,report,backendUrl,customerId,customerEmail,customerPassword,loginPayload,posts,setMutationMode,heldMutation,setReadMode,evidencePrefix='A03'}) {
  const fixtures=[];
  async function fill(id,value){await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
  async function login(actor,expected='Đơn cần xử lý',returnTo='/operator/orders'){
    await navigate('/login?returnTo='+encodeURIComponent(returnTo));await waitText('Chào bạn trở lại');await fill('auth-email',actor.email);await fill('auth-password',actor.password);
    await evaluate("document.querySelector('.auth-submit').click()");await waitText(expected);return loginPayload().accessToken;
  }
  const api=(method,path,body,token)=>evaluate(`fetch('http://localhost:3001${path}',{method:${JSON.stringify(method)},cache:'no-store',headers:${JSON.stringify({'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})})},${body?`body:${JSON.stringify(JSON.stringify(body))},`:''}}).then(async r=>({status:r.status,body:await r.json()}))`);
  const detail=(id,token)=>api('GET','/operator/orders/'+id,undefined,token);
  const readOrder=async id=>(await database.query('SELECT id,order_code,status,version,total::text,paid_at FROM orders WHERE id=$1 AND user_id=$2',[id,customerId])).rows[0];
  async function waitStatus(status){for(let n=0;n<120;n++){if(await evaluate(`document.querySelector('[data-operator-detail] [data-order-status]')?.getAttribute('data-order-status')===${JSON.stringify(status)}`))return;await delay(100);}throw new Error('Workflow current status timeout: '+status);}
  async function waitAction(target){for(let n=0;n<100;n++){if(await evaluate(`!!document.querySelector('[data-workflow-target="${target}"]:not(:disabled)')`))return;await delay(100);}throw new Error('Workflow enabled action timeout: '+target);}
  async function clickTwice(selector){await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const p=e[Object.keys(e).find(k=>k.startsWith('__reactProps$'))];p.onClick();p.onClick();})()`);}
  async function enter(selector){
    for(let n=0;n<30;n++){if(await evaluate(`document.activeElement.matches(${JSON.stringify(selector)})&&!document.activeElement.disabled`))break;
      await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});}
    assert(await evaluate(`document.activeElement.matches(${JSON.stringify(selector)})&&getComputedStyle(document.activeElement).outlineStyle!=='none'`));
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  }
  async function holdReady(){for(let n=0;n<100&&!heldMutation();n++)await delay(100);assert(heldMutation(),'Real mutation response must be held');return heldMutation();}
  async function immutable(id){return JSON.stringify({
    items:(await database.query('SELECT to_jsonb(t) AS row FROM order_items t WHERE order_id=$1 ORDER BY id',[id])).rows,
    toppings:(await database.query('SELECT to_jsonb(t) AS row FROM order_item_toppings t WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id=$1) ORDER BY order_item_id,topping_id',[id])).rows,
    payments:(await database.query('SELECT to_jsonb(t) AS row FROM payments t WHERE order_id=$1 ORDER BY id',[id])).rows,
    awards:(await database.query('SELECT to_jsonb(t) AS row FROM loyalty_awards t WHERE order_id=$1 ORDER BY id',[id])).rows,
    products:(await database.query('SELECT id,stock,version,updated_at FROM products ORDER BY id')).rows,
    balance:(await database.query('SELECT loyalty_points,updated_at FROM users WHERE id=$1',[customerId])).rows,
    carts:(await database.query('SELECT to_jsonb(t) AS row FROM carts t WHERE user_id=$1',[customerId])).rows});}
  try {
    for(const role of ['STAFF','STAFF','ADMIN']){const email=randomUUID()+'@example.invalid';const password=randomBytes(20).toString('hex');const actor=await provisionOperator(database,{email,password,role},{...process.env,NODE_ENV:'development',ALLOW_OPERATOR_PROVISIONING:'true'});fixtures.push({...actor,email,password});}
    const [staff,second,admin]=fixtures;const customer={email:customerEmail,password:customerPassword};
    const paid=(await database.query("SELECT id,order_code FROM orders WHERE user_id=$1 AND status='PAID' ORDER BY created_at DESC,id DESC",[customerId])).rows;
    assert(paid.length>=3,'Actual customer checkout regression must create at least3 PAID orders');const [a,b,c]=paid;
    const patterns=[{urlPattern:'http://localhost:3001/operator/orders*',requestStage:'Request'},{urlPattern:'http://localhost:3001/operator/orders/*/transitions',requestStage:'Response'},
      {urlPattern:'http://localhost:3001/admin/orders/*/paid-cancel',requestStage:'Request'},{urlPattern:'http://localhost:3001/admin/orders/*/paid-cancel',requestStage:'Response'}];
    await command('Fetch.enable',{patterns});
    const staffToken=await login(staff,'Phiên bản hiện tại','/operator/orders/'+a.id);await waitStatus('PAID');assert(!await evaluate("!!document.querySelector('[data-workflow-cancel]')"));
    const layouts=[];for(const [width,height]of [[390,844],[768,1024],[1366,768]]){await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      const layout=await evaluate("({overflow:document.documentElement.scrollWidth>innerWidth,actionHeight:document.querySelector('[data-workflow-target]').getBoundingClientRect().height})");assert(!layout.overflow&&layout.actionHeight>=44);layouts.push({width,height,...layout});
      const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(root,`Docs/${evidencePrefix}-staff-workflow-${width}.png`),Buffer.from(shot.data,'base64'));}
    const aBefore=await readOrder(a.id);const invariant=await immutable(a.id);let count=posts();
    setMutationMode('block');await enter('[data-workflow-target="PREPARING"]');await waitText('Đơn vẫn ở trạng thái và phiên bản đã đọc');assert.equal((await readOrder(a.id)).version,aBefore.version);assert.equal(posts(),count+1);
    assert(await evaluate("!!document.querySelector('[data-workflow-original-retry]')&&!document.querySelector('[data-workflow-target]:not(:disabled)')"));
    setMutationMode('hold');count=posts();await clickTwice('[data-workflow-original-retry]');await waitText('Đang xử lý thao tác');const held=await holdReady();assert.equal(posts(),count+1);
    assert(await evaluate("document.querySelector('[data-operator-retry]').disabled&&[...document.querySelectorAll('[data-workflow-target]')].every(e=>e.disabled)"));await waitStatus('PAID');
    setMutationMode('real');await command('Fetch.continueResponse',{requestId:held});await waitStatus('PREPARING');await waitAction('READY');assert.equal((await detail(a.id,staffToken)).body.version,aBefore.version+1);
    setMutationMode('lose');count=posts();await enter('[data-workflow-target="READY"]');await waitStatus('READY');await waitAction('COMPLETED');assert.equal(posts(),count+1);assert(!await evaluate("!!document.querySelector('[data-workflow-original-retry]')"));
    setReadMode('error');count=posts();await enter('[data-workflow-target="COMPLETED"]');await waitText('Máy chủ đã xác nhận thao tác nhưng chưa tải được trạng thái mới');assert.equal((await readOrder(a.id)).status,'COMPLETED');assert.equal(posts(),count+1);
    assert(!await evaluate("!!document.querySelector('[data-workflow-original-retry]')"));setReadMode('real');await enter('[data-workflow-reload]');await waitText('Đơn cần xử lý');assert(!await evaluate(`!!document.querySelector('[data-operator-order=\"${a.id}\"]')`));await evaluate("document.querySelector('a[href=\"/operator/orders/completed\"]').click()");await waitText(a.order_code);await evaluate(`document.querySelector('[data-operator-order=\"${a.id}\"] a').click()`);await waitStatus('COMPLETED');assert(!await evaluate("!!document.querySelector('[data-workflow-target],[data-workflow-cancel]')"));
    assert.equal(await immutable(a.id),invariant,'Preparation must not reprice/restock/reaward/pay/change Cart');assert.equal((await readOrder(a.id)).version,aBefore.version+3);
    await evaluate("document.querySelector('.back-link').click()");await waitText(a.order_code);assert.equal(await evaluate(`document.querySelector('[data-operator-order="${a.id}"] [data-order-status]').getAttribute('data-order-status')`),'COMPLETED');
    await evaluate("document.querySelector('a[href=\"/operator/orders\"]').click()");await waitText('Đơn cần xử lý');await evaluate("(()=>{let e=document.getElementById('operator-status');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'PAID');e.dispatchEvent(new Event('change',{bubbles:true}));})()");await delay(300);
    assert(!await evaluate(`!!document.querySelector('[data-operator-order="${a.id}"]')`));
    const customerToken=await login(customer,'Đã hoàn tất',`/orders/${a.id}/confirmation`);assert.equal((await api('POST',`/operator/orders/${a.id}/transitions`,{expectedVersion:0,targetStatus:'PREPARING'},customerToken)).status,403);
    assert.equal((await api('POST',`/admin/orders/${c.id}/paid-cancel`,{expectedVersion:0},customerToken)).status,403);
    await login(staff,'Phiên bản hiện tại','/operator/orders/'+b.id);await waitStatus('PAID');const bBefore=await readOrder(b.id);
    const secondLogin=await(await fetch(backendUrl+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:second.email,password:second.password})})).json();
    assert.equal((await api('POST',`/operator/orders/${b.id}/transitions`,{expectedVersion:bBefore.version,targetStatus:'PREPARING'},secondLogin.accessToken)).status,200);
    count=posts();await enter('[data-workflow-target="PREPARING"]');await waitText('Dữ liệu đã thay đổi hoặc thao tác không còn hợp lệ');assert.equal(posts(),count+1);assert(!await evaluate("!!document.querySelector('[data-workflow-original-retry]')"));
    await enter('[data-workflow-reload]');await waitStatus('PREPARING');await waitAction('READY');assert.equal((await readOrder(b.id)).version,bBefore.version+1);
    assert.equal((await api('POST',`/admin/orders/${c.id}/paid-cancel`,{expectedVersion:(await readOrder(c.id)).version},staffToken)).status,403);
    const adminToken=await login(admin,'Phiên bản hiện tại','/operator/orders/'+c.id);await waitStatus('PAID');assert.equal((await api('POST',`/admin/orders/${b.id}/paid-cancel`,{expectedVersion:(await readOrder(b.id)).version},adminToken)).status,409);
    const cBefore=await readOrder(c.id);const paymentBefore=(await database.query('SELECT to_jsonb(t) AS row FROM payments t WHERE order_id=$1',[c.id])).rows;
    const snapshotBefore=(await database.query('SELECT to_jsonb(t) AS row FROM order_items t WHERE order_id=$1 ORDER BY id',[c.id])).rows;
    const demand=(await database.query('SELECT product_id,sum(qty)::int AS qty FROM order_items WHERE order_id=$1 GROUP BY product_id ORDER BY product_id',[c.id])).rows;
    const stocksBefore=(await database.query('SELECT id,stock,version FROM products WHERE id=ANY($1::uuid[]) ORDER BY id',[demand.map(x=>x.product_id)])).rows;
    const awardBefore=(await database.query('SELECT points,reversed_at FROM loyalty_awards WHERE order_id=$1',[c.id])).rows[0];const balanceBefore=(await database.query('SELECT loyalty_points FROM users WHERE id=$1',[customerId])).rows[0].loyalty_points;
    count=posts();await evaluate("document.querySelector('[data-workflow-cancel]').click()");await waitText('Hủy đơn không đồng nghĩa hoàn tiền');assert.equal(posts(),count);
    await evaluate("[...document.querySelectorAll('button')].find(e=>e.innerText==='Giữ đơn').click()");assert.equal(posts(),count);
    await evaluate("document.querySelector('[data-workflow-cancel]').click()");await waitText('Xác nhận hủy đơn đã thanh toán');
    for(const [width,height]of [[390,844],[768,1024],[1366,768]]){await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});assert(!await evaluate('document.documentElement.scrollWidth>innerWidth'));
      const shot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});writeFileSync(join(root,`Docs/${evidencePrefix}-admin-cancel-${width}.png`),Buffer.from(shot.data,'base64'));}
    setMutationMode('hold');count=posts();await clickTwice('[data-confirm-paid-cancel]');await waitText('Đang xử lý thao tác');const cancelHeld=await holdReady();assert.equal(posts(),count+1);setMutationMode('real');await command('Fetch.continueResponse',{requestId:cancelHeld});await waitStatus('CANCELLED');
    const stocksAfter=(await database.query('SELECT id,stock,version FROM products WHERE id=ANY($1::uuid[]) ORDER BY id',[demand.map(x=>x.product_id)])).rows;
    for(let n=0;n<stocksAfter.length;n++){assert.equal(stocksAfter[n].stock,stocksBefore[n].stock+demand[n].qty);assert.equal(stocksAfter[n].version,stocksBefore[n].version+1);}
    const awardAfter=(await database.query('SELECT points,reversed_at FROM loyalty_awards WHERE order_id=$1',[c.id])).rows[0];assert.equal(awardAfter.points,awardBefore.points);assert(awardAfter.reversed_at);
    assert.equal((await database.query('SELECT loyalty_points FROM users WHERE id=$1',[customerId])).rows[0].loyalty_points,balanceBefore-awardBefore.points);
    assert.deepEqual((await database.query('SELECT to_jsonb(t) AS row FROM payments t WHERE order_id=$1',[c.id])).rows,paymentBefore);assert.deepEqual((await database.query('SELECT to_jsonb(t) AS row FROM order_items t WHERE order_id=$1 ORDER BY id',[c.id])).rows,snapshotBefore);
    assert.equal((await readOrder(c.id)).paid_at.toISOString(),cBefore.paid_at.toISOString());assert.equal((await readOrder(c.id)).version,cBefore.version+1);
    const stable=await immutable(c.id);assert.equal((await api('POST',`/admin/orders/${c.id}/paid-cancel`,{expectedVersion:cBefore.version},adminToken)).status,200);assert.equal((await api('POST',`/admin/orders/${c.id}/paid-cancel`,{expectedVersion:cBefore.version},staffToken)).status,403);assert.equal(await immutable(c.id),stable);
    await command('Page.reload',{ignoreCache:true});await waitText('Cần đăng nhập');assert(!await evaluate("!!document.querySelector('[data-operator-detail],[data-workflow-target]')"));
    await login(customer,'Đã hủy',`/orders/${c.id}/confirmation`);await waitText('Thành công');assert.equal((await api('GET','/loyalty',undefined,loginPayload().accessToken)).body.loyaltyPoints,balanceBefore-awardBefore.points);
    assert(!await evaluate("!!document.querySelector('[data-workflow-target],[data-workflow-cancel]')"));
    report.workflow={customerCheckoutReal:true,staffExactGraph:true,customerCompleted:true,adminCancelConfirmed:true,stockAggregatedExact:true,originalAwardReversedOnce:true,paymentPreserved:true,paidAtPreserved:true,snapshotsPreserved:true,
      customer403:true,staffCancel403IncludingCancelled:true,invalidPreparingCancel409:true,twoAuthenticatedStaffSessionsStale409:true,noAutoConflictRetry:true,doubleClickOnePost:true,
      unchangedTransportRetryOriginal:true,lostCommittedResponseFreshGET:true,confirmedGETFailureNoPostRetry:true,listFilterUpdated:true,refreshRelogin:true,roleSessionIsolation:true,layouts,keyboard:true,humanManualQA:false,productionDataUsed:false};
    report.checks.push('A03 isolated real checkout→STAFF PAID/PREPARING/READY/COMPLETED→customer COMPLETED; ADMIN confirm paid-cancel exact stock/original award/Payment/paidAt/snapshot invariants; direct CUSTOMER/STAFF403, independent STAFF session stale409, double-click one POST, blocked/lost POST reconciliation and confirmed GET-only recovery; list filter/reload/login/keyboard/3 viewports');
    await evaluate("document.querySelector('.auth-nav a[href=\"/cart\"]').click()");await waitText('Giỏ đang trống');
  } finally {setReadMode('real');setMutationMode('real');await command('Fetch.disable');for(const actor of fixtures)await database.query('DELETE FROM users WHERE id=$1 AND email=$2',[actor.id,actor.email]);}
}
