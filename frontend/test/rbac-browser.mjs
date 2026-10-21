import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { provisionOperator } = require('../../backend/scripts/provision-operator.cjs');
const { JwtService } = require('@nestjs/jwt');

export async function verifyRbacBrowser({ evaluate, command, waitText, navigate, database, root, report, guardPort, evidencePrefix = 'A01', loginPayload, customerEmail, customerPassword }) {
  const fixtures = [];
  const fingerprint = async () => {
    const tables = (await database.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' AND table_name<>'_prisma_migrations' ORDER BY table_name")).rows;
    const values = {};
    for (const { table_name: name } of tables) values[name] = (await database.query(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS h FROM "${name}" t`)).rows[0].h;
    return JSON.stringify(values);
  };
  const before = await fingerprint();
  async function fill(id, value) {
    await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  }
  async function login(email, password, expected, path = '/login') {
    await navigate(path); await waitText('Chào bạn trở lại'); await fill('auth-email', email); await fill('auth-password', password);
    await evaluate("document.querySelector('.auth-submit').click()"); await waitText(expected);
  }
  async function clientNavigate(path) {
    // CDP driver uses the existing App Router context to preserve memory auth.
    assert(await evaluate(`(()=>{const e=document.querySelector('#main-content');let f=e[Object.keys(e).find(k=>k.startsWith('__reactFiber$'))];while(f){const v=f.memoizedProps?.value;if(v&&typeof v.push==='function'&&typeof v.refresh==='function'){v.push(${JSON.stringify(path)});return true;}f=f.return;}return false;})()`));
  }
  async function probe(name, token = loginPayload()?.accessToken) {
    return evaluate(`fetch('http://127.0.0.1:${guardPort}/__auth_verify/${name}',{headers:${JSON.stringify(token ? { Authorization: `Bearer ${token}` } : {})}}).then(r=>r.status)`);
  }
  try {
    const env = { ...process.env, NODE_ENV: 'development', ALLOW_OPERATOR_PROVISIONING: 'true' };
    for (const role of ['STAFF', 'ADMIN']) {
      const email = `${randomUUID()}@example.invalid`; const password = ` ${randomBytes(20).toString('hex')} `;
      const result = await provisionOperator(database, { email, password, role }, env); fixtures.push({ ...result, email, password });
    }
    const staff = fixtures.find((f) => f.role === 'STAFF'); const admin = fixtures.find((f) => f.role === 'ADMIN');
    await login(customerEmail, customerPassword, 'Cappuccino'); assert.equal(loginPayload().user.role, 'CUSTOMER');
    assert(!await evaluate("!!document.querySelector('.auth-nav a[href=\"/operator/orders\"]')"));
    assert.equal(await probe('operator'), 403); assert.equal(await probe('admin'), 403);
    await clientNavigate('/operator/orders'); await waitText('Không có quyền truy cập');
    assert(!await evaluate("!!document.querySelector('.operator-navigation')"));
    await login(staff.email, staff.password, 'Đơn cần xử lý'); assert.equal(loginPayload().user.role, 'STAFF');
    assert.equal(await probe('operator'), 200); assert.equal(await probe('admin'), 403);
    assert(!await evaluate("!!document.querySelector('a[href=\"/admin/products\"]')"));
    await clientNavigate('/admin/products'); await waitText('Không có quyền truy cập');
    await database.query("UPDATE users SET role='ADMIN' WHERE id=$1", [staff.id]); assert.equal(await probe('admin'), 200);
    await database.query("UPDATE users SET role='STAFF' WHERE id=$1", [staff.id]); assert.equal(await probe('admin'), 403);
    await login(admin.email, admin.password, 'Tổng quan'); assert.equal(loginPayload().user.role, 'ADMIN');
    assert.equal(await probe('operator'), 200); assert.equal(await probe('admin'), 200);
    await evaluate("document.querySelector('.operator-navigation a[href=\"/admin/products\"]').click()"); await waitText('Quản lý sản phẩm');
    for(let n=0;n<100&&!await evaluate("!!document.querySelector('.product-management-table')");n++)await new Promise(resolve=>setTimeout(resolve,100));
    assert(await evaluate("!!document.querySelector('.product-management-table')&&!document.querySelector('.auth-nav')"));
    const layouts = [];
    for (const [width, height] of [[390, 844], [768, 1024], [1366, 768]]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const layout = await evaluate("({overflow:document.documentElement.scrollWidth>innerWidth,links:[...document.querySelectorAll('.operator-navigation a')].map(a=>a.getBoundingClientRect().height)})");
      assert(!layout.overflow); assert(layout.links.every((h) => h >= 44)); layouts.push({ width, height, ...layout });
      const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(join(root, `Docs/${evidencePrefix}-admin-shell-${width}.png`), Buffer.from(shot.data, 'base64'));
    }
    let focused = false;
    for (let i = 0; i < 20 && !focused; i++) {
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      focused = await evaluate("document.activeElement.matches('.operator-navigation a')");
    }
    assert(focused); await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await waitText('BrewLite');
    await evaluate("document.querySelector('.operations-topbar button').click()"); await waitText('Chào bạn trở lại');
    assert(!await evaluate("!!document.querySelector('.operator-shell')"));
    await login(staff.email, staff.password, 'Đơn cần xử lý'); assert(!await evaluate("!!document.querySelector('a[href=\"/admin/products\"]')"));
    await login(admin.email, admin.password, 'Tổng quan'); await clientNavigate('/admin/products'); await waitText('Quản lý sản phẩm');
    await command('Page.reload', { ignoreCache: true }); await waitText('Cần đăng nhập');
    assert.equal(await evaluate("Object.keys(localStorage).concat(Object.keys(sessionStorage)).filter(k=>/token|jwt|auth/i.test(k)).length"), 0);
    await login(customerEmail, customerPassword, 'Cappuccino'); assert(!await evaluate("!!document.querySelector('a[href=\"/admin/products\"]')"));
    for (const role of ['ADMIN', 'STAFF']) {
      const email = `${randomUUID()}@example.invalid`;
      assert.equal(await evaluate(`fetch('http://localhost:3001/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify({ email, password: randomBytes(20).toString('hex'), role })})}).then(r=>r.status)`), 400);
      assert.equal((await database.query('SELECT count(*)::int AS n FROM users WHERE email=$1', [email])).rows[0].n, 0);
    }
    const forged = new JwtService().sign({ sub: loginPayload().user.id, role: 'ADMIN' }, { secret: process.env.JWT_SECRET, expiresIn: 3600, algorithm: 'HS256' });
    assert.equal(await probe('admin', forged), 403); assert.equal(await probe('admin', null), 401);
    for (const path of ['/__auth_verify/operator', '/__auth_verify/admin']) assert.equal(await evaluate(`fetch('http://localhost:3001${path}').then(r=>r.status)`), 404);
    assert.equal(await evaluate("fetch('http://localhost:3001/operator/orders').then(r=>r.status)"), 401);
    assert.equal(await evaluate("fetch('http://localhost:3001/admin/products').then(r=>r.status)"), 401);
    report.rbac = { A_customerRegisterLogin: true, B_customerDeniedOperator: true, C_staffOperatorShell: true, D_staffDeniedAdmin: true,
      E_adminBothShells: true, F_logoutAndRoleIsolation: true, G_noPublicEscalation: true, forgedClaimDenied: true, dbRoleRefresh: true,
      refreshLosesMemorySession: true, keyboard: true, layouts, humanManualQA: false, operatorBusinessEndpointsImplemented: true };
    report.checks.push('A01 regression: real DB-role login/shells/direct guard200/401/403/forged claims/DB role changes/no public escalation/logout and reload isolation; A02 GET requires JWT; A04 management requires ADMIN');
    // Return to the original customer flow; its cleanup still asserts an empty Cart.
    await evaluate("document.querySelector('.auth-nav a[href=\"/cart\"]').click()"); await waitText('Giỏ đang trống');
  } finally {
    for (const fixture of fixtures) await database.query('DELETE FROM users WHERE id=$1 AND email=$2', [fixture.id, fixture.email]);
    assert.equal(await fingerprint(), before, 'Operator fixtures must leave all original public rows unchanged');
  }
}
