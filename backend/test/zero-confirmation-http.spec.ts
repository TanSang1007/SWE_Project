import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { ZeroConfirmationService } from '../src/payments/zero-confirmation.service';
const customer = randomUUID(), order = randomUUID();
const db = { user: { findUnique: jest.fn() } };
const confirm = jest.fn(); let app: NestExpressApplication, jwt: JwtService;
const body = { payment: { id: randomUUID(), orderId: order, provider: 'INTERNAL_ZERO', method: 'ZERO_TOTAL', status: 'SUCCEEDED', amount: '0' } };
beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db)
    .overrideProvider(ConfigService).useValue(new ConfigService({ JWT_SECRET: 'synthetic-b2c2-unit-jwt-key-at-least-32-bytes', JWT_EXPIRES_IN: 3600, FRONTEND_ORIGIN: 'http://localhost:3000', PAYMENT_PROVIDER_MODE: 'MOCK' }))
    .overrideProvider(ZeroConfirmationService).useValue({ confirm }).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
});
beforeEach(() => { confirm.mockReset(); confirm.mockResolvedValue({ body, replayed: false }); db.user.findUnique.mockResolvedValue({ id: customer, role: 'CUSTOMER' }); });
afterAll(async () => { await app.close(); });
const call = () => request(app.getHttpServer()).post(`/orders/${order}/confirm-zero`).set('Authorization', 'Bearer ' + jwt.sign({ sub: customer })).set('Idempotency-Key', 'zero-key');
test('CUSTOMER route delegates server-owned order/key and returns no-store normalized response', async () => {
  const r = await call().send({}).expect(200); expect(r.body).toEqual(body); expect(confirm).toHaveBeenCalledWith(customer, 'zero-key', order);
  expect(r.headers['cache-control']).toBe('private, no-store, max-age=0'); expect(r.headers.vary).toContain('Authorization');
});
test('exact replay header is exposed', async () => { confirm.mockResolvedValue({ body, replayed: true }); const r = await call().send({}).expect(200); expect(r.headers['idempotency-replayed']).toBe('true'); });
test('missing JWT denies before service', async () => { await request(app.getHttpServer()).post(`/orders/${order}/confirm-zero`).send({}).expect(401); expect(confirm).not.toHaveBeenCalled(); });
test.each(['ADMIN', 'STAFF', 'INVALID'])('DB role %s denies despite forged CUSTOMER claim', async role => {
  db.user.findUnique.mockResolvedValue({ id: customer, role }); await call().send({}).expect(403); expect(confirm).not.toHaveBeenCalled();
});
test.each([{ amount: '0' }, { status: 'PAID' }, { provider: 'INTERNAL_ZERO' }, { outcome: 'SUCCESS' }, []])('strict body rejects %j', async input => {
  await call().send(input).expect(400); expect(confirm).not.toHaveBeenCalled();
});
test('unknown query rejects', async () => { await call().query({ amount: '0' }).send({}).expect(400); expect(confirm).not.toHaveBeenCalled(); });
test('non-JSON framed body rejects', async () => { await call().set('Content-Type', 'text/plain').send('ignored').expect(400); expect(confirm).not.toHaveBeenCalled(); });
test('malformed JSON rejects', async () => { await call().set('Content-Type', 'application/json').send('{').expect(400); expect(confirm).not.toHaveBeenCalled(); });
test('invalid UUID rejects', async () => { await request(app.getHttpServer()).post('/orders/not-uuid/confirm-zero').set('Authorization', 'Bearer ' + jwt.sign({ sub: customer })).send({}).expect(400); expect(confirm).not.toHaveBeenCalled(); });
