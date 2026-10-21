import { OrderService } from '../../src/orders/order.service';
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
import { signParameters, canonicalize } from '../../src/payments/vnpay/vnpay-signing';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../../src/generated/prisma/client';
import { utcConnectionString } from '../../src/database/pg-connection';
import { lockUser } from '../../src/orders/order-policy';
import { effect, persistEffects, reconcileAccount } from '../../src/loyalty/loyalty-accounting';
// Synthetic signed callbacks exercise real T1/T2 only in an isolated database.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !/^\/brewlite_b2a_[a-f0-9]{12}_test$/.test(new URL(connectionString).pathname))
    throw Error('B2A isolated database required');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname))
    throw Error('Local isolated database required');
const schema = `b2b_${randomUUID().replaceAll('-', '')}`;
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
afterAll(async () => {
    if (app)
        await app.close();
    await db.$disconnect();
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
});
async function fixture(points = 50, balance = 100) {
    return txWork(async (tx) => {
        const user = await tx.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'NON_LOGIN_SYNTHETIC', loyaltyPoints: balance } });
        await tx.loyaltyEntry.create({ data: { userId: user.id, kind: 'OPENING', points: balance, availableDelta: balance, reservedDelta: 0, debtDelta: 0n, effectKey: `OPENING:${user.id}` } });
        const product = await tx.product.create({ data: { name: 'FIX01 isolated fixture', price: '100000', imageUrl: '/fixture', stock: 9, sizes: { create: { size: 'S', extraPrice: '0' } } } });
        const cart = await tx.cart.create({ data: { userId: user.id } });
        await tx.cartItem.create({ data: { cartId: cart.id, productId: product.id, size: 'S', qty: 1, configurationKey: `${product.id}:S` } });
        const promotion = await tx.promotion.upsert({ where: { code: 'BREW10K' }, create: { code: 'BREW10K', discountAmount: '10000', startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01'), isActive: true }, update: {} });
        const order = await tx.order.create({ data: { userId: user.id, orderCode: randomUUID(), status: 'PENDING', promotionId: promotion.id, promotionCodeSnapshot: 'BREW10K', discountAmount: '10000', subtotal: '100000', total: String(90000 - points * 100), redeemedPoints: points, loyaltyDiscountAmount: String(points * 100), redemptionState: points ? 'RESERVED' : 'NONE', reservationCycle: points ? 1 : 0 } });
        await tx.orderItem.create({ data: { orderId: order.id, productId: product.id, productNameSnapshot: product.name, size: 'S', basePrice: '100000', sizeExtraPrice: '0', unitPrice: '100000', qty: 1, lineTotal: '100000' } });
        const before = { userId: user.id, available: BigInt(balance), reserved: 0n, debt: 0n }, account = { ...before };
        if (points)
            await persistEffects(tx, before, account, [effect(account, 'RESERVE', points, { orderId: order.id, cycle: 1 })]);
        const f = { user: user.id, order: order.id, product: product.id };
        return f;
    });
}
const auth = (f: Fixture) => 'Bearer ' + jwt.sign({ sub: f.user });
const initiate = (f: Fixture, key: string = randomUUID()) => request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', auth(f)).set('Idempotency-Key', key).send({ orderId: f.order });
const cancel = (f: Fixture) => request(app.getHttpServer()).post('/orders/' + f.order + '/cancel').set('Authorization', auth(f)).send({});
const status = (f: Fixture, id: string) => request(app.getHttpServer()).get('/payments/attempts/' + id).set('Authorization', auth(f));
async function started(points = 50, balance = 100) { const f = await fixture(points, balance); const r = await initiate(f).expect(201); return { ...f, attempt: (r.body as {
        attemptId: string;
    }).attemptId }; }
