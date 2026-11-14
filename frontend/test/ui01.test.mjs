import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url); const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
const html = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const { OperatorShellContent } = require('../src/components/operator-shell.tsx');
const { SiteFrameContent } = require('../src/components/site-frame.tsx');
const { OperatorStatusFilter, OperatorOrderList } = require('../src/components/operator-orders-view.tsx');
const { OverviewCounts } = require('../src/components/admin-overview.tsx');
const { roleDestination } = require('../src/lib/role-policy.ts');
test('UI01 operations URLs isolate all customer header/footer/navigation', () => {
  for (const pathname of ['/admin', '/admin/orders', '/admin/products', '/operator/orders', '/operator/orders/completed']) {
    const value = html(SiteFrameContent, { pathname, children: 'PRIVATE' });
    assert(value.includes('PRIVATE')); assert(value.includes('id="main-content"')); assert(!value.includes('site-header')); assert(!value.includes('site-footer')); assert(!value.includes('auth-nav'));
  }
});
test('UI01 STAFF queue/history navigation excludes Admin/customer/future modules', () => {
  const value = html(OperatorShellContent, { ready:true,role:'STAFF',authenticated:true,allowed:['STAFF','ADMIN'],pathname:'/operator/orders/completed',email:'fixture@example.invalid',children:'PRIVATE' });
  assert(value.includes('Khu vực pha chế')); assert(value.includes('Đã hoàn thành')); assert(value.includes('aria-current="page"')); assert(value.includes('Đăng xuất'));
  assert(!value.includes('href="/admin')); assert(!value.includes('href="/cart')); assert(!value.includes('href="/products')); assert(!value.includes('Inventory'));
});
test('UI01 ADMIN nav includes implemented A05 Topping/A06 inventory and excludes planned Promotion', () => {
  const value = html(OperatorShellContent, { ready:true,role:'ADMIN',authenticated:true,allowed:['ADMIN'],pathname:'/admin/orders',children:'PRIVATE' });
  for (const path of ['/admin','/admin/orders','/admin/products','/admin/toppings','/admin/inventory','/admin/receipts']) assert(value.includes(`href="${path}"`));
  const navigation=value.match(/<nav aria-label="Khu vực quản trị"[^>]*>(.*?)<\/nav>/)[1];assert.equal((navigation.match(/href=/g)??[]).length,6);assert(!navigation.includes('/admin/ingredients'));assert(navigation.includes('Nhập hàng'));
  assert(!value.includes('href="/operator/orders"')); assert(!value.includes('/admin/promotions'));
});
test('UI01 STAFF filter has exactly three active states; ADMIN has all seven', () => {
  const staff=html(OperatorStatusFilter,{admin:false,filter:'',onChange:()=>{}}); const admin=html(OperatorStatusFilter,{admin:true,filter:'',onChange:()=>{}});
  for(const status of ['PAID','PREPARING','READY']) assert(staff.includes(`value="${status}"`));
  for(const status of ['PENDING','PAYMENT_FAILED','CANCELLED','COMPLETED']) { assert(!staff.includes(`value="${status}"`)); assert(admin.includes(`value="${status}"`)); }
});
test('UI01 Admin detail links share snapshots but use admin frontend namespace and preserve order', () => {
  const row={orderCode:'BL-test',status:'PAID',total:'45000',createdAt:'2026-10-13T00:00:00Z',updatedAt:'2026-10-13T00:00:00Z',version:1,earnedPoints:4};
  const value=html(OperatorOrderList,{items:[{...row,id:'second'},{...row,id:'first'}],basePath:'/admin/orders'});
  assert(value.includes('href="/admin/orders/second"')); assert(!value.includes('href="/operator/orders/')); assert(value.indexOf('/admin/orders/second')<value.indexOf('/admin/orders/first'));
});
test('UI01 overview counts supplied backend rows and shows zero without fake statistics', () => {
  const value=html(OverviewCounts,{items:[{status:'PAID'},{status:'PAID'},{status:'COMPLETED'}]});
  assert.equal((value.match(/<dt>/g)??[]).length,7); assert(value.includes('<dd>2</dd>')); assert.equal((value.match(/<dd>0<\/dd>/g)??[]).length,5); assert(!value.includes('doanh thu'));
});
test('UI01 safe completed/admin deep links and role fallback are distinct', () => {
  assert.equal(roleDestination('ADMIN',null),'/admin'); assert.equal(roleDestination('STAFF','/operator/orders/completed'),'/operator/orders/completed');
  assert.equal(roleDestination('STAFF','/'),'/operator/orders'); assert.equal(roleDestination('ADMIN','/products/id'),'/admin');
  assert.equal(roleDestination('ADMIN','/admin/orders/id'),'/admin/orders/id'); assert.equal(roleDestination('STAFF','/admin/orders/id'),'/operator/orders');
});
