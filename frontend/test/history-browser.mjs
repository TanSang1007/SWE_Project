import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Called by the existing owned-app Edge harness after B06-B14 regression.
export async function verifyHistoryBrowser(ctx) {
  const { evaluate, command, waitText, delay, database, root, report, ownerId, email, password,
    fill, submit, addAgain, clickButton, latest, mode, checkoutPosts, token, setReadMode, heldRead, promotionFixtures, evidencePrefix = 'B15' } = ctx;
  const productId = '11111111-1111-4111-8111-111111111111';
  const productBefore = (await database.query('SELECT name,price::text FROM products WHERE id=$1', [productId])).rows[0];
  let secondUser;
  const openHistory = async () => { await evaluate(`document.querySelector('.auth-nav a[href="/orders"]').click()`); await waitText('Lịch sử đơn hàng'); };
  async function waitCard(id, status) {
    for (let n = 0; n < 100; n++) {
      if (await evaluate(`document.querySelector('[data-history-order="${id}"] [data-order-status]')?.getAttribute('data-order-status')===${JSON.stringify(status)}`)) return;
      await delay(50);
    }
    throw new Error('History card status did not match backend');
  }
  async function openDetail(id) {
    await evaluate(`document.querySelector('[data-history-order="${id}"] a').click()`);
    for (let n = 0; n < 100; n++) {
      if (await evaluate(`document.querySelector('[data-confirmation-order]')?.getAttribute('data-confirmation-order')===${JSON.stringify(id)}`)) return;
      await delay(50);
    }
    throw new Error('Confirmation did not load the owned Order');
  }
  async function login(accountEmail, expectedText) {
    await waitText('Chào bạn trở lại'); await fill('auth-email', accountEmail); await fill('auth-password', password); await submit(); await waitText(expectedText);
  }
  async function fingerprint() {
    const tables = (await database.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name")).rows;
    const values = {};
    for (const { table_name: name } of tables) {
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      values[name] = (await database.query(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS fingerprint FROM ${quoted} t`)).rows[0];
    }
    return values;
  }
  async function unchanged(work) {
    const before = await fingerprint(); const posts = { ...checkoutPosts }; await work();
    assert.deepEqual(await fingerprint(), before, 'History/detail/recovery GET mutated a public business table');
    assert.deepEqual(checkoutPosts, posts, 'Reading history/details issued mutation requests');
  }
  async function layouts(kind) {
    const result = [];
    for (const [width, height] of [[390,844],[768,1024],[1366,768]]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await evaluate('document.activeElement?.blur();window.scrollTo(0,0)'); await delay(100);
      const layout = await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,actionHeight:document.querySelector('[data-order-read-retry]').getBoundingClientRect().height})`);
      assert(!layout.overflow); assert(layout.actionHeight >= 44); result.push({ width, height, ...layout });
      await command('Page.bringToFront'); const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(root, `Docs/${evidencePrefix}-${kind}-${width}.png`), Buffer.from(shot.data, 'base64'));
    }
    report.historyLayouts ??= {}; report.historyLayouts[kind] = result;
    return result;
  }
  try {
    const paid = (await database.query("SELECT id,order_code,total::text FROM orders WHERE user_id=$1 AND status='PAID' ORDER BY created_at DESC,id DESC LIMIT 1", [ownerId])).rows[0];
    assert(paid);
    await unchanged(async () => {
      // A/D: history of all legitimate B06-B14 fixture lifecycles, sorted exactly as PostgreSQL.
      await openHistory(); await waitCard(paid.id, 'PAID');
      const expected = (await database.query('SELECT id FROM orders WHERE user_id=$1 ORDER BY created_at DESC,id DESC', [ownerId])).rows.map(o => o.id);
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-history-order]')].map(e=>e.getAttribute('data-history-order'))`), expected);
      await layouts('history');
      await openDetail(paid.id); await waitText('Đã thanh toán'); await waitText(paid.order_code); await layouts('confirmation');
      assert(await evaluate(`!document.querySelector('[data-checkout-action]')&&document.querySelectorAll('[data-confirmation-order]').length===1`));
      // E: direct confirmation refresh/re-login retains identity and reads backend, never create/payment.
      await command('Page.reload', { ignoreCache: true }); await waitText('Đăng nhập để xem đơn hàng');
      assert(await evaluate(`!document.querySelector('[data-confirmation-order]')`));
      await evaluate(`document.querySelector('.order-history-page a.button').click()`); await login(email, 'Đã thanh toán');
      assert.equal(await evaluate(`document.querySelector('[data-confirmation-order]').getAttribute('data-confirmation-order')`), paid.id);
      await evaluate(`document.querySelector('.order-history-links a[href="/orders"]').click()`); await waitCard(paid.id, 'PAID');
      // Loading/error/Retry use controlled transport faults, successful responses remain real Nest/PostgreSQL.
      setReadMode('hold'); await command('Fetch.enable', { patterns: [{ urlPattern: 'http://localhost:3001/orders/*', requestStage: 'Request' }] });
      await evaluate(`document.querySelector('[data-order-read-retry]').click()`); await waitText('Đang tải đơn hàng');
      for (let n = 0; n < 100 && !heldRead(); n++) await delay(50);
      assert(heldRead()); assert(await evaluate(`document.querySelector('.order-read').getAttribute('aria-busy')==='true'&&document.querySelector('[data-order-read-retry]').disabled&&!document.querySelector('[data-history-order]')`));
      setReadMode('real'); await command('Fetch.continueRequest', { requestId: heldRead() }); await waitCard(paid.id, 'PAID');
      setReadMode('error'); await evaluate(`document.querySelector('[data-order-read-retry]').click()`); await waitText('Chưa tải được đơn hàng');
      assert(await evaluate(`!!document.querySelector('[role="alert"]')&&!document.querySelector('[data-history-order]')&&!/Prisma|SELECT|password_hash/.test(document.body.innerText)`));
      setReadMode('real'); await evaluate(`document.querySelector('[data-order-read-retry]').focus()`);
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 }); await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', modifiers: 8, windowsVirtualKeyCode: 9 });
      assert(await evaluate(`document.activeElement===document.querySelector('[data-order-read-retry]')&&document.activeElement.matches(':focus-visible')&&parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0`));
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 }); await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await waitCard(paid.id, 'PAID'); await command('Fetch.disable');
    });
    // B: new promoted Order through real checkout, FAILURE appears in history/detail.
    const promotionId = randomUUID(); const promotionCode = 'B15' + randomUUID().replaceAll('-', '').slice(0,20).toUpperCase(); promotionFixtures.push(promotionId);
    await database.query("INSERT INTO promotions(id,code,discount_amount,minimum_subtotal,starts_at,ends_at,is_active) VALUES($1,$2,10000,0,'2020-01-01Z','2100-01-01Z',true)", [promotionId,promotionCode]);
    await addAgain(); await fill('checkout-promotion', promotionCode); await clickButton('Đặt hàng'); await waitText('Trạng thái: PENDING'); const failed = await latest();
    await mode('FAILURE'); await clickButton('Thanh toán'); await waitText('Trạng thái: PAYMENT_FAILED');
    const stored = (await database.query('SELECT total::text,promotion_code_snapshot FROM orders WHERE id=$1', [failed.id])).rows[0]; assert.equal(stored.total, '52000');
    // Change current catalog/Promotion; GETs must still show the immutable Order.
    await database.query("UPDATE products SET name='B15 current catalog name',price=price+777 WHERE id=$1", [productId]);
    await database.query('UPDATE promotions SET discount_amount=1,is_active=false WHERE id=$1', [promotionId]);
    await unchanged(async () => {
      await openHistory(); await waitCard(failed.id, 'PAYMENT_FAILED'); await openDetail(failed.id); await waitText('Thanh toán thất bại'); await waitText(promotionCode);
      assert(await evaluate(`document.querySelector('.order-confirmation').innerText.includes('52.000')&&document.querySelector('.order-summary').innerText.includes('Cappuccino')&&!document.querySelector('.order-summary').innerText.includes('B15 current catalog name')`));
      // Known-ID resume reads current Order; it must not POST a new Order to discover it.
      await evaluate(`document.querySelector('.order-confirmation a[href^="/cart?orderId="]').click()`); await waitText('Trạng thái: PAYMENT_FAILED');
      assert.equal(await evaluate(`document.querySelector('.order-summary h3').textContent.includes(${JSON.stringify(failed.id.toUpperCase())})`), true);
    });
    await database.query('UPDATE products SET name=$2,price=$3 WHERE id=$1', [productId, productBefore.name, productBefore.price]);
    // C: explicit unpaid cancel through existing checkout action; history/details only read the result.
    await clickButton('Hủy đơn chưa thanh toán'); await waitText('Trạng thái: CANCELLED');
    await unchanged(async () => { await openHistory(); await waitCard(failed.id, 'CANCELLED'); await openDetail(failed.id); await waitText('Đã hủy');
      assert(await evaluate(`!document.querySelector('.order-confirmation a[href^="/cart?orderId="]')&&document.body.innerText.includes('không xác nhận việc hoàn tiền')`)); });
    // D: create another PENDING from retained Cart, verify return link from checkout and history, then cancel.
    await evaluate(`document.querySelector('.auth-nav a[href="/cart"]').click()`); await waitText('62.000'); await fill('checkout-promotion','');
    await clickButton('Đặt hàng'); await waitText('Trạng thái: PENDING'); const pending = await latest();
    await unchanged(async () => { await evaluate(`document.querySelector('.order-checkout a').click()`); await waitText('Chờ thanh toán');
      assert.equal(await evaluate(`document.querySelector('[data-confirmation-order]').getAttribute('data-confirmation-order')`),pending.id);
      await openHistory(); await waitCard(pending.id, 'PENDING');
      const expected = (await database.query('SELECT id FROM orders WHERE user_id=$1 ORDER BY created_at DESC,id DESC', [ownerId])).rows.map(o => o.id);
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-history-order]')].map(e=>e.getAttribute('data-history-order'))`), expected);
      await openDetail(pending.id); await evaluate(`document.querySelector('.order-confirmation a[href^="/cart?orderId="]').click()`); await waitText('Trạng thái: PENDING');
    });
    await clickButton('Hủy đơn chưa thanh toán'); await waitText('Trạng thái: CANCELLED');
    // F: second real account has empty history; owned UUID from the first account yields404 and no leaked detail.
    const secondEmail = `${randomUUID()}@example.invalid`; secondUser = randomUUID();
    await database.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [secondUser,secondEmail,await bcrypt.hash(password,10)]);
    await evaluate(`document.querySelector('.nav-button').click()`); await evaluate(`document.querySelector('.auth-nav a[href^="/login"]').click()`); await login(secondEmail,'Giỏ đang trống');
    await unchanged(async () => {
      await openHistory(); await waitText('Bạn chưa có đơn hàng'); assert.equal(await evaluate(`document.querySelectorAll('[data-history-order]').length`), 0);
      // Re-enter via a direct URL and log in again under the same existing memory-only policy.
      await command('Page.navigate', { url: `http://localhost:3000/orders/${paid.id}/confirmation` }); await waitText('Đăng nhập để xem đơn hàng');
      await evaluate(`document.querySelector('.order-history-page a.button').click()`); await login(secondEmail,'Không tìm thấy đơn hàng');
      assert(await evaluate(`!document.querySelector('[data-confirmation-order]')&&!document.body.innerText.includes(${JSON.stringify(paid.order_code)})`));
      for (let n=0;n<100&&!token(secondUser);n++) await delay(50);
      assert(token(secondUser));
      const status = await evaluate(`fetch('http://localhost:3001/orders/${paid.id}',{cache:'no-store',headers:{Authorization:'Bearer '+${JSON.stringify(token(secondUser))}}}).then(r=>r.status)`); assert.equal(status,404);
      await openHistory(); await waitText('Bạn chưa có đơn hàng');
      setReadMode('unauthorized'); await command('Fetch.enable', { patterns:[{urlPattern:'http://localhost:3001/orders/*',requestStage:'Request'}] });
      await evaluate(`document.querySelector('[data-order-read-retry]').click()`); await waitText('Đăng nhập để xem đơn hàng');
      assert(await evaluate(`!document.querySelector('[data-history-order]')&&!document.querySelector('.nav-button')`)); setReadMode('real'); await command('Fetch.disable');
    });
    await evaluate(`document.querySelector('.order-history-page a.button').click()`); await login(email,'Lịch sử đơn hàng'); await waitCard(paid.id,'PAID');
    report.historyVerification = { successfulOrder:paid.id,failedOrder:failed.id,cancelledOrder:failed.id,pendingOrder:pending.id,stableSorting:true,
      snapshotAfterCatalogPromotionChange:true,reloadLogin:true,crossOwner404:true,emptyOtherAccount:true,loadingErrorKeyboardRetry:true,
      readOnlyAllPublicTables:true,noReadMutationPosts:true,humanManualQA:false };
    report.checks.push('B15 A-F: real PAID/PAYMENT_FAILED/CANCELLED/PENDING history, SQL sorting/details, snapshot after catalog/promotion drift, known-ID GET resume and checkout confirmation link, refresh/login, second real account empty/cross-owner404, loading/error/keyboard Retry/401; read-only fingerprints of every public table and zero mutation POSTs during reads');
    // Existing harness retains Cart fixture assertions and cleanup after this function returns.
    await evaluate(`document.querySelector('.auth-nav a[href="/cart"]').click()`); await waitText('62.000');
    // A monetary text match can precede mounting the Cart controls after navigation.
    for (let n=0;n<100&&!await evaluate(`[...document.querySelectorAll('.cart-item button')].some(b=>b.textContent==='Xóa'&&!b.disabled)`);n++) await delay(50);
    await evaluate(`[...document.querySelectorAll('.cart-item button')].find(b=>b.textContent==='Xóa').click()`); await waitText('Giỏ đang trống');
    await mode('SUCCESS');
  } finally {
    setReadMode('real');
    await database.query('UPDATE products SET name=$2,price=$3 WHERE id=$1', [productId,productBefore.name,productBefore.price]);
    if (secondUser) { await database.query('DELETE FROM carts WHERE user_id=$1', [secondUser]); await database.query('DELETE FROM users WHERE id=$1', [secondUser]); }
  }
}
