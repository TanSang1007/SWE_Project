import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { provisionOperator } = require('../../backend/scripts/provision-operator.cjs');
const { JwtService } = require('@nestjs/jwt');

export async function verifyOperatorBrowser({ evaluate, command, waitText, navigate, delay, database, root, report, customerId,
  customerEmail, customerPassword, loginPayload, checkoutPosts, setReadMode, heldRead, evidencePrefix='A02' }) {
  const fixtures = [];
  const fingerprint = async () => {
    const tables = (await database.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' AND table_name<>'_prisma_migrations' ORDER BY table_name")).rows;
    const values = {};
    for (const { table_name: name } of tables) values[name] = (await database.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS h FROM "${name}" t`)).rows[0].h;
    return JSON.stringify(values);
  };
  const baseline = await fingerprint(); const posts = { ...checkoutPosts };
  async function fill(id, value) {
    await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  async function login(actor, expected = 'Đơn cần xử lý', path = '/login') {
    await navigate(path); await waitText('Chào bạn trở lại'); await fill('auth-email', actor.email); await fill('auth-password', actor.password);
    await evaluate("document.querySelector('.auth-submit').click()"); await waitText(expected);
  }
  async function clientNavigate(path) {
    assert(await evaluate(`(()=>{let e=document.querySelector('#main-content');let f=e[Object.keys(e).find(k=>k.startsWith('__reactFiber$'))];while(f){let v=f.memoizedProps?.value;if(v&&typeof v.push==='function'&&typeof v.refresh==='function'){v.push(${JSON.stringify(path)});return true;}f=f.return;}return false;})()`));
  }
  const api = (path, token = loginPayload()?.accessToken) => evaluate(`fetch('http://localhost:3001${path}',{headers:${JSON.stringify(token ? { Authorization: 'Bearer ' + token } : {})},cache:'no-store'}).then(async r=>({status:r.status,body:await r.json(),cache:r.headers.get('Cache-Control')}))`);
  const retry = () => evaluate("document.querySelector('[data-operator-retry]').click()");
  const noData = () => evaluate("!document.querySelector('[data-operator-order],[data-operator-detail]')");
  try {
    await command('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:3001/operator/orders*', requestStage: 'Request' }] });
    for (const role of ['STAFF', 'ADMIN']) {
      const email = `${randomUUID()}@example.invalid`; const password = randomBytes(20).toString('hex');
      const result = await provisionOperator(database, { email, password, role }, { ...process.env, NODE_ENV: 'development', ALLOW_OPERATOR_PROVISIONING: 'true' });
      fixtures.push({ ...result, email, password });
    }
    const staff = fixtures.find((a) => a.role === 'STAFF'); const admin = fixtures.find((a) => a.role === 'ADMIN');
    const customer = { email: customerEmail, password: customerPassword };
    const customerOrders = (await database.query('SELECT id,order_code,status,total::text,version,updated_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC,id DESC', [customerId])).rows;
    assert(customerOrders.length > 0, 'Real customer checkout must produce persistent orders');
    const chosen = customerOrders.find((o) => o.status === 'PAID') ?? customerOrders[0];
    const beforeReads = await fingerprint();
    await login(staff); await waitText(chosen.order_code);
    const list = await api('/operator/orders'); assert.equal(list.status, 200); assert(list.body.items.some((o) => o.id === chosen.id)); assert(list.cache.includes('no-store'));
    assert(!await evaluate("!!document.querySelector('a[href=\"/admin/products\"]')"));
    await evaluate(`document.querySelector('[data-operator-order="${chosen.id}"] a').click()`); await waitText('Phiên bản hiện tại');
    const detail = await api('/operator/orders/' + chosen.id); assert.equal(detail.status, 200); assert.equal(detail.body.version, chosen.version); assert.equal(detail.body.status, chosen.status); assert.equal(detail.body.total, chosen.total);
    const snapshotNames = detail.body.items.map((i) => i.productName); for (const name of snapshotNames) await waitText(name);
    setReadMode('error'); await retry(); await waitText('Chưa tải được đơn hàng'); assert(await noData());
    setReadMode('real'); await retry(); await waitText('Phiên bản hiện tại');
    assert(await evaluate(`document.querySelector('[data-operator-detail]').innerText.includes(${JSON.stringify(BigInt(chosen.total).toLocaleString('vi-VN'))})`));
    assert(!await evaluate("!!document.querySelector('[data-operator-detail] button,[data-operator-detail] a[href*=cart]')"));
    const layouts = [];
    for (const [width, height] of [[390,844],[768,1024],[1366,768]]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false });
      assert(!await evaluate('document.documentElement.scrollWidth>innerWidth'));
      const shot = await command('Page.captureScreenshot', { format:'png',captureBeyondViewport:true }); writeFileSync(join(root,`Docs/${evidencePrefix}-operator-detail-${width}.png`),Buffer.from(shot.data,'base64'));
      await evaluate("document.querySelector('a[href=\"/operator/orders\"].back-link').click()"); await waitText(chosen.order_code);
      const layout = await evaluate("({overflow:document.documentElement.scrollWidth>innerWidth,selectHeight:document.getElementById('operator-status').getBoundingClientRect().height,retryHeight:document.querySelector('[data-operator-retry]').getBoundingClientRect().height})");
      assert(!layout.overflow); assert(layout.selectHeight>=44); assert(layout.retryHeight>=44); layouts.push({width,height,...layout});
      const listShot = await command('Page.captureScreenshot', {format:'png',captureBeyondViewport:true}); writeFileSync(join(root,`Docs/${evidencePrefix}-operator-list-${width}.png`),Buffer.from(listShot.data,'base64'));
      await evaluate(`document.querySelector('[data-operator-order="${chosen.id}"] a').click()`); await waitText('Phiên bản hiện tại');
    }
    await retry(); await waitText('Phiên bản hiện tại');
    await command('Page.reload',{ignoreCache:true}); await waitText('Cần đăng nhập'); assert(await noData());
    await login(staff,'Phiên bản hiện tại',`/login?returnTo=/operator/orders/${chosen.id}`); await waitText(chosen.order_code);
    await evaluate("document.querySelector('a[href=\"/operator/orders\"].back-link').click()"); await waitText(chosen.order_code);
    await evaluate("(()=>{let e=document.getElementById('operator-status');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,'PAID');e.dispatchEvent(new Event('change',{bubbles:true}));})()"); await delay(300);
    await waitText(chosen.order_code);
    assert(await evaluate("document.querySelectorAll('[data-operator-order]').length>0&&[...document.querySelectorAll('[data-operator-order] [data-order-status]')].every(e=>e.getAttribute('data-order-status')==='PAID')"));
    await evaluate("document.getElementById('operator-status').focus()");
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}); await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    assert(await evaluate("document.activeElement.matches('[data-operator-order] a')&&getComputedStyle(document.activeElement).outlineStyle!=='none'"));
    setReadMode('empty'); await retry(); await waitText('Không có đơn hàng'); assert(await noData());
    setReadMode('error'); await retry(); await waitText('Chưa tải được đơn hàng'); assert(await noData());
    setReadMode('real'); await evaluate("document.querySelector('[data-operator-retry]').focus()");
    assert(await evaluate("document.activeElement.matches('[data-operator-retry]')&&!document.activeElement.disabled&&getComputedStyle(document.activeElement).outlineStyle!=='none'"));
    // Native button activation needs the character event as well as keydown/up.
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13}); await waitText(chosen.order_code);
    setReadMode('hold'); await retry(); await waitText('Đang tải đơn hàng'); assert(await noData());
    for(let i=0;i<50&&!heldRead();i++)await delay(100); assert(heldRead()); const held=heldRead();
    await evaluate("document.querySelector('.operations-topbar button').click()"); await waitText('Chào bạn trở lại'); assert(await noData());
    setReadMode('real'); await login(customer,'Cappuccino');
    try { await command('Fetch.continueRequest',{requestId:held}); } catch { /* AbortController already cancelled the old session request. */ }
    await delay(200); assert(await noData()); assert.equal((await api('/operator/orders')).status,403); assert.equal((await api('/operator/orders/'+chosen.id)).status,403);
    const forged = new JwtService().sign({sub:customerId,role:'ADMIN'},{secret:process.env.JWT_SECRET,expiresIn:3600,algorithm:'HS256'}); assert.equal((await api('/operator/orders',forged)).status,403);
    await clientNavigate('/operator/orders'); await waitText('Không có quyền truy cập'); assert(await noData());
    await login(admin,'Tổng quan'); await evaluate("document.querySelector('a[href=\"/admin/orders\"]').click()"); await waitText(chosen.order_code); assert.equal((await api('/operator/orders')).status,200);
    await evaluate(`document.querySelector('[data-operator-order="${chosen.id}"] a').click()`); await waitText('Phiên bản hiện tại'); assert.deepEqual((await api('/operator/orders/'+chosen.id)).body,detail.body);
    assert.equal(await fingerprint(),beforeReads,'Viewing operator data must preserve every business entity');
    await database.query("UPDATE users SET role='CUSTOMER' WHERE id=$1",[admin.id]);
    try { assert.equal((await api('/operator/orders')).status,403); await retry(); await waitText('Không có quyền truy cập'); assert(await noData()); }
    finally { await database.query("UPDATE users SET role='ADMIN' WHERE id=$1",[admin.id]); }
    await login(staff); await waitText(chosen.order_code); setReadMode('unauthorized'); await retry(); await waitText('Cần đăng nhập'); assert(await noData());
    setReadMode('real'); await login(customer,'Cappuccino');
    assert.equal((await api('/operator/orders',null)).status,401); assert.equal((await api('/operator/orders','invalid')).status,401);
    assert.deepEqual(checkoutPosts,posts,'Operator views must not create/pay/cancel Orders');
    assert.equal(await fingerprint(),beforeReads);
    report.operator = { realCheckoutOrderVisible:true,staffListDetail:true,adminListDetail:true,customerEndpoints403:true,forgedClaim403:true,dbRoleChange:true,
      refreshRelogin:true,logoutAccountIsolation:true,lateResponseDiscard:true,session401:true,loadingEmptyErrorRetry:true,readOnlyAllTables:true,noBusinessPosts:true,layouts,keyboardFocusEnter:true,
      snapshots:true,currentVersion:true,pagination:false,humanManualQA:false,NFR01Measured:false };
    report.checks.push('A02 real customer checkout visible to STAFF/ADMIN list/detail; direct JWT/DB-role403/401; snapshot/version/status, no-store, filter, loading/empty/error/Retry/reload/login/logout/late response/401, 3 viewports/focus/Enter; all business fingerprints and checkout POST counts unchanged');
    await evaluate("document.querySelector('.auth-nav a[href=\"/cart\"]').click()"); await waitText('Giỏ đang trống');
  } finally {
    setReadMode('real'); await command('Fetch.disable'); for(const a of fixtures)await database.query('DELETE FROM users WHERE id=$1 AND email=$2',[a.id,a.email]);
    assert.equal(await fingerprint(),baseline,'Operator fixtures must preserve original public rows');
  }
}
