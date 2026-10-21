import { OrderService } from '../../src/orders/order.service';
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { configureApp } from '../../src/common/configure-app';
import { initiationSettings } from '../../src/payments/vnpay/initiation-config';
import { SANDBOX_PAYMENT_URL } from '../../src/payments/vnpay/vnpay-config';
import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../../src/generated/prisma/client';
import { utcConnectionString } from '../../src/database/pg-connection';
import { lockUser } from '../../src/orders/order-policy';
import { effect, lockOrder, persistEffects, reconcileAccount } from '../../src/loyalty/loyalty-accounting';
// Real initiation routes; synthetic terminal history below is test-only trusted
// persistence. It does not validate provider authenticity or implement settlement.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !/^\/brewlite_b2a_[a-f0-9]{12}_test$/.test(new URL(connectionString).pathname))
    throw Error('B2A isolated database required');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname))
    throw Error('Local isolated database required');
const schema = `b2a_${randomUUID().replaceAll('-', '')}`;
const url = new URL(connectionString);
url.searchParams.set('options', `-c search_path=${schema}`);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(url.toString()) }, { schema }) });
const client = new Client({ connectionString });
const txWork = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(work, { timeout: 5000 });
let app: NestExpressApplication, jwt: JwtService;
const secret = 'synthetic-b2a-fixture-only-not-a-merchant-secret';
const settings = new ConfigService({ PAYMENT_MOCK_MODE: 'SUCCESS', JWT_SECRET: 'synthetic-b2a-jwt-fixture-of-at-least-32-bytes', JWT_EXPIRES_IN: 3600,
    ...initiationSettings({ NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_TEST_ONLY: 'true', DATABASE_URL: connectionString, TEST_DATABASE_URL: connectionString,
        VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
        VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' }) });
beforeEach(() => settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'));
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });
type Fixture = {
    user: string;
    order: string;
    product: string;
};
beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const dir = resolve(__dirname, '../../prisma/migrations');
    for (const name of readdirSync(dir).filter(n => /^\d+_/.test(n)).sort())
        await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).overrideProvider(ConfigService).useValue(settings).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    jwt = app.get(JwtService);
});
afterAll(async () => { if (app)
    await app.close(); await db.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
async function syntheticAttempt(tx: Prisma.TransactionClient, f: Fixture, key = randomUUID()) {
    const claim = await tx.idempotencyRequest.create({ data: { userId: f.user, operation: 'PAY_ORDER', idempotencyKey: key, requestHash: 'FIX01_SYNTHETIC', state: 'PROCESSING' } });
    const ref = randomUUID().replaceAll('-', '');
    const a = await tx.paymentAttempt.create({ data: { orderId: f.order, idempotencyRequestId: claim.id, merchantCode: 'TEST0001', txnRef: ref, amount: '85000',
            createDate: '20261017090000', expiresAt: new Date(Date.now() + 900000), requestParameters: {
                vnp_Version: '2.1.0', vnp_Command: 'pay', vnp_TmnCode: 'TEST0001', vnp_Amount: '8500000', vnp_CurrCode: 'VND', vnp_TxnRef: ref,
                vnp_OrderInfo: `Thanh toan BrewLite ${ref}`, vnp_OrderType: 'other', vnp_Locale: 'vn', vnp_ReturnUrl: 'https://callback.example.org/payments/vnpay/return',
                vnp_IpAddr: '127.0.0.1', vnp_CreateDate: '20261017090000', vnp_ExpireDate: '20261017091500',
            } } });
    await tx.idempotencyRequest.update({ where: { id: claim.id }, data: { orderId: f.order, state: 'COMPLETED', responseStatus: 201, responseBody: { attemptId: a.id }, completedAt: new Date() } });
    return a;
}
async function fixture(points = 50) {
    return txWork(async (tx) => {
        const user = await tx.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'NON_LOGIN_SYNTHETIC', loyaltyPoints: 100 } });
        await tx.loyaltyEntry.create({ data: { userId: user.id, kind: 'OPENING', points: 100, availableDelta: 100, reservedDelta: 0, debtDelta: 0n, effectKey: `OPENING:${user.id}` } });
        const product = await tx.product.create({ data: { name: 'FIX01 isolated fixture', price: '90000', imageUrl: '/fixture', stock: 9, sizes: { create: { size: 'S', extraPrice: '0' } } } });
        const cart = await tx.cart.create({ data: { userId: user.id } });
        await tx.cartItem.create({ data: { cartId: cart.id, productId: product.id, size: 'S', qty: 1, configurationKey: `${product.id}:S` } });
        const order = await tx.order.create({ data: { userId: user.id, orderCode: randomUUID(), status: 'PENDING', subtotal: '90000', total: String(90000 - points * 100), redeemedPoints: points, loyaltyDiscountAmount: String(points * 100), redemptionState: points ? 'RESERVED' : 'NONE', reservationCycle: points ? 1 : 0 } });
        await tx.orderItem.create({ data: { orderId: order.id, productId: product.id, productNameSnapshot: product.name, size: 'S', basePrice: '90000', sizeExtraPrice: '0', unitPrice: '90000', qty: 1, lineTotal: '90000' } });
        const before = { userId: user.id, available: 100n, reserved: 0n, debt: 0n }, account = { ...before };
        if (points)
            await persistEffects(tx, before, account, [effect(account, 'RESERVE', points, { orderId: order.id, cycle: 1 })]);
        const f = { user: user.id, order: order.id, product: product.id };
        return f;
    });
}
// Synthetic VERIFIED rows model trusted persistence only, never provider authenticity.
async function close(f: Fixture, id: string, success: boolean) {
    return txWork(async (tx) => {
        await lockUser(tx, f.user);
        await lockOrder(tx, f.order);
        await tx.$queryRaw `SELECT id FROM payment_attempts WHERE order_id=${f.order}::uuid ORDER BY id FOR UPDATE`;
        const existing = await tx.payment.findUnique({ where: { gatewayAttemptId: id } });
        if (existing)
            return existing;
        const before = await reconcileAccount(tx, f.user), account = { ...before };
        const a = await tx.paymentAttempt.findUniqueOrThrow({ where: { id } });
        const order = await tx.order.findUniqueOrThrow({ where: { id: f.order } });
        const now = new Date();
        await tx.paymentVerification.create({ data: { attemptId: id, source: 'IPN', state: 'VERIFIED', payload: { responseCode: success ? '00' : '24', transactionStatus: success ? '00' : '02' }, payloadHash: randomUUID().replaceAll('-', '').repeat(2), verifiedAt: now, processedAt: now } });
        await tx.paymentAttempt.update({ where: { id }, data: { state: success ? 'SUCCEEDED' : 'FAILED', applicationState: 'APPLIED', verifiedAt: now, appliedAt: now } });
        const claim = await tx.idempotencyRequest.findUniqueOrThrow({ where: { id: a.idempotencyRequestId } });
        const payment = await tx.payment.create({ data: { userId: f.user, orderId: f.order, idempotencyRequestId: claim.id, idempotencyKey: claim.idempotencyKey, amount: order.total, method: 'VNPAY', provider: 'VNPAY_SANDBOX', gatewayAttemptId: id, confirmedAt: now, status: success ? 'SUCCEEDED' : 'FAILED', failureCode: success ? null : 'VNPAY_DECLINED' } });
        await tx.order.update({ where: { id: order.id }, data: { status: success ? 'PAID' : 'PAYMENT_FAILED', redemptionState: success ? 'SETTLED' : 'RELEASED', paidAt: success ? now : null } });
        const rows = [effect(account, success ? 'SETTLE' : 'RELEASE', 50, { orderId: f.order, paymentId: payment.id, cycle: order.reservationCycle })];
        if (success) {
            await tx.loyaltyAward.create({ data: { userId: f.user, orderId: f.order, points: 8 } });
            rows.push(effect(account, 'EARN', 8, { orderId: f.order, paymentId: payment.id }));
        }
        else
            await tx.product.update({ where: { id: f.product }, data: { stock: { increment: 1 }, version: { increment: 1 } } });
        await persistEffects(tx, before, account, rows);
        return payment;
    });
}
const auth = (f: Fixture) => 'Bearer ' + jwt.sign({ sub: f.user });
const initiate = (f: Fixture, key: string = randomUUID()) => request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', auth(f)).set('Idempotency-Key', key).send({ orderId: f.order });
const get = (f: Fixture, id: string) => request(app.getHttpServer()).get('/payments/attempts/' + id).set('Authorization', auth(f));
const cancel = (f: Fixture) => request(app.getHttpServer()).post('/orders/' + f.order + '/cancel').set('Authorization', auth(f)).send({});
const list = (f: Fixture, q = '') => request(app.getHttpServer()).get('/orders/' + f.order + '/payment-attempts' + q).set('Authorization', auth(f));
type ResponseBody = {
    attemptId: string;
    paymentUrl: string;
    expiresAt: string;
};
test('verified success stays SUCCEEDED after legitimate paid cancellation; no fabricated refund', async () => {
    const f = await started(); await close(f, f.attempt, true);
    expect((await get(f, f.attempt).expect(200)).body).toMatchObject({ effectiveState: 'SUCCEEDED', orderStatus: 'PAID', canRetry: false });
    const order = await db.order.findUniqueOrThrow({ where: { id: f.order } });
    await app.get(OrderService).transitionOrder(f.order, order.version, 'CANCELLED');
    expect((await get(f, f.attempt).expect(200)).body).toMatchObject({ effectiveState: 'SUCCEEDED', orderStatus: 'CANCELLED', requiresReview: false, cashRefundStatus: 'NOT_PROCESSED_BY_BREWLITE' });
});
test('verified success awaiting REVIEW never appears failed or grants retry', async () => {
    const f = await started(), now = new Date();
    await db.paymentVerification.create({ data: { attemptId: f.attempt, source: 'IPN', state: 'VERIFIED', payload: { responseCode: '00', transactionStatus: '00' }, payloadHash: 'a'.repeat(64), verifiedAt: now } });
    await db.paymentAttempt.update({ where: { id: f.attempt }, data: { state: 'SUCCEEDED', applicationState: 'REVIEW', verifiedAt: now, reviewReason: 'SYNTHETIC' } });
    expect((await get(f, f.attempt).expect(200)).body).toMatchObject({ effectiveState: 'REVIEW', messageCode: 'PAYMENT_RECEIVED_REVIEW', canRetry: false, canResume: false, canCancel: false });
    expect(await db.payment.count({ where: { orderId: f.order } })).toBe(0);
    expect(await db.loyaltyAward.count({ where: { orderId: f.order } })).toBe(0);
});
async function started() { const f = await fixture(); const r = await initiate(f).expect(201); return { ...f, attempt: (r.body as ResponseBody).attemptId }; }
async function failed() { const f = await started(); await close(f, f.attempt, false); return f; }
async function snapshot(f: Fixture) { return { cart: await db.cartItem.findMany({ where: { cart: { userId: f.user } }, orderBy: { id: 'asc' } }), order: await db.order.findUniqueOrThrow({ where: { id: f.order } }), user: await db.user.findUniqueOrThrow({ where: { id: f.user } }), product: await db.product.findUniqueOrThrow({ where: { id: f.product } }), entries: await db.loyaltyEntry.findMany({ where: { userId: f.user }, orderBy: { sequence: 'asc' } }), claims: await db.idempotencyRequest.findMany({ where: { userId: f.user }, orderBy: { id: 'asc' } }), attempts: await db.paymentAttempt.findMany({ where: { orderId: f.order }, orderBy: { id: 'asc' } }), payments: await db.payment.findMany({ where: { orderId: f.order } }), awards: await db.loyaltyAward.findMany({ where: { orderId: f.order } }) }; }
test('durable initial attempt, server amount, signature and no financial mutation/reservation duplicate', async () => {
    const f = await fixture(), before = await snapshot(f);
    const r = await initiate(f).expect(201);
    const body = r.body as ResponseBody;
    expect(r.body).toMatchObject({ orderId: f.order, provider: 'VNPAY_SANDBOX', amount: '85000', currency: 'VND', state: 'AWAITING' });
    const u = new URL(body.paymentUrl), sig = u.searchParams.get('vnp_SecureHash');
    u.searchParams.delete('vnp_SecureHash');
    expect(sig).toBe(createHmac('sha512', secret).update(u.search.slice(1)).digest('hex'));
    expect(u.origin + u.pathname).toBe(SANDBOX_PAYMENT_URL);
    expect(u.searchParams.get('vnp_Amount')).toBe('8500000');
    expect(u.searchParams.get('vnp_BankCode')).toBeNull();
    expect(u.searchParams.get('vnp_TxnRef')).toMatch(/^[a-f0-9]{32}$/);
    const after = await snapshot(f);
    expect(after.order).toEqual(before.order);
    expect(after.user).toEqual(before.user);
    expect(after.entries).toEqual(before.entries);
    expect(after.product).toEqual(before.product);
    expect(after.cart).toEqual(before.cart);
    expect(after.payments).toHaveLength(0);
    expect(after.awards).toHaveLength(0);
    expect(after.claims[0]).toMatchObject({ state: 'COMPLETED', orderId: f.order, responseStatus: 201, responseBody: r.body as unknown });
    expect(after.attempts).toHaveLength(1);
    expect(JSON.stringify(after.attempts[0].requestParameters)).not.toContain('SecureHash');
    expect(r.headers['cache-control']).toContain('no-store');
});
test('exact replay even after expiry; no second attempt and no automatic new URL', async () => {
    const f = await fixture(), key = randomUUID(), r = await initiate(f, key).expect(201), a = (r.body as ResponseBody).attemptId;
    jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    jest.setSystemTime(Date.now() + 3600000);
    const before = await snapshot(f);
    const replay = await initiate(f, key).expect(201);
    expect(replay.body).toEqual(r.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(await snapshot(f)).toEqual(before);
    const status = await get(f, a).expect(200);
    expect(status.body).toMatchObject({ effectiveState: 'UNKNOWN', canRetry: false, canResume: false, canCancel: false, orderStatus: 'PENDING' });
    await cancel(f).expect(409);
    await initiate(f).expect(409);
});
test('same key different order conflicts without extra attempt', async () => { const f = await started(); await close(f, f.attempt, false); await cancel(f).expect(200); const second = await db.order.create({ data: { userId: f.user, orderCode: randomUUID(), status: 'PENDING', subtotal: 1000, total: 1000 } }); const claim = await db.idempotencyRequest.findFirstOrThrow({ where: { orderId: f.order, operation: 'PAY_ORDER' } }); await initiate({ ...f, order: second.id }, claim.idempotencyKey).expect(409); expect(await db.paymentAttempt.count({ where: { orderId: second.id } })).toBe(0); });
test('same key different Mock action conflicts; historical namespace preserved', async () => { const f = await fixture(), key = randomUUID(); await syntheticAttempt(db, f, key); await initiate(f, key).expect(409); });
test('concurrent same-key requests converge to exact committed response, single reservation', async () => { const f = await fixture(), key = randomUUID(); const rs = await Promise.all([initiate(f, key), initiate(f, key), initiate(f, key)]); expect(rs.every(r => [201, 409].includes(r.status))).toBe(true); const committed = rs.find(r => r.status === 201); expect(committed).toBeDefined(); expect((await initiate(f, key).expect(201)).body).toEqual(committed!.body); expect(await db.paymentAttempt.count({ where: { orderId: f.order } })).toBe(1); expect(await db.loyaltyEntry.count({ where: { orderId: f.order, kind: 'RESERVE' } })).toBe(1); });
test('different-key race leaves one pending attempt and distinct refs for different orders', async () => { const f = await fixture(), g = await fixture(); const rs = await Promise.all([initiate(f), initiate(f)]); expect(rs.filter(r => r.status === 201)).toHaveLength(1); expect(rs.filter(r => r.status === 409)).toHaveLength(1); await initiate(g).expect(201); const a = await db.paymentAttempt.findMany({ where: { orderId: { in: [f.order, g.order] } } }); expect(new Set(a.map(x => x.txnRef)).size).toBe(2); });
test('verified APPLIED failure retry atomically uses FIX01 attempt attribution and cycle2; exact replay', async () => { const f = await failed(); await db.product.update({ where: { id: f.product }, data: { price: '999999' } }); const before = await snapshot(f), key = randomUUID(); const r = await initiate(f, key).expect(201); const after = await snapshot(f); expect(after.order).toMatchObject({ status: 'PENDING', reservationCycle: 2, redemptionState: 'RESERVED' }); expect(after.order.total.toFixed(0)).toBe('85000'); expect(after.product.stock).toBe(before.product.stock - 1); expect(after.user.loyaltyPoints).toBe(50); expect(after.payments).toEqual(before.payments); expect(after.awards).toEqual(before.awards); expect(after.entries.at(-1)).toMatchObject({ kind: 'RESERVE', cycle: 2, paymentId: null, paymentAttemptId: (r.body as ResponseBody).attemptId }); expect(after.entries.slice(0, -1)).toEqual(before.entries); expect((await initiate(f, key).expect(201)).body).toEqual(r.body); expect(await snapshot(f)).toEqual(after); });
test('concurrent retry/cancellation serializes without resource loss', async () => { const f = await failed(); const rs = await Promise.all([initiate(f), cancel(f)]); expect(rs.map(r => r.status).sort()).toEqual(expect.arrayContaining([409])); const o = await db.order.findUniqueOrThrow({ where: { id: f.order } }); const reserves = await db.loyaltyEntry.count({ where: { orderId: f.order, kind: 'RESERVE', cycle: 2 } }); expect(reserves).toBe(o.status === 'PENDING' ? 1 : 0); expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(o.status === 'PENDING' ? 9 : 10); });
test('concurrent verified retries do not double reserve', async () => { const f = await failed(); const rs = await Promise.all([initiate(f), initiate(f)]); expect(rs.filter(r => r.status === 201)).toHaveLength(1); expect(await db.loyaltyEntry.count({ where: { orderId: f.order, cycle: 2, kind: 'RESERVE' } })).toBe(1); });
test('insufficient stock rolls back claim, attempt, cycle, journal and balances', async () => { const f = await failed(); await db.product.update({ where: { id: f.product }, data: { stock: 0 } }); const before = await snapshot(f); await initiate(f).expect(409); expect(await snapshot(f)).toEqual(before); });
async function reverseLegacy(f: Fixture, points: number) { const o = await db.order.create({ data: { userId: f.user, orderCode: randomUUID(), status: 'PAID', paidAt: new Date(), subtotal: points * 10000, total: points * 10000 } }); await db.loyaltyAward.create({ data: { orderId: o.id, userId: f.user, points, createdAt: new Date('2020-01-01') } }); await app.get(OrderService).transitionOrder(o.id, o.version, 'CANCELLED'); }
test('insufficient points after legitimate legacy reversal rejects retry without mutation', async () => { const f = await failed(); await reverseLegacy(f, 100); const before = await snapshot(f); const r = await initiate(f).expect(409); expect(r.body).toMatchObject({ error: { code: 'LOYALTY_INSUFFICIENT_POINTS' } }); expect(await snapshot(f)).toEqual(before); });
test('outstanding debt after legitimate legacy reversal rejects retry without mutation', async () => { const f = await failed(); await reverseLegacy(f, 150); const before = await snapshot(f); expect(before.user.loyaltyDebt).toBe(50n); const r = await initiate(f).expect(409); expect(r.body).toMatchObject({ error: { code: 'LOYALTY_REVERSAL_OUTSTANDING' } }); expect(await snapshot(f)).toEqual(before); });
test.each(['UNKNOWN', 'REVIEW'] as const)('%s blocks initiation, cancellation and false capabilities', async (state) => { const f = await started(); await db.paymentAttempt.update({ where: { id: f.attempt }, data: state === 'REVIEW' ? { applicationState: 'REVIEW', reviewReason: 'SYNTHETIC' } : { state } }); const before = await snapshot(f); await initiate(f).expect(409); await cancel(f).expect(409); const r = await get(f, f.attempt).expect(200); expect(r.body).toMatchObject({ effectiveState: state, canRetry: false, canCancel: false, canResume: false }); expect(await snapshot(f)).toEqual(before); });
test('unprocessed VERIFIED receipt blocks retry and cancellation', async () => { const f = await failed(); await db.paymentVerification.create({ data: { attemptId: f.attempt, source: 'IPN', state: 'VERIFIED', payload: { responseCode: '24', transactionStatus: '02' }, payloadHash: 'b'.repeat(64), verifiedAt: new Date() } }); await initiate(f).expect(409); await cancel(f).expect(409); expect((await get(f, f.attempt)).body).toMatchObject({ canRetry: false, canCancel: false }); });
test.each(['PAID', 'CANCELLED'] as const)('%s order cannot initiate', async (status) => { const f = await fixture(); if (status === 'CANCELLED')
    await cancel(f).expect(200);
else {
    const a = await syntheticAttempt(db, f);
    await close(f, a.id, true);
} const before = await db.paymentAttempt.count({ where: { orderId: f.order } }); await initiate(f).expect(409); expect(await db.paymentAttempt.count({ where: { orderId: f.order } })).toBe(before); });
test('legacy Mock failure cannot cross-provider retry', async () => { const f = await fixture(); settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); const mock = app.get(MockPaymentService); jest.spyOn(mock, 'result').mockReturnValueOnce('FAILURE'); await request(app.getHttpServer()).post('/payments').set('Authorization', auth(f)).set('Idempotency-Key', randomUUID()).send({ orderId: f.order, method: 'WALLET' }).expect(200); settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'); const before = await snapshot(f); await initiate(f).expect(409); expect(await snapshot(f)).toEqual(before); });
test('feature gate OFF denies initiation without attempt; Mock continues unchanged', async () => { const f = await fixture(); settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); await initiate(f).expect(503); expect(await db.paymentAttempt.count({ where: { orderId: f.order } })).toBe(0); await request(app.getHttpServer()).post('/payments').set('Authorization', auth(f)).set('Idempotency-Key', randomUUID()).send({ orderId: f.order, method: 'WALLET' }).expect(200); expect((await db.payment.findFirstOrThrow({ where: { orderId: f.order } })).provider).toBe('MOCK'); });
test('Mock route cannot bypass VNPAY mode or unresolved gateway attempts', async () => { const f = await started(); const pay = () => request(app.getHttpServer()).post('/payments').set('Authorization', auth(f)).set('Idempotency-Key', randomUUID()).send({ orderId: f.order, method: 'WALLET' }); await pay().expect(403); settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); await pay().expect(409); expect(await db.payment.count({ where: { orderId: f.order } })).toBe(0); });
test('JWT required and roles are taken from database', async () => { const f = await fixture(); await request(app.getHttpServer()).post('/payments/vnpay/attempts').send({ orderId: f.order }).expect(401); await db.user.update({ where: { id: f.user }, data: { role: 'STAFF' } }); await initiate(f).expect(403); await list(f).expect(403); await get(f, randomUUID()).expect(403); });
test('unknown/cross-owner attempts and orders return404 without sensitive data', async () => { const f = await started(), g = await fixture(); await get(g, f.attempt).expect(404); await get(f, randomUUID()).expect(404); await list({ ...g, order: f.order }).expect(404); await initiate({ ...g, order: f.order }).expect(404); });
test.each([{ orderId: 'bad' }, {}, { orderId: randomUUID(), amount: 1 }, { orderId: randomUUID(), merchant: 'x' }, { orderId: randomUUID(), outcome: 'SUCCEEDED' }])('strict request rejects invalid/extra fields %j', async (body) => { const f = await fixture(); await request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', auth(f)).set('Idempotency-Key', randomUUID()).send(body).expect(400); });
test('missing idempotency key rejects without mutation', async () => { const f = await fixture(); await request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', auth(f)).send({ orderId: f.order }).expect(400); });
test('status/list sanitized, deterministic bounded pages and owner/order bound cursors', async () => { const f = await failed(); await initiate(f).expect(201); const r = await list(f, '?limit=1').expect(200); const body = r.body as {
    current: {
        effectiveState: string;
    };
    items: {
        attemptId: string;
    }[];
    nextCursor: string;
}; expect(body.current.effectiveState).toBe('AWAITING'); expect(body.items).toHaveLength(1); expect(body.nextCursor).toBeTruthy(); const next = await list(f, '?limit=1&cursor=' + body.nextCursor).expect(200); expect((next.body as {
    items: {
        attemptId: string;
    }[];
}).items[0].attemptId).toBe(f.attempt); expect((await list(f, '?limit=1')).body).toMatchObject({ items: body.items }); const text = JSON.stringify(r.body); for (const forbidden of ['paymentUrl', 'vnp_', 'merchantCode', 'payload', 'requestParameters', 'idempotency', 'SecureHash', secret])
    expect(text).not.toContain(forbidden); const g = await fixture(); await list(g, '?cursor=' + body.nextCursor).expect(400); await list(f, '?cursor=' + body.nextCursor.slice(0, -3) + 'AAA').expect(400); await list(f, '?limit=21').expect(400); await list(f, '?limit=0').expect(400); await list(f, '?provider=MOCK').expect(400); });
test('zero total cannot issue gateway attempt', async () => { const f = await fixture(); await db.order.update({ where: { id: f.order }, data: { total: 0, subtotal: 5000 } }); await initiate(f).expect(422); expect(await db.paymentAttempt.count({ where: { orderId: f.order } })).toBe(0); });
test('technical failure after stock reacquisition rolls back all new financial state', async () => { const f = await failed(); const before = await snapshot(f); await client.query(`CREATE FUNCTION b2a_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id='${f.order}'::uuid AND NEW.cycle=2 THEN RAISE EXCEPTION 'SYNTHETIC_TECHNICAL_FAILURE'; END IF; RETURN NEW; END $$`); await client.query('CREATE TRIGGER b2a_fail BEFORE INSERT ON loyalty_entries FOR EACH ROW EXECUTE FUNCTION b2a_fail()'); try {
    await initiate(f).expect(503);
    expect(await snapshot(f)).toEqual(before);
}
finally {
    await client.query('DROP TRIGGER b2a_fail ON loyalty_entries');
    await client.query('DROP FUNCTION b2a_fail()');
} });
test('zero-point gateway pending still blocks customer cancellation and does not acquire Loyalty', async () => { const f = await fixture(0); const r = await initiate(f).expect(201); expect(r.body).toMatchObject({ amount: '90000' }); expect(await db.loyaltyEntry.count({ where: { orderId: f.order } })).toBe(0); await cancel(f).expect(409); expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(9); });
test('oversized immutable amount rejected rather than rounded/repriced', async () => { const f = await fixture(); await db.order.update({ where: { id: f.order }, data: { subtotal: '10000005000', total: '10000000000' } }); const before = await snapshot(f); await initiate(f).expect(422); expect(await snapshot(f)).toEqual(before); });
test('status change committed under owner lock is reread before pending action', async () => { const f = await started(); const blocker = new Client({ connectionString: url.toString() }); await blocker.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.user]); const response = initiate(f).then(r => r); try {
    await new Promise(resolve => setTimeout(resolve, 40));
    await blocker.query("UPDATE payment_attempts SET application_state='REVIEW',review_reason='SYNTHETIC' WHERE id=$1", [f.attempt]);
    await blocker.query('COMMIT');
    expect((await response).status).toBe(409);
    expect(await db.paymentAttempt.count({ where: { orderId: f.order } })).toBe(1);
}
finally {
    await blocker.query('ROLLBACK');
    await blocker.end();
} });