async function fields(f: Fixture, code = '00', state = '00', number = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)))) { const a = await db.paymentAttempt.findFirstOrThrow({ where: { orderId: f.order }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }); return { vnp_TmnCode: 'TEST0001', vnp_TxnRef: a.txnRef, vnp_Amount: a.amount.times(100).toFixed(0), vnp_BankCode: 'NCB', vnp_OrderInfo: 'Thanh toan BrewLite ' + a.txnRef, vnp_ResponseCode: code, vnp_TransactionStatus: state, vnp_TransactionNo: number, vnp_PayDate: '20261017100000' }; }
const signed = (p: Record<string, string>) => canonicalize(p) + '&vnp_SecureHash=' + signParameters(p, secret);
const ipn = (raw: string) => request(app.getHttpServer()).get('/payments/vnpay/ipn?' + raw);
async function notify(f: Fixture, code = '00', state = '00', number?: string) { return ipn(signed(await fields(f, code, state, number))).expect(200); }
async function proof(f: Fixture) { return txWork(async (tx) => { await lockUser(tx, f.user); return reconcileAccount(tx, f.user); }); }
async function snapshot(f: Fixture) { return { user: await db.user.findUniqueOrThrow({ where: { id: f.user } }), order: await db.order.findUniqueOrThrow({ where: { id: f.order }, include: { items: { include: { toppings: true } } } }), products: await db.product.findMany({ where: { id: f.product } }), payments: await db.payment.findMany({ where: { userId: f.user }, orderBy: { id: 'asc' } }), awards: await db.loyaltyAward.findMany({ where: { userId: f.user } }), journal: await db.loyaltyEntry.findMany({ where: { userId: f.user }, orderBy: { sequence: 'asc' } }), cart: await db.cart.findUnique({ where: { userId: f.user }, include: { items: true } }), claims: await db.idempotencyRequest.findMany({ where: { userId: f.user }, orderBy: { id: 'asc' } }) }; }
function ack(r: {
    body: unknown;
}, code: string) { expect(r.body).toEqual({ RspCode: code, Message: expect.any(String) as unknown }); }
async function reverseLegacy(f: Fixture, points: number) { const o = await db.order.create({ data: { userId: f.user, orderCode: randomUUID(), status: 'PAID', paidAt: new Date(), subtotal: points * 10000, total: points * 10000 } }); await db.loyaltyAward.create({ data: { orderId: o.id, userId: f.user, points, createdAt: new Date('2020-01-01') } }); await app.get(OrderService).transitionOrder(o.id, o.version, 'CANCELLED'); }
test('85000 success: T1/T2, Payment/Award8, journal conservation, Cart clear, no second stock debit', async () => {
    const f = await started(), before = await snapshot(f), r = await notify(f);
    ack(r, '00');
    const after = await snapshot(f);
    expect(after.order).toMatchObject({ status: 'PAID', redemptionState: 'SETTLED', reservationCycle: 1, promotionCodeSnapshot: 'BREW10K' });
    expect(after.order.total.toFixed(0)).toBe('85000');
    expect(after.order.items).toEqual(before.order.items);
    expect(after.products).toEqual(before.products);
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ provider: 'VNPAY_SANDBOX', method: 'VNPAY', status: 'SUCCEEDED', gatewayAttemptId: f.attempt, idempotencyRequestId: before.claims[0].id });
    expect(after.awards).toHaveLength(1);
    expect(after.awards[0].points).toBe(8);
    expect(after.journal.slice(1).map(x => x.kind)).toEqual(['RESERVE', 'SETTLE', 'EARN']);
    expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n, debt: 0n });
    expect(after.cart!.items).toHaveLength(0);
    expect(after.claims).toEqual(before.claims);
    const a = await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } });
    expect(a).toMatchObject({ state: 'SUCCEEDED', applicationState: 'APPLIED', providerPaidAt: new Date('2026-10-17T03:00:00Z') });
    expect(a.appliedAt).toEqual(after.order.paidAt);
    expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: 'SUCCEEDED', canRetry: false });
});
test('terminal failure restores stock/releases once, keeps snapshots/Cart and earns nothing', async () => { const f = await started(), raw = signed(await fields(f, '24', '02', '0')), before = await snapshot(f); ack(await ipn(raw), '00'); const after = await snapshot(f); expect(after.order).toMatchObject({ status: 'PAYMENT_FAILED', redemptionState: 'RELEASED' }); expect(after.order.items).toEqual(before.order.items); expect(after.products[0].stock).toBe(10); expect(after.cart).toEqual(before.cart); expect(after.awards).toHaveLength(0); expect(after.payments[0]).toMatchObject({ status: 'FAILED', failureCode: 'VNPAY_DECLINED' }); expect(await proof(f)).toMatchObject({ available: 100n, reserved: 0n, debt: 0n }); ack(await ipn(raw), '02'); expect(await snapshot(f)).toEqual(after); expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).transactionNo).toBeNull(); });
test('valid signature/merchant but unknown reference01, mismatch amount04; no receipt or finances', async () => { const f = await started(), p = await fields(f), before = await snapshot(f); ack(await ipn(signed({ ...p, vnp_TxnRef: randomUUID().replaceAll('-', '') })), '01'); ack(await ipn(signed({ ...p, vnp_Amount: '8500001' })), '04'); expect(await db.paymentVerification.count({ where: { attemptId: f.attempt } })).toBe(0); expect(await snapshot(f)).toEqual(before); });
test.each(['signature', 'merchant', 'unsupported', 'number', 'duplicate', 'encoding', 'utf8', 'nested', 'oversized', 'missing'])('rejects %s before durable writes', async (kind) => { const f = await started(), p = await fields(f), before = await snapshot(f); let raw = signed(p), code = '99'; switch (kind) {
    case 'signature':
        raw = canonicalize(p) + '&vnp_SecureHash=' + 'f'.repeat(128);
        code = '97';
        break;
    case 'merchant':
        raw = signed({ ...p, vnp_TmnCode: 'BAD00001' });
        code = '97';
        break;
    case 'unsupported':
        raw = signed({ ...p, vnp_Unexpected: 'x' });
        break;
    case 'number':
        raw = signed({ ...p, vnp_TransactionNo: 'NaN' });
        break;
    case 'duplicate':
        raw += '&%76np_Amount=8500000';
        break;
    case 'encoding':
        raw += '&vnp_CardType=%GG';
        break;
    case 'utf8':
        raw += '&vnp_CardType=%C0%AF';
        break;
    case 'nested':
        raw += '&vnp_CardType[]=ATM';
        break;
    case 'oversized':
        raw += '&vnp_CardType=' + 'x'.repeat(8192);
        break;
    case 'missing':
        raw = canonicalize(p);
        code = '97';
        break;
} ack(await ipn(raw), code); expect(await snapshot(f)).toEqual(before); expect(await db.paymentVerification.count({ where: { attemptId: f.attempt } })).toBe(0); });
test('body/JSON override rejected with provider ACK99, not JWT or generic envelope', async () => { const f = await started(), raw = signed(await fields(f)); const r = await ipn(raw).send({ status: 'SUCCEEDED' }).expect(200); ack(r, '99'); expect(r.headers['cache-control']).toBe('no-store'); expect(await db.paymentVerification.count({ where: { attemptId: f.attempt } })).toBe(0); });
test('default MOCK gate denies even authentic callback without touching financial data', async () => { const f = await started(), before = await snapshot(f); settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); ack(await notify(f), '99'); expect(await snapshot(f)).toEqual(before); expect(await db.paymentVerification.count({ where: { attemptId: f.attempt } })).toBe(0); });
test.each([['00', '02'], ['24', '00'], ['07', '00'], ['00', '04'], ['99', '02']])('contradictory/unsupported %s/%s yields durable REVIEW, no effects', async (code, state) => { const f = await started(), before = await snapshot(f); ack(await notify(f, code, state), '00'); expect(await snapshot(f)).toEqual(before); expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).applicationState).toBe('REVIEW'); expect((await db.paymentVerification.findFirstOrThrow({ where: { attemptId: f.attempt } })).processedAt).not.toBeNull(); });
test('UNKNOWN holds stock/points, durable unprocessed receipt and99; later success consumes both', async () => { const f = await started(), before = await snapshot(f), raw = signed(await fields(f, '00', '01', '0')); ack(await ipn(raw), '99'); ack(await ipn(raw), '99'); expect(await snapshot(f)).toEqual(before); expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).state).toBe('UNKNOWN'); expect((await db.paymentVerification.findFirstOrThrow({ where: { attemptId: f.attempt } })).processedAt).toBeNull(); await cancel(f).expect(409); await initiate(f).expect(409); ack(await notify(f), '00'); expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n }); expect(await db.paymentVerification.count({ where: { attemptId: f.attempt, processedAt: null } })).toBe(0); });
test('duplicate/concurrent identical callbacks and lost ACK never double effects', async () => { const f = await started(), raw = signed(await fields(f)); const rs = await Promise.all([ipn(raw), ipn(raw), ipn(raw)]); expect(rs.every(r => ['00', '02', '99'].includes((r.body as {
    RspCode: string;
}).RspCode))).toBe(true); const after = await snapshot(f); ack(await ipn(raw), '02'); expect(await snapshot(f)).toEqual(after); expect(after.payments).toHaveLength(1); expect(after.awards).toHaveLength(1); expect(await db.paymentVerification.count({ where: { attemptId: f.attempt } })).toBe(1); expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n }); });
test('compatible evidence with different auxiliary field is consumed without repeated Cart/journal effects', async () => { const f = await started(), p = await fields(f); ack(await ipn(signed(p)), '00'); const after = await snapshot(f); ack(await ipn(signed({ ...p, vnp_BankTranNo: 'SYNTHETIC123' })), '02'); expect(await snapshot(f)).toEqual(after); const rows = await db.paymentVerification.findMany({ where: { attemptId: f.attempt } }); expect(rows).toHaveLength(2); expect(rows.every(x => x.processedAt)).toBe(true); expect(JSON.stringify(rows)).not.toContain('BankTranNo'); });
test('failure after success becomes REVIEW without downgrade/restock/reverse', async () => { const f = await started(); ack(await notify(f), '00'); const after = await snapshot(f); ack(await notify(f, '24', '02', '0'), '00'); expect(await snapshot(f)).toEqual(after); expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: 'REVIEW', messageCode: 'PAYMENT_RECEIVED_REVIEW' }); });
test('success after applied failure and new retry holds resources on both attempts', async () => { const f = await started(); ack(await notify(f, '24', '02', '0'), '00'); const oldRef = (await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).txnRef; const r = await initiate(f).expect(201), next = (r.body as {
    attemptId: string;
}).attemptId; const before = await snapshot(f); const current = await fields(f); ack(await ipn(signed({ ...current, vnp_TxnRef: oldRef, vnp_OrderInfo: 'Thanh toan BrewLite ' + oldRef })), '00'); expect(await snapshot(f)).toEqual(before); await initiate(f).expect(409); await cancel(f).expect(409); expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: 'REVIEW', messageCode: 'PAYMENT_RECEIVED_REVIEW' }); ack(await notify(f, '24', '02', '0'), '00'); expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: next } })).applicationState).toBe('REVIEW'); expect(await snapshot(f)).toEqual(before); });
test('provider transaction reused by another owner is REVIEW with retained receipt, no second payment', async () => { const f = await started(), g = await started(), number = '123456789'; ack(await notify(f, '00', '00', number), '00'); const before = await snapshot(g); ack(await notify(g, '00', '00', number), '00'); expect(await snapshot(g)).toEqual(before); const a = await db.paymentAttempt.findUniqueOrThrow({ where: { id: g.attempt } }); expect(a).toMatchObject({ applicationState: 'REVIEW', reviewReason: 'PROVIDER_TRANSACTION_REUSED', transactionNo: null }); expect(await db.paymentVerification.count({ where: { attemptId: g.attempt, processedAt: { not: null } } })).toBe(1); });
test('concurrent transaction-number collision settles at most one owner, retry leaves the other REVIEW', async () => { const f = await started(), g = await started(), number = '987654321'; const raw = [signed(await fields(f, '00', '00', number)), signed(await fields(g, '00', '00', number))]; await Promise.all(raw.map(ipn)); for (const r of raw)
    await ipn(r); const rows = await db.paymentAttempt.findMany({ where: { id: { in: [f.attempt, g.attempt] } } }); expect(rows.filter(x => x.applicationState === 'APPLIED').length).toBeLessThanOrEqual(1); expect(rows.filter(x => x.applicationState === 'REVIEW').length).toBeGreaterThanOrEqual(1); expect(await db.payment.count({ where: { orderId: { in: [f.order, g.order] } } })).toBeLessThanOrEqual(1); });
