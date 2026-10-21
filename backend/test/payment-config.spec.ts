import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/common/configure-app';
import { initiationSettings } from '../src/payments/vnpay/initiation-config';
import { SANDBOX_PAYMENT_URL } from '../src/payments/vnpay/vnpay-config';

const env = { NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX', VNPAY_INITIATION_TEST_ONLY: 'true',
  DATABASE_URL: 'postgresql://fixture:fixture@localhost/brewlite_b2a_abcdef012345_test',
  TEST_DATABASE_URL: 'postgresql://fixture:fixture@localhost/brewlite_b2a_abcdef012345_test',
  VNPAY_ENV: 'SANDBOX', VNPAY_VERSION: '2.1.0', VNPAY_TMN_CODE: 'TEST0001', VNPAY_HASH_SECRET: 'synthetic-b2a-config-test-only',
  VNPAY_PAYMENT_URL: SANDBOX_PAYMENT_URL, VNPAY_RETURN_URL: 'https://callback.example.org/payments/vnpay/return',
  VNPAY_IPN_URL: 'https://callback.example.org/payments/vnpay/ipn' };
const settings = new ConfigService({ ...env, ...initiationSettings(env), JWT_SECRET: 'synthetic-config-jwt-at-least-32-bytes', JWT_EXPIRES_IN: 3600 });
let app: NestExpressApplication, jwt: JwtService, role = 'CUSTOMER';
const actor = randomUUID(), lookup = jest.fn();
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ConfigService).useValue(settings)
    .overrideProvider(PrismaService).useValue({ user: { findUnique: lookup } }).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
});
beforeEach(() => { role = 'CUSTOMER'; lookup.mockReset(); lookup.mockImplementation(() => Promise.resolve({ id: actor, role }));
  for (const [k, v] of Object.entries({ ...env, ...initiationSettings(env) })) settings.set(k, v);
});
afterAll(async () => { await app.close(); });
const get = () => request(app.getHttpServer()).get('/payments/config').set('Authorization', 'Bearer ' + jwt.sign({ sub: actor, role: 'CUSTOMER' }));
test.each(['MOCK', 'VNPAY_SANDBOX'])('effective %s exact DTO, no-store, no financial dependencies', async mode => {
  settings.set('PAYMENT_PROVIDER_MODE', mode); const r = await get().expect(200);
  expect(r.body).toEqual({ providerMode: mode }); expect(r.headers['cache-control']).toContain('no-store');
  expect(r.headers.vary).toContain('Authorization'); expect(JSON.stringify(r.body)).not.toContain(env.VNPAY_HASH_SECRET);
  expect(lookup).toHaveBeenCalledTimes(1); // Only JWT identity lookup exists on the DB stub; no mutation methods.
});
test.each([{ PAYMENT_PROVIDER_MODE: 'INVALID' }, { PAYMENT_PROVIDER_MODE: undefined }, { VNPAY_INITIATION_CONFIG: null },
  { VNPAY_INITIATION_CONFIG: { ...initiationSettings(env).VNPAY_INITIATION_CONFIG, hashSecret: '' } },
  { NODE_ENV: 'development' }, { NODE_ENV: 'production' }, { VNPAY_INITIATION_TEST_ONLY: 'false' },
  { TEST_DATABASE_URL: '' }, { DATABASE_URL: 'postgresql://fixture:fixture@localhost/brewlite_dev' }])('disabled/invalid config fails closed %j', async changes => {
  for (const [k, v] of Object.entries(changes)) settings.set(k, v);
  const r = await get().expect(503); expect((r.body as { error: { code: string } }).error.code).toBe('PAYMENT_UNAVAILABLE');
  expect(JSON.stringify(r.body)).not.toMatch(/MOCK|TEST0001|synthetic-b2a|postgresql/);
});
test('missing and invalid JWT401', async () => {
  await request(app.getHttpServer()).get('/payments/config').expect(401);
  await request(app.getHttpServer()).get('/payments/config').set('Authorization', 'Bearer invalid').expect(401);
});
test.each(['STAFF', 'ADMIN'])('DB role%s overrides token role403', async value => { role = value; await get().expect(403); });
test('deleted identity401', async () => { lookup.mockResolvedValue(null); await get().expect(401); });
test('strict query/body; no provider override', async () => {
  await get().query({ providerMode: 'MOCK' }).expect(400); await get().send({ providerMode: 'MOCK' }).expect(400);
});
test('route does not capture existing paths', async () => {
  await request(app.getHttpServer()).post('/payments').expect(401);
  await request(app.getHttpServer()).get('/payments/attempts/' + randomUUID()).expect(401);
  await request(app.getHttpServer()).post('/payments/vnpay/attempts').expect(401);
});
