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
import { IpnService } from '../../src/payments/ipn.service';
import { QUERYDR_TRANSPORT } from '../../src/payments/vnpay/querydr-transport';
import { QueryDrError } from '../../src/payments/vnpay/querydr-protocol';
import { createHmac, randomUUID } from 'node:crypto';
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
const schema = `b2c1_${randomUUID().replaceAll('-', '')}`;
const url = new URL(connectionString);
url.searchParams.set('options', `-c search_path=${schema}`);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(url.toString()) }, { schema }) });
const client = new Client({ connectionString });
const txWork = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(work, { timeout: 5000 });
let app: NestExpressApplication, jwt: JwtService;
const outbound = jest.fn<Promise<string>, [Record<string, string>]>();
let admin: string, staff: string;
const secret = 'synthetic-b2a-fixture-only-not-a-merchant-secret';
const settings = new ConfigService({ PAYMENT_MOCK_MODE: 'SUCCESS', JWT_SECRET: 'synthetic-b2a-jwt-fixture-of-at-least-32-bytes', JWT_EXPIRES_IN: 3600,
    ...initiationSettings({ NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_TEST_ONLY: 'true', DATABASE_URL: connectionString, TEST_DATABASE_URL: connectionString,
        VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
        VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' }) });
beforeEach(() => { settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'); outbound.mockReset(); outbound.mockRejectedValue(new QueryDrError('NETWORK_DISABLED')); });
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
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).overrideProvider(ConfigService).useValue(settings).overrideProvider(QUERYDR_TRANSPORT).useValue({ post: outbound }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    jwt = app.get(JwtService);
    admin = (await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'NON_LOGIN_SYNTHETIC', role: 'ADMIN' } })).id;
    staff = (await db.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'NON_LOGIN_SYNTHETIC', role: 'STAFF' } })).id;
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

const reconcile = (id: string, user = admin) => request(app.getHttpServer()).post(`/admin/payments/vnpay/attempts/${id}/reconcile`).set('Authorization', 'Bearer ' + jwt.sign({ sub: user }));
const responseKeys = ['ResponseId', 'Command', 'ResponseCode', 'Message', 'TmnCode', 'TxnRef', 'Amount', 'BankCode', 'PayDate', 'TransactionNo', 'TransactionType', 'TransactionStatus', 'OrderInfo', 'PromotionCode', 'PromotionAmount'];
function querySigned(p: Record<string, string>) {
    const signature = createHmac('sha512', secret).update(responseKeys.map(k => p['vnp_' + k] ?? '').join('|'), 'utf8').digest('hex');
    return JSON.stringify({ ...p, vnp_SecureHash: signature });
}
async function response(f: Fixture, overrides: Record<string, string> = {}) {
    return querySigned({ ...await fields(f), vnp_ResponseId: randomUUID().replaceAll('-', ''), vnp_Command: 'querydr', vnp_Message: 'Query successful', vnp_TransactionType: '01', ...overrides });
}
async function respond(f: Fixture, overrides: Record<string, string> = {}) { const raw = await response(f, overrides); outbound.mockResolvedValue(raw); return raw; }
async function receipts(id: string) { return db.paymentVerification.findMany({ where: { attemptId: id }, orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }] }); }