test('verified failure RELEASE pays down later debt; success instead requires durable REVIEW', async () => { for (const success of [false, true]) {
    const f = await started();
    await reverseLegacy(f, 100);
    expect(await proof(f)).toMatchObject({ available: 0n, reserved: 50n, debt: 50n });
    const before = await snapshot(f);
    ack(await notify(f, success ? '00' : '24', success ? '00' : '02', success ? '1001' : '0'), '00');
    if (success) {
        expect(await snapshot(f)).toEqual(before);
        expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).applicationState).toBe('REVIEW');
    }
    else {
        expect(await proof(f)).toMatchObject({ available: 0n, reserved: 0n, debt: 0n });
        const e = await db.loyaltyEntry.findFirstOrThrow({ where: { orderId: f.order, kind: 'RELEASE' } });
        expect(e).toMatchObject({ availableDelta: 0, reservedDelta: -50, debtDelta: -50n });
    }
} });
test('FIX01 verified failure retry cycle2 settles/releases exact source and no double reservation', async () => { for (const success of [false, true]) {
    const f = await started();
    ack(await notify(f, '24', '02', '0'), '00');
    const r = await initiate(f).expect(201), id = (r.body as {
        attemptId: string;
    }).attemptId;
    const reserve = await db.loyaltyEntry.findFirstOrThrow({ where: { orderId: f.order, kind: 'RESERVE', cycle: 2 } });
    expect(reserve).toMatchObject({ paymentId: null, paymentAttemptId: id });
    const raw = signed(await fields(f, success ? '00' : '24', success ? '00' : '02', success ? '1002' : '0'));
    ack(await ipn(raw), '00');
    const before = await snapshot(f);
    ack(await ipn(raw), '02');
    expect(await snapshot(f)).toEqual(before);
    expect(await db.loyaltyEntry.count({ where: { orderId: f.order, cycle: 2, kind: success ? 'SETTLE' : 'RELEASE' } })).toBe(1);
    expect(await proof(f)).toMatchObject({ available: success ? 58n : 100n, reserved: 0n, debt: 0n });
} });
test('missing Cart is durable REVIEW, receipt retained and no partial paid state', async () => { const f = await started(); await db.cartItem.deleteMany({ where: { cart: { userId: f.user } } }); const before = await snapshot(f); ack(await notify(f), '00'); expect(await snapshot(f)).toEqual(before); expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).reviewReason).toBe('CART_INVARIANT'); });
test('paid cancellation after gateway success retains PaymentSUCCEEDED and exact financial reversal', async () => { const f = await started(), raw = signed(await fields(f)); ack(await ipn(raw), '00'); const o = await db.order.findUniqueOrThrow({ where: { id: f.order } }); await app.get(OrderService).transitionOrder(o.id, o.version, 'CANCELLED'); expect(await proof(f)).toMatchObject({ available: 100n, reserved: 0n, debt: 0n }); const after = await snapshot(f); ack(await ipn(raw), '02'); expect(await snapshot(f)).toEqual(after); expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: 'SUCCEEDED', orderStatus: 'CANCELLED' }); });
test('cancellation racing signed callback cannot release pending money', async () => { const f = await started(), raw = signed(await fields(f)); const [r, c] = await Promise.all([ipn(raw), cancel(f)]); expect(c.status).toBe(409); expect(['00', '99']).toContain((r.body as {
    RspCode: string;
}).RspCode); await ipn(raw); expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n }); expect(await db.payment.count({ where: { orderId: f.order } })).toBe(1); });
test('concurrent contradictory callbacks retain both evidence and do not double local effects', async () => { const f = await started(); await Promise.all([notify(f), notify(f, '24', '02', '0')]); const rows = await db.paymentVerification.findMany({ where: { attemptId: f.attempt } }); expect(rows).toHaveLength(2); expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).applicationState).toBe('REVIEW'); expect(await db.payment.count({ where: { orderId: f.order } })).toBeLessThanOrEqual(1); expect(await db.loyaltyAward.count({ where: { orderId: f.order } })).toBeLessThanOrEqual(1); await proof(f); });
test('late success after local expiry still settles without recreating reservations', async () => { const f = await started(); jest.useFakeTimers({ doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }); jest.setSystemTime(Date.now() + 3600000); ack(await notify(f), '00'); expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n }); });
test('T1 committed + forced T2 crash retains unprocessed evidence,99; replay recovers once', async () => { const f = await started(), raw = signed(await fields(f)), before = await snapshot(f); await client.query(`CREATE FUNCTION ipn_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.order_id='${f.order}'::uuid THEN RAISE EXCEPTION 'SYNTHETIC_TECHNICAL_FAILURE'; END IF; RETURN NEW; END $$`); await client.query('CREATE TRIGGER ipn_fault BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION ipn_fault()'); try {
    ack(await ipn(raw), '99');
    expect(await snapshot(f)).toEqual(before);
    const v = await db.paymentVerification.findFirstOrThrow({ where: { attemptId: f.attempt } });
    expect(v).toMatchObject({ state: 'VERIFIED', processedAt: null });
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).applicationState).toBe('PENDING');
}
finally {
    await client.query('DROP TRIGGER ipn_fault ON payments');
    await client.query('DROP FUNCTION ipn_fault()');
} ack(await ipn(raw), '00'); const after = await snapshot(f); ack(await ipn(raw), '02'); expect(await snapshot(f)).toEqual(after); });
test('review commit failure returns99, not false00; durable T1 recovers review on retry', async () => { const f = await started(); await db.cartItem.deleteMany({ where: { cart: { userId: f.user } } }); const raw = signed(await fields(f)); await client.query(`CREATE FUNCTION review_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${f.attempt}'::uuid AND NEW.application_state='REVIEW' THEN RAISE EXCEPTION 'SYNTHETIC_REVIEW_FAILURE'; END IF; RETURN NEW; END $$`); await client.query('CREATE TRIGGER review_fault BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION review_fault()'); try {
    ack(await ipn(raw), '99');
    expect((await db.paymentVerification.findFirstOrThrow({ where: { attemptId: f.attempt } })).processedAt).toBeNull();
}
finally {
    await client.query('DROP TRIGGER review_fault ON payment_attempts');
    await client.query('DROP FUNCTION review_fault()');
} ack(await ipn(raw), '00'); expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).applicationState).toBe('REVIEW'); });
test.each(['success-journal', 'failure-journal', 'award', 'cart', 'balance', 'stock', 'processed'])('fault at %s rolls back all T2 effects and recovers from durable T1', async (mode) => {
    const f = await started(), success = mode !== 'failure-journal' && mode !== 'stock', raw = signed(await fields(f, success ? '00' : '24', success ? '00' : '02', success ? undefined : '0')), before = await snapshot(f);
    const table = mode.includes('journal') ? 'loyalty_entries' : mode === 'award' ? 'loyalty_awards' : mode === 'cart' ? 'cart_items' : mode === 'balance' ? 'users' : mode === 'stock' ? 'products' : 'payment_verifications';
    const action = mode === 'cart' ? 'DELETE' : mode.includes('journal') || mode === 'award' ? 'INSERT' : 'UPDATE';
    const condition = mode === 'cart' ? `OLD.cart_id='${before.cart!.id}'::uuid` : mode === 'balance' ? `NEW.id='${f.user}'::uuid` : mode === 'stock' ? `NEW.id='${f.product}'::uuid` : mode === 'processed' ? `NEW.attempt_id='${f.attempt}'::uuid AND NEW.processed_at IS NOT NULL` : `NEW.order_id='${f.order}'::uuid`;
    await client.query(`CREATE FUNCTION step_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'SYNTHETIC_STEP_FAILURE'; END IF; ${action === 'DELETE' ? 'RETURN OLD;' : 'RETURN NEW;'} END $$`);
    await client.query(`CREATE TRIGGER step_fault BEFORE ${action} ON ${table} FOR EACH ROW EXECUTE FUNCTION step_fault()`);
    try {
        ack(await ipn(raw), '99');
        expect(await snapshot(f)).toEqual(before);
        expect((await db.paymentVerification.findFirstOrThrow({ where: { attemptId: f.attempt } })).processedAt).toBeNull();
        expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).applicationState).toBe('PENDING');
    }
    finally {
        await client.query(`DROP TRIGGER step_fault ON ${table}`);
        await client.query('DROP FUNCTION step_fault()');
    }
    ack(await ipn(raw), '00');
    const after = await snapshot(f);
    ack(await ipn(raw), '02');
    expect(await snapshot(f)).toEqual(after);
    await proof(f);
});
test('T1 insert failure leaves no receipt or financial effects; retry creates one receipt', async () => {
    const f = await started(), raw = signed(await fields(f)), before = await snapshot(f);
    await client.query(`CREATE FUNCTION t1_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_T1_FAILURE'; END $$`);
    await client.query('CREATE TRIGGER t1_fault BEFORE INSERT ON payment_verifications FOR EACH ROW EXECUTE FUNCTION t1_fault()');
    try {
        ack(await ipn(raw), '99');
        expect(await db.paymentVerification.count({ where: { attemptId: f.attempt } })).toBe(0);
        expect(await snapshot(f)).toEqual(before);
    }
    finally {
        await client.query('DROP TRIGGER t1_fault ON payment_verifications');
        await client.query('DROP FUNCTION t1_fault()');
    }
    ack(await ipn(raw), '00');
    expect(await db.paymentVerification.count({ where: { attemptId: f.attempt } })).toBe(1);
});
test('success arriving after failed Order cancellation stays REVIEW without reacquisition', async () => { const f = await started(); ack(await notify(f, '24', '02', '0'), '00'); await cancel(f).expect(200); const before = await snapshot(f); ack(await notify(f), '00'); expect(await snapshot(f)).toEqual(before); expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: 'REVIEW', orderStatus: 'CANCELLED', messageCode: 'PAYMENT_RECEIVED_REVIEW', canRetry: false }); });
test('retry racing duplicate failure callback reserves only cycle2 through FIX01', async () => { const f = await started(), raw = signed(await fields(f, '24', '02', '0')); ack(await ipn(raw), '00'); const [retry, repeat] = await Promise.all([initiate(f), ipn(raw)]); expect(retry.status).toBe(201); ack(repeat, '02'); expect(await proof(f)).toMatchObject({ available: 50n, reserved: 50n }); expect(await db.loyaltyEntry.count({ where: { orderId: f.order, kind: 'RESERVE', cycle: 2 } })).toBe(1); expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(9); });
test('cash-only success offsets debt without inventing redemption effects', async () => { const f = await started(0); await reverseLegacy(f, 150); expect(await proof(f)).toMatchObject({ available: 0n, reserved: 0n, debt: 50n }); ack(await notify(f), '00'); expect(await proof(f)).toMatchObject({ available: 0n, reserved: 0n, debt: 41n }); const entries = await db.loyaltyEntry.findMany({ where: { orderId: f.order } }); expect(entries).toHaveLength(1); expect(entries[0]).toMatchObject({ kind: 'EARN', points: 9, availableDelta: 0, debtDelta: -9n }); });
test('purchased Cart clear preserves extra quantity and another owner', async () => { const f = await started(), g = await fixture(), other = await snapshot(g); await db.cartItem.updateMany({ where: { cart: { userId: f.user } }, data: { qty: 3 } }); ack(await notify(f), '00'); expect((await db.cartItem.findFirstOrThrow({ where: { cart: { userId: f.user } } })).qty).toBe(2); expect(await snapshot(g)).toEqual(other); });
test('claim ownership/context mismatch rejects before T1 without adopting callback data', async () => { const f = await started(), other = await db.user.create({ data: { email: randomUUID() + '@example.invalid', passwordHash: 'SYNTHETIC' } }), a = await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } }); await db.idempotencyRequest.update({ where: { id: a.idempotencyRequestId }, data: { userId: other.id } }); const before = await snapshot(f); ack(await notify(f), '99'); expect(await snapshot(f)).toEqual(before); expect(await db.paymentVerification.count({ where: { attemptId: f.attempt } })).toBe(0); });
test('authentic OrderInfo mismatch is rejected without evidence or repricing', async () => { const f = await started(), before = await snapshot(f), p = await fields(f); ack(await ipn(signed({ ...p, vnp_OrderInfo: 'Different context' })), '99'); expect(await snapshot(f)).toEqual(before); expect(await db.paymentVerification.count({ where: { attemptId: f.attempt } })).toBe(0); });
test('owner lock timeout is retryable99 without receipt; no blind financial retry', async () => { const f = await started(), raw = signed(await fields(f)), before = await snapshot(f), blocker = new Client({ connectionString: url.toString() }); await blocker.connect(); await blocker.query('BEGIN'); await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [f.user]); try {
    ack(await ipn(raw), '99');
    expect(await db.paymentVerification.count({ where: { attemptId: f.attempt } })).toBe(0);
    expect(await snapshot(f)).toEqual(before);
}
finally {
    await blocker.query('ROLLBACK');
    await blocker.end();
} ack(await ipn(raw), '00'); });
test('zero-only failure identifier stays NULL and compatible auxiliary replay stays02', async () => { const f = await started(), p = await fields(f, '24', '02', '000'); ack(await ipn(signed(p)), '00'); const before = await snapshot(f); ack(await ipn(signed({ ...p, vnp_BankTranNo: 'SYNTHETICZERO' })), '02'); expect(await snapshot(f)).toEqual(before); expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).transactionNo).toBeNull(); });
test.each(['stock', 'account'])('%s invariant failure commits REVIEW without financial repairs', async (kind) => { const f = await started(); if (kind === 'stock')
    await db.product.update({ where: { id: f.product }, data: { stock: 2147483647 } });
else
    await db.user.update({ where: { id: f.user }, data: { loyaltyPoints: 49 } }); const before = await snapshot(f); ack(await notify(f, kind === 'stock' ? '24' : '00', kind === 'stock' ? '02' : '00', kind === 'stock' ? '0' : undefined), '00'); expect(await snapshot(f)).toEqual(before); expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).applicationState).toBe('REVIEW'); });
