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
const schema = `c1_${randomUUID().replaceAll('-', '')}`;
const url = new URL(connectionString);
url.searchParams.set('options', `-c search_path=${schema}`);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(url.toString()) }, { schema }) });
const client = new Client({ connectionString });
const txWork = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(work, { timeout: 5000 });
let app: NestExpressApplication, jwt: JwtService;
const secret = 'synthetic-b2a-fixture-only-not-a-merchant-secret';
const settings = new ConfigService({ FRONTEND_ORIGIN: 'http://localhost:3000', PAYMENT_MOCK_MODE: 'SUCCESS', JWT_SECRET: 'synthetic-b2a-jwt-fixture-of-at-least-32-bytes', JWT_EXPIRES_IN: 3600,
    ...initiationSettings({ NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_TEST_ONLY: 'true', DATABASE_URL: connectionString, TEST_DATABASE_URL: connectionString,
        VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: secret, VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL,
        VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' }) });
beforeEach(() => { settings.set('PAYMENT_PROVIDER_MODE', 'VNPAY_SANDBOX'); settings.set('FRONTEND_ORIGIN', 'http://localhost:3000'); });
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

const resultBase = 'http://localhost:3000/payments/vnpay/result';
const browserReturn = (raw: string) => request(app.getHttpServer()).get('/payments/vnpay/return?' + raw);
async function fingerprints() {
    const tables = (await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name", [schema])).rows;
    const hashes: Record<string, { n: number; hash: string }> = {};
    for (const { table_name: table } of tables) {
        if (!/^[a-z_]+$/.test(table)) throw Error('Unexpected table name');
        hashes[table] = (await client.query<{ n: number; hash: string }>(`SELECT count(*)::int n,md5(COALESCE(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text),'')) hash FROM "${schema}"."${table}" t`)).rows[0];
    }
    const sequences = (await client.query('SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=$1 ORDER BY sequencename', [schema])).rows as unknown[];
    return { hashes, sequences };
}
test.each([['00', '00'], ['24', '02'], ['00', '01'], ['07', '07'], ['00', '02']])('signed Return%s/%s before IPN redirects without changing ANY table/sequence', async (code, state) => {
    const f = await started(), p = await fields(f, code, state), before = await fingerprints(), owned = await snapshot(f);
    const r = await browserReturn(signed(p)).expect(303);
    expect(r.headers.location).toBe(resultBase + '?attemptId=' + f.attempt); expect(r.headers['cache-control']).toBe('no-store'); expect(r.headers['referrer-policy']).toBe('no-referrer'); expect(r.text).toBe('');
    expect(await fingerprints()).toEqual(before); expect(await snapshot(f)).toEqual(owned); expect(owned.order.status).toBe('PENDING'); expect(owned.payments).toHaveLength(0);
    expect(await proof(f)).toMatchObject({ available: 50n, reserved: 50n, debt: 0n });
});
test.each(['success', 'failure'])('Return before/after verified IPN %s only navigates; IPN remains authority', async outcome => {
    const f = await started(), failed = outcome === 'failure', p = await fields(f, failed ? '24' : '00', failed ? '02' : '00'), raw = signed(p);
    const before = await fingerprints(); await browserReturn(raw).expect(303); expect(await fingerprints()).toEqual(before);
    ack(await ipn(raw).expect(200), '00'); const settled = await snapshot(f), afterIpn = await fingerprints();
    for (let i = 0; i < 3; i++) expect((await browserReturn(raw).expect(303)).headers.location).toBe(resultBase + '?attemptId=' + f.attempt);
    expect(await fingerprints()).toEqual(afterIpn); expect(await snapshot(f)).toEqual(settled); expect(settled.order.status).toBe(failed ? 'PAYMENT_FAILED' : 'PAID');
    expect(settled.payments).toHaveLength(1); expect(settled.awards).toHaveLength(failed ? 0 : 1); expect(await proof(f)).toMatchObject({ available: failed ? 100n : 58n, reserved: 0n, debt: 0n });
});
test.each(['UNKNOWN', 'REVIEW'])('%s is never cleared by a signed success Return', async state => {
    const f = await started(); ack(await notify(f, state === 'REVIEW' ? '07' : '00', state === 'REVIEW' ? '07' : '01', '0'), state === 'REVIEW' ? '00' : '99');
    const before = await fingerprints(), p = await fields(f); await browserReturn(signed(p)).expect(303); expect(await fingerprints()).toEqual(before);
    expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: state, canRetry: false, canCancel: false });
    await cancel(f).expect(409); await initiate(f).expect(409); expect(await proof(f)).toMatchObject({ available: 50n, reserved: 50n });
});
test.each(['success', 'failure'])('Return/IPN concurrent %s settles exactly once via IPN', async outcome => {
    const f = await started(), failed = outcome === 'failure', p = await fields(f, failed ? '24' : '00', failed ? '02' : '00'), raw = signed(p);
    await Promise.all([browserReturn(raw).expect(303), ipn(raw).expect(200), browserReturn(raw).expect(303), ipn(raw).expect(200)]);
    // A transient lock error is recoverable through the genuine IPN path only.
    const final = await ipn(raw).expect(200); expect(['00', '02']).toContain((final.body as { RspCode: string }).RspCode);
    const after = await snapshot(f); expect(after.payments).toHaveLength(1); expect(after.awards).toHaveLength(failed ? 0 : 1);
    expect(after.journal.filter(e => e.kind === (failed ? 'RELEASE' : 'SETTLE'))).toHaveLength(1); expect(after.journal.filter(e => e.kind === 'EARN')).toHaveLength(failed ? 0 : 1);
    expect(after.products[0].stock).toBe(failed ? 10 : 9); expect(await proof(f)).toMatchObject({ available: failed ? 100n : 58n, reserved: 0n });
    const beforeReturn = await fingerprints(); await browserReturn(raw).expect(303); expect(await fingerprints()).toEqual(beforeReturn);
});
test.each(['unknown', 'signature', 'missing', 'merchant', 'amount', 'duplicate', 'percent', 'nested', 'unsupported', 'open-redirect'])('invalid Return%s leaves all fingerprints unchanged and redirects generic', async kind => {
    const f = await started(), p = await fields(f), before = await fingerprints(); let raw = signed(p);
    switch (kind) {
        case 'unknown': raw = signed({ ...p, vnp_TxnRef: randomUUID().replaceAll('-', '') }); break;
        case 'signature': raw = canonicalize(p) + '&vnp_SecureHash=' + 'a'.repeat(128); break;
        case 'missing': raw = canonicalize(p); break;
        case 'merchant': raw = signed({ ...p, vnp_TmnCode: 'WRONG001' }); break;
        case 'amount': raw = signed({ ...p, vnp_Amount: '8500001' }); break;
        case 'duplicate': raw += '&vnp_Amount=8500000'; break;
        case 'percent': raw += '&vnp_CardType=%GG'; break;
        case 'nested': raw += '&vnp_CardType[]=ATM'; break;
        case 'unsupported': raw = signed({ ...p, vnp_Unexpected: 'x' }); break;
        case 'open-redirect': raw += '&next=https%3A%2F%2Fevil.example'; break;
    }
    const r = await browserReturn(raw).expect(303); expect(r.headers.location).toBe(resultBase); expect(r.text).toBe(''); expect(await fingerprints()).toEqual(before);
});
test('Return ignores session identities; only owned authenticated status GET reveals details', async () => {
    const f = await started(), other = await started(), raw = signed(await fields(f)), before = await fingerprints();
    const r = await browserReturn(raw).set('Authorization', auth(other)).set('Cookie', 'attemptId=' + other.attempt).expect(303);
    expect(r.headers.location).toBe(resultBase + '?attemptId=' + f.attempt); expect(r.text).toBe('');
    expect(JSON.stringify(r.headers)).not.toContain(f.order); expect(JSON.stringify(r.headers)).not.toContain(f.user);
    await request(app.getHttpServer()).get('/payments/attempts/' + f.attempt).expect(401);
    await request(app.getHttpServer()).get('/payments/attempts/' + f.attempt).set('Authorization', auth(other)).expect(404);
    await status(f, f.attempt).expect(200); expect(await fingerprints()).toEqual(before);
});
test('expired local URL still resolves context read-only; never fails or releases Attempt', async () => {
    const f = await started(), raw = signed(await fields(f));
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'performance'] }); jest.setSystemTime(Date.now() + 3600000);
    const before = await fingerprints(); expect((await browserReturn(raw).expect(303)).headers.location).toBe(resultBase + '?attemptId=' + f.attempt);
    expect(await fingerprints()).toEqual(before); expect((await status(f, f.attempt)).body).toMatchObject({ effectiveState: 'UNKNOWN', canRetry: false, canCancel: false });
});
test('repeated Return cannot turn terminal failure into success or consume newly reserved retry points', async () => {
    const f = await started(), successReturn = signed(await fields(f)); ack(await notify(f, '24', '02', '0'), '00'); await initiate(f).expect(201);
    const before = await fingerprints(); await browserReturn(successReturn).expect(303); expect(await fingerprints()).toEqual(before);
    expect(await proof(f)).toMatchObject({ available: 50n, reserved: 50n }); expect((await snapshot(f)).payments).toHaveLength(1);
});
test('Mock mode never reads/settles known gateway Return and preserves historical Mock behavior', async () => {
    const f = await started(), raw = signed(await fields(f)), before = await fingerprints(); settings.set('PAYMENT_PROVIDER_MODE', 'MOCK');
    expect((await browserReturn(raw).expect(303)).headers.location).toBe(resultBase); expect(await fingerprints()).toEqual(before);
});