test('verified QUERYDR success: durable request/date/context, T1/T2, stock unchanged, Loyalty/Award/Cart exactly once', async () => {
    const f = await started(), before = await snapshot(f); await respond(f);
    const r = await reconcile(f.attempt).send({}).expect(200);
    expect(r.body).toMatchObject({ effectiveState: 'SUCCEEDED', applicationState: 'APPLIED', canRetry: false });
    expect(r.headers['cache-control']).toBe('private, no-store, max-age=0');
    const after = await snapshot(f);
    expect(after.order.status).toBe('PAID'); expect(after.products).toEqual(before.products); expect(after.order.items).toEqual(before.order.items);
    expect(after.payments).toHaveLength(1); expect(after.awards.map(a => a.points)).toEqual([8]); expect(after.cart!.items).toHaveLength(0);
    expect(after.journal.map(e => e.kind)).toEqual(['OPENING', 'RESERVE', 'SETTLE', 'EARN']);
    expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n, debt: 0n });
    const a = await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } });
    expect(outbound.mock.calls[0][0]).toMatchObject({ vnp_TxnRef: a.txnRef, vnp_TransactionDate: a.createDate, vnp_RequestId: expect.stringMatching(/^[a-f0-9]{32}$/) as unknown });
    expect((await receipts(f.attempt))[0]).toMatchObject({ source: 'QUERYDR', state: 'VERIFIED', requestId: outbound.mock.calls[0][0].vnp_RequestId, processedAt: expect.any(Date) as unknown });
    await reconcile(f.attempt).send({}).expect(200); expect(outbound).toHaveBeenCalledTimes(1); expect(await snapshot(f)).toEqual(after);
});
test('QueryDr00/status02 is verified failure; restores stock/releases once with no Award or Cart clear', async () => {
    const f = await started(), before = await snapshot(f); await respond(f, { vnp_TransactionStatus: '02', vnp_TransactionNo: '0' });
    await reconcile(f.attempt).send({}).expect(200); const after = await snapshot(f);
    expect(after.payments[0].status).toBe('FAILED'); expect(after.order.status).toBe('PAYMENT_FAILED'); expect(after.products[0].stock).toBe(10);
    expect(after.cart).toEqual(before.cart); expect(after.awards).toHaveLength(0); expect(await proof(f)).toMatchObject({ available: 100n, reserved: 0n, debt: 0n });
    await reconcile(f.attempt).send({}).expect(200); expect(await snapshot(f)).toEqual(after);
    ack(await notify(f, '24', '02', '0'), '02'); expect(await snapshot(f)).toEqual(after);
});
test('UNKNOWN holds resources and future query resolves existing provisional evidence', async () => {
    const f = await started(), before = await snapshot(f); await respond(f, { vnp_TransactionStatus: '01', vnp_TransactionNo: '0' });
    await reconcile(f.attempt).send({}).expect(202); expect(await snapshot(f)).toEqual(before);
    expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: 'UNKNOWN', canRetry: false, canCancel: false });
    await reconcile(f.attempt).send({}).expect(429);
    const now = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(now + 31000); // new Date is controlled below instead of rewriting immutable receipt time.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'performance'] }); jest.setSystemTime(now + 31000);
    await respond(f); await reconcile(f.attempt).send({}).expect(200);
    expect(await db.payment.count({ where: { orderId: f.order } })).toBe(1); expect((await receipts(f.attempt)).every(r => r.processedAt !== null)).toBe(true);
});
test.each(['04', '07', '05', '06', '09', '88'])('verified status%s retained in REVIEW without finances', async code => {
    const f = await started(), before = await snapshot(f); await respond(f, { vnp_TransactionStatus: code });
    await reconcile(f.attempt).send({}).expect(200); expect(await snapshot(f)).toEqual(before);
    expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: 'REVIEW', canRetry: false, canCancel: false });
    await reconcile(f.attempt).send({}).expect(409); expect(outbound).toHaveBeenCalledTimes(1);
});
test.each(['91', '94', '97', '99'])('QueryDr API error%s never means terminal failure', async code => {
    const f = await started(), before = await snapshot(f); await respond(f, { vnp_ResponseCode: code });
    await reconcile(f.attempt).send({}).expect(503); expect(await snapshot(f)).toEqual(before);
    expect((await receipts(f.attempt))[0]).toMatchObject({ state: 'UNRESOLVED', errorCode: 'PROVIDER_API_' + code, payload: null, processedAt: null });
    await reconcile(f.attempt).send({}).expect(429);
});
test.each(['TIMEOUT', 'TRANSPORT_FAILURE', 'INVALID_JSON', 'HTTP_FAILURE'])('lost/failed response %s preserves reservations', async code => {
    const f = await started(), before = await snapshot(f); outbound.mockRejectedValue(new QueryDrError(code));
    await reconcile(f.attempt).send({}).expect(503); expect(await snapshot(f)).toEqual(before);
    expect((await receipts(f.attempt))[0]).toMatchObject({ state: 'UNRESOLVED', errorCode: code, payload: null });
});
test.each(['unsigned', 'amount', 'merchant', 'reference', 'number', 'type', 'malformed', 'duplicate', 'unknown', 'datatype'])('invalid response %s has no verified receipt or financial mutation', async kind => {
    const f = await started(), before = await snapshot(f);
    const changes: Record<string, Record<string, string>> = { amount: { vnp_Amount: '8500001' }, merchant: { vnp_TmnCode: 'WRONG001' }, reference: { vnp_TxnRef: 'a'.repeat(32) }, number: { vnp_TransactionNo: 'NaN' }, type: { vnp_TransactionType: 'x' } };
    let raw = await response(f, changes[kind]);
    if (kind === 'unsigned') raw = JSON.stringify({ ...JSON.parse(raw), vnp_SecureHash: '' });
    if (kind === 'malformed') raw = '{';
    if (kind === 'duplicate') raw = raw.slice(0, -1) + ',"vnp_Amount":"8500000"}';
    if (kind === 'unknown') raw = raw.slice(0, -1) + ',"extra":"x"}';
    if (kind === 'datatype') raw = raw.replace('"8500000"', '8500000');
    outbound.mockResolvedValue(raw); await reconcile(f.attempt).send({}).expect(503);
    expect(await snapshot(f)).toEqual(before); expect((await receipts(f.attempt))[0].state).toBe('UNRESOLVED');
});
test('concurrent queries only one durable outbound claim; no exactly-once network promise', async () => {
    const f = await started(); await respond(f);
    const results = await Promise.all([reconcile(f.attempt).send({}), reconcile(f.attempt).send({})]);
    expect(results.every(r => [200, 429, 503].includes(r.status))).toBe(true);
    await reconcile(f.attempt).send({}).expect(200); expect(outbound).toHaveBeenCalledTimes(1);
    expect(await db.payment.count({ where: { orderId: f.order } })).toBe(1); expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n });
});
test.each(['success', 'failure'])('IPN/QueryDr %s race conserves financial effects', async result => {
    const f = await started(), number = '123' + String(BigInt('0x' + randomUUID().slice(0, 8))); const failed = result === 'failure';
    await respond(f, { vnp_TransactionNo: number, vnp_TransactionStatus: failed ? '02' : '00' });
    await Promise.all([reconcile(f.attempt).send({}), notify(f, failed ? '24' : '00', failed ? '02' : '00', number)]);
    await reconcile(f.attempt).send({}).expect(200);
    expect(await db.payment.count({ where: { orderId: f.order } })).toBe(1);
    expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: failed ? 'FAILED' : 'SUCCEEDED' });
    expect(await proof(f)).toMatchObject({ available: failed ? 100n : 58n, reserved: 0n });
    expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(failed ? 10 : 9);
});
test.each(['success', 'failure'])('in-flight QueryDr %s after IPN success preserves Payment and reviews contradictions', async outcome => {
    const f = await started(), number = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)));
    outbound.mockImplementation(async () => { ack(await notify(f, '00', '00', number), '00'); return response(f, { vnp_TransactionNo: number, vnp_TransactionStatus: outcome === 'success' ? '00' : '02' }); });
    await reconcile(f.attempt).send({}).expect(200);
    expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: outcome === 'success' ? 'SUCCEEDED' : 'REVIEW' });
    expect(await db.payment.findFirst({ where: { orderId: f.order } })).toMatchObject({ status: 'SUCCEEDED' });
    expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n });
});
test('in-flight QueryDr success after terminal failure never overwrites or reacquires stock/points', async () => {
    const f = await started(), number = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)));
    outbound.mockImplementation(async () => { ack(await notify(f, '24', '02', number), '00'); return response(f, { vnp_TransactionNo: number }); });
    await reconcile(f.attempt).send({}).expect(200);
    expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: 'REVIEW', messageCode: 'PAYMENT_RECEIVED_REVIEW' });
    expect(await db.payment.findFirst({ where: { orderId: f.order } })).toMatchObject({ status: 'FAILED' });
    expect(await proof(f)).toMatchObject({ available: 100n, reserved: 0n });
});
test('crash after T1 before T2: recovery uses existing QUERYDR evidence without another call', async () => {
    const f = await started(), before = await snapshot(f); await respond(f);
    jest.spyOn(app.get(IpnService), 'apply').mockRejectedValueOnce(Error('synthetic crash'));
    await reconcile(f.attempt).send({}).expect(503); expect(await snapshot(f)).toEqual(before);
    expect((await receipts(f.attempt))[0]).toMatchObject({ state: 'VERIFIED', processedAt: null });
    await reconcile(f.attempt).send({}).expect(200); expect(outbound).toHaveBeenCalledTimes(1); expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n });
});
test('crash after T2 before app response: retry returns current state without outbound/effects', async () => {
    const f = await started(); await respond(f); const engine = app.get(IpnService), apply = engine.apply.bind(engine);
    jest.spyOn(engine, 'apply').mockImplementationOnce(async (...args) => { await apply(...args); throw Error('lost application response'); });
    await reconcile(f.attempt).send({}).expect(503); const after = await snapshot(f);
    await reconcile(f.attempt).send({}).expect(200); expect(await snapshot(f)).toEqual(after); expect(outbound).toHaveBeenCalledTimes(1);
});
test('crash before T1 persistence leaves only unresolved inquiry, no finances', async () => {
    const f = await started(), before = await snapshot(f); await respond(f);
    const engine = app.get(IpnService), transaction = engine.transaction.bind(engine); let calls = 0;
    jest.spyOn(engine, 'transaction').mockImplementation(async work => { if (++calls === 2) throw Error('crash before T1'); return transaction(work); });
    await reconcile(f.attempt).send({}).expect(503); expect(await snapshot(f)).toEqual(before); expect((await receipts(f.attempt))[0].state).toBe('UNRESOLVED');
});
test('existing verified IPN receipt recovery makes no query', async () => {
    const f = await started(); jest.spyOn(app.get(IpnService), 'apply').mockRejectedValueOnce(Error('crash'));
    ack(await notify(f), '99'); await reconcile(f.attempt).send({}).expect(200); expect(outbound).not.toHaveBeenCalled(); expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n });
});
test('duplicate provider response replay dedupes QUERYDR evidence and holds UNKNOWN', async () => {
    const f = await started(), raw = await respond(f, { vnp_TransactionStatus: '01', vnp_TransactionNo: '0' });
    await reconcile(f.attempt).send({}).expect(202);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'performance'] }); jest.setSystemTime(Date.now() + 31000);
    outbound.mockResolvedValue(raw); await reconcile(f.attempt).send({}).expect(202);
    expect((await receipts(f.attempt)).map(r => r.state)).toEqual(['VERIFIED', 'UNRESOLVED']); expect(await db.payment.count({ where: { orderId: f.order } })).toBe(0);
});
test('cross-attempt provider transaction conflict retains evidence in REVIEW, no second settlement', async () => {
    const a = await started(), b = await started(); const number = '123456'; await respond(a, { vnp_TransactionNo: number }); await reconcile(a.attempt).send({}).expect(200);
    const before = await snapshot(b); await respond(b, { vnp_TransactionNo: number }); await reconcile(b.attempt).send({}).expect(200);
    expect(await snapshot(b)).toEqual(before); expect((await status(b, b.attempt)).body).toMatchObject({ effectiveState: 'REVIEW' });
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: b.attempt } })).transactionNo).toBeNull();
});
test('cancellation and payment retry during network wait remain blocked; success consumes one reservation', async () => {
    const f = await started(); outbound.mockImplementation(async () => { await cancel(f).expect(409); await initiate(f).expect(409); return response(f); });
    await reconcile(f.attempt).send({}).expect(200); expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n });
});
test('REVIEW arising during outbound is sticky even with signed success', async () => {
    const f = await started(); outbound.mockImplementation(async () => { ack(await notify(f, '07', '07'), '00'); return response(f); });
    const before = await snapshot(f); await reconcile(f.attempt).send({}).expect(200); expect(await snapshot(f)).toEqual(before); expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: 'REVIEW' });
});
test('ADMIN DB RBAC, forged JWT role, strict DTO, not found, feature OFF', async () => {
    const f = await started();
    await request(app.getHttpServer()).post(`/admin/payments/vnpay/attempts/${f.attempt}/reconcile`).send({}).expect(401);
    await reconcile(f.attempt, f.user).send({}).expect(403); await reconcile(f.attempt, staff).send({}).expect(403);
    await request(app.getHttpServer()).post(`/admin/payments/vnpay/attempts/${f.attempt}/reconcile`).set('Authorization', 'Bearer ' + jwt.sign({ sub: f.user, role: 'ADMIN' })).send({}).expect(403);
    await reconcile(f.attempt).send({ amount: '1' }).expect(400); await reconcile(f.attempt).query({ response: '00' }).send({}).expect(400);
    await reconcile(randomUUID()).send({}).expect(404); await reconcile('invalid').send({}).expect(400);
    settings.set('PAYMENT_PROVIDER_MODE', 'MOCK'); await reconcile(f.attempt).send({}).expect(503); expect(outbound).not.toHaveBeenCalled();
});
test('zero total initiation still rejects without synthetic Attempt or automatic confirmation', async () => {
    const f = await fixture(900, 1000), before = await snapshot(f); await initiate(f).expect(422);
    expect(await db.paymentAttempt.count({ where: { orderId: f.order } })).toBe(0); expect(await snapshot(f)).toEqual(before); expect(outbound).not.toHaveBeenCalled();
});
test('QueryDr failure then gateway retry success preserves FIX01 cycle2 attribution', async () => {
    const f = await started(); await respond(f, { vnp_TransactionStatus: '02', vnp_TransactionNo: '0' });
    await reconcile(f.attempt).send({}).expect(200); const retry = await initiate(f).expect(201); const id = (retry.body as { attemptId: string }).attemptId;
    await respond(f); await reconcile(id).send({}).expect(200);
    const after = await snapshot(f);
    expect(after.payments.map(p => p.status).sort()).toEqual(['FAILED', 'SUCCEEDED']); expect(after.products[0].stock).toBe(9);
    expect(after.awards.map(a => a.points)).toEqual([8]); expect(after.cart!.items).toHaveLength(0);
    expect(after.journal.find(e => e.kind === 'RESERVE' && e.cycle === 2)).toMatchObject({ paymentAttemptId: id, paymentId: null });
    expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n, debt: 0n });
});
test('terminal old failure/new retry while inquiry in-flight: late success reviews without consuming new hold', async () => {
    const f = await started(); const number = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12))); let newId = '';
    outbound.mockImplementation(async () => {
        ack(await notify(f, '24', '02', number), '00');
        const r = await initiate(f).expect(201); newId = (r.body as { attemptId: string }).attemptId;
        const a = await db.paymentAttempt.findUniqueOrThrow({ where: { id: f.attempt } });
        return querySigned({ vnp_ResponseId: randomUUID().replaceAll('-', ''), vnp_Command: 'querydr', vnp_ResponseCode: '00', vnp_Message: 'Query successful',
            vnp_TmnCode: 'TEST0001', vnp_TxnRef: a.txnRef, vnp_Amount: '8500000', vnp_BankCode: 'NCB', vnp_TransactionNo: number, vnp_TransactionType: '01', vnp_TransactionStatus: '00', vnp_OrderInfo: 'Thanh toan BrewLite' });
    });
    await reconcile(f.attempt).send({}).expect(200); expect(newId).not.toBe('');
    expect((await status(f, newId)).body).toMatchObject({ effectiveState: 'REVIEW', canRetry: false, canCancel: false });
    expect(await db.payment.count({ where: { orderId: f.order } })).toBe(1); expect(await proof(f)).toMatchObject({ available: 50n, reserved: 50n });
    expect((await db.product.findUniqueOrThrow({ where: { id: f.product } })).stock).toBe(9);
});
test('existing REVIEW never calls transport or clears financial hold', async () => {
    const f = await started(); ack(await notify(f, '07', '07'), '00'); const before = await snapshot(f);
    await reconcile(f.attempt).send({}).expect(409); expect(outbound).not.toHaveBeenCalled(); expect(await snapshot(f)).toEqual(before);
});
test('multiple verified IPN receipts recover without QueryDr or duplicate effects', async () => {
    const f = await started(); const p = await fields(f); const engine = app.get(IpnService);
    const spy = jest.spyOn(engine, 'apply').mockRejectedValue(Error('crash'));
    ack(await ipn(signed(p)), '99'); ack(await ipn(signed({ ...p, vnp_CardType: 'ATM' })), '99'); spy.mockRestore();
    await reconcile(f.attempt).send({}).expect(200); expect(outbound).not.toHaveBeenCalled();
    expect(await db.payment.count({ where: { orderId: f.order } })).toBe(1); expect((await receipts(f.attempt)).every(r => r.processedAt !== null)).toBe(true);
});
test('persisted REQUESTED survives simulated process loss and enforces retry interval', async () => {
    const f = await started(); let captured = '';
    outbound.mockImplementation(p => { captured = p.vnp_RequestId; return Promise.reject(new QueryDrError('TIMEOUT')); });
    const update = jest.spyOn(db.paymentVerification, 'updateMany').mockRejectedValueOnce(Error('crash before unresolved write'));
    await reconcile(f.attempt).send({}).expect(503); update.mockRestore();
    expect((await receipts(f.attempt))[0]).toMatchObject({ state: 'REQUESTED', requestId: captured });
    await reconcile(f.attempt).send({}).expect(429);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'performance'] }); jest.setSystemTime(Date.now() + 31000);
    await respond(f); await reconcile(f.attempt).send({}).expect(200);
    expect(outbound.mock.calls[1][0].vnp_RequestId).not.toBe(captured); expect(await proof(f)).toMatchObject({ available: 58n, reserved: 0n });
});