test('earned balance overflow rolls back T2 to durable money REVIEW, never clamps financial values', async () => { const f = await started(0, 2147483647), before = await snapshot(f); ack(await notify(f), '00'); expect(await snapshot(f)).toEqual(before); expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } })).applicationState).toBe('REVIEW'); expect(await proof(f)).toMatchObject({ available: 2147483647n, reserved: 0n }); });
test('new UNKNOWN notification after applied success is retained as conflict REVIEW, never duplicate02', async () => {
    const f=await started();ack(await notify(f),'00');const before=await snapshot(f);
    ack(await notify(f,'00','01','0'),'00');expect(await snapshot(f)).toEqual(before);
    expect((await db.paymentAttempt.findUniqueOrThrow({where:{id:f.attempt}})).applicationState).toBe('REVIEW');
});
test.each(['00','24'])('known nonzero provisional identifier cannot be reassigned by later %s notification', async code => {
    const f=await started(),number=String(BigInt('0x'+randomUUID().replaceAll('-','').slice(0,12)));
    ack(await notify(f,'00','01',number),'99');const before=await snapshot(f);
    ack(await notify(f,code,code==='00'?'00':'02',code==='00'?'999999999999999':'0'),'00');
    expect(await snapshot(f)).toEqual(before);
    expect(await db.paymentAttempt.findUniqueOrThrow({where:{id:f.attempt}})).toMatchObject({transactionNo:number,applicationState:'REVIEW',reviewReason:'PROVIDER_IDENTIFIER_CONFLICT'});
});
test('additional transaction identifier retained only in REVIEW evidence cannot settle another reference', async () => {
    const f=await started(),g=await started(),original='876543210123451',additional='876543210123452';
    ack(await notify(f,'00','01',original),'99');ack(await notify(f,'00','00',additional),'00');
    const before=await snapshot(g);ack(await notify(g,'00','00',additional),'00');
    expect(await snapshot(g)).toEqual(before);
    expect(await db.paymentAttempt.findUniqueOrThrow({where:{id:g.attempt}})).toMatchObject({applicationState:'REVIEW',reviewReason:'PROVIDER_TRANSACTION_REUSED'});
});
