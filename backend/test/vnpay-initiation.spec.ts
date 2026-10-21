import { initiationSettings } from '../src/payments/vnpay/initiation-config';
import { SANDBOX_PAYMENT_URL } from '../src/payments/vnpay/vnpay-config';
import { encodeAttemptCursor, decodeAttemptCursor } from '../src/payments/attempt-cursor';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AttemptService } from '../src/payments/attempt.service';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/common/configure-app';
const env = { NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_TEST_ONLY: 'true',
    DATABASE_URL: 'postgresql://fixture:fixture@localhost/brewlite_b2a_abcdef012345_test', TEST_DATABASE_URL: 'postgresql://fixture:fixture@localhost/brewlite_b2a_abcdef012345_test',
    VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: 'synthetic-b2a-unit-test-only',
    VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL, VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return', VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' };
test('Mock default requires no merchant credentials', () => expect(initiationSettings({})).toEqual({ PAYMENT_PROVIDER_MODE: 'MOCK', VNPAY_INITIATION_CONFIG: null }));
test('explicit controlled synthetic scope accepts parsed frozen config', () => expect(initiationSettings(env).VNPAY_INITIATION_CONFIG).toMatchObject({ merchantCode: 'TEST0001' }));
test.each([
    { NODE_ENV: 'development' }, { NODE_ENV: 'production' }, { VNPAY_INITIATION_TEST_ONLY: 'false' }, { TEST_DATABASE_URL: '' },
    { DATABASE_URL: 'postgresql://fixture:fixture@localhost/brewlite_dev', TEST_DATABASE_URL: 'postgresql://fixture:fixture@localhost/brewlite_dev' },
    { VNPAY_TMN_CODE: 'REAL0001' }, { VNPAY_HASH_SECRET: '' }, { VNPAY_HASH_SECRET: 'not-an-approved-fixture' },
    { VNPAY_PAYMENT_URL: 'https://pay.vnpay.vn/vpcpay.html' }, { VNPAY_RETURN_URL: 'http://callback.example.org/payments/vnpay/return' },
    { PAYMENT_PROVIDER_MODE: 'INVALID' }, { VNPAY_ATTEMPT_TTL_SECONDS: '1200' },
])('configuration fails closed without disclosing values %j', override => {
    expect(() => initiationSettings({ ...env, ...override })).toThrow();
    try {
        initiationSettings({ ...env, ...override });
    }
    catch (error) {
        expect(String(error)).not.toContain(env.VNPAY_HASH_SECRET);
    }
});
test('cursor encrypted, deterministic position, authenticated owner/order binding', () => {
    const owner = randomUUID(), order = randomUUID(), id = randomUUID(), date = new Date(), secret = 'unit-cursor-fixture';
    const cursor = encodeAttemptCursor(secret, owner, order, date, id);
    expect(cursor).not.toContain(owner);
    expect(decodeAttemptCursor(secret, owner, order, cursor)).toEqual({ date, id });
    for (const input of [cursor.slice(0, -4) + 'ABCD', '', '!', 'a'.repeat(769)])
        expect(() => decodeAttemptCursor(secret, owner, order, input)).toThrow();
    expect(() => decodeAttemptCursor(secret, randomUUID(), order, cursor)).toThrow();
    expect(() => decodeAttemptCursor(secret, owner, randomUUID(), cursor)).toThrow();
});
describe('initiation/status HTTP contract', () => {
    let app: NestExpressApplication, jwt: JwtService;
    const actor = randomUUID(), orderId = randomUUID(), attemptId = randomUUID();
    let role = 'CUSTOMER';
    const service = { initiate: jest.fn(), get: jest.fn(), list: jest.fn() };
    beforeAll(async () => {
        const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({ user: { findUnique: () => Promise.resolve({ id: actor, role }) } })
            .overrideProvider(AttemptService).useValue(service).compile();
        app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
        configureApp(app);
        await app.init();
        jwt = app.get(JwtService);
    });
    beforeEach(() => { role = 'CUSTOMER'; jest.clearAllMocks(); });
    afterAll(async () => { await app.close(); });
    const token = () => 'Bearer ' + jwt.sign({ sub: actor });
    test('POST returns201/replay header and server socket IP; rejects client amount', async () => {
        service.initiate.mockResolvedValue({ body: { attemptId }, replayed: true });
        const r = await request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', token()).set('Idempotency-Key', 'unit-key').set('X-Forwarded-For', '203.0.113.55').send({ orderId }).expect(201);
        expect(r.body).toEqual({ attemptId });
        expect(r.headers['idempotency-replayed']).toBe('true');
        expect(r.headers['cache-control']).toContain('no-store');
        expect(service.initiate).toHaveBeenCalledWith(actor, 'unit-key', orderId, expect.any(String));
        expect((service.initiate.mock.calls[0] as unknown[])[3]).not.toBe('203.0.113.55');
        await request(app.getHttpServer()).post('/payments/vnpay/attempts').set('Authorization', token()).send({ orderId, amount: 1 }).expect(400);
    });
    test.each(['/payments/vnpay/attempts', '/payments/attempts/' + attemptId, '/orders/' + orderId + '/payment-attempts'])('JWT and database role enforce %s before service', async (path) => {
        const verb = path.includes('vnpay') ? 'post' : 'get';
        await request(app.getHttpServer())[verb](path).expect(401);
        role = 'ADMIN';
        await request(app.getHttpServer())[verb](path).set('Authorization', token()).expect(403);
        expect(service.initiate).not.toHaveBeenCalled();
        expect(service.get).not.toHaveBeenCalled();
        expect(service.list).not.toHaveBeenCalled();
    });
    test('status/list pass ownership context and enforce strict pagination/query', async () => {
        service.get.mockResolvedValue({ attemptId, effectiveState: 'UNKNOWN' });
        service.list.mockResolvedValue({ current: null, items: [], nextCursor: null });
        await request(app.getHttpServer()).get('/payments/attempts/' + attemptId).set('Authorization', token()).expect(200);
        expect(service.get).toHaveBeenCalledWith(actor, attemptId);
        await request(app.getHttpServer()).get('/orders/' + orderId + '/payment-attempts?limit=20').set('Authorization', token()).expect(200);
        expect(service.list).toHaveBeenCalledWith(actor, orderId, expect.objectContaining({ limit: '20' }));
        for (const query of ['limit=21', 'limit=-1', 'limit=1&limit=2', 'provider=VNPAY', 'cursor=%21'])
            await request(app.getHttpServer()).get('/orders/' + orderId + '/payment-attempts?' + query).set('Authorization', token()).expect(400);
    });
});
