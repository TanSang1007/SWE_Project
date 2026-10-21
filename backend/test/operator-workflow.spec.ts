import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { OrderService } from '../src/orders/order.service';

describe('A03 authorized workflow wrappers', () => {
  let app: NestExpressApplication; let jwt: JwtService; let role = 'STAFF';
  const actor = randomUUID(); const id = randomUUID(); const user = { findUnique: jest.fn() }; const transitionOrder = jest.fn();
  const paths = [`/operator/orders/${id}/transitions`, `/admin/orders/${id}/paid-cancel`];
  const body = { expectedVersion: 3, targetStatus: 'PREPARING' };
  const post = (path = paths[0], token = jwt.sign({ sub: actor })) => request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://demo:example@localhost:5432/brewlite';
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({ user })
      .overrideProvider(OrderService).useValue({ transitionOrder }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => { jest.clearAllMocks(); role = 'STAFF'; user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(where.id === actor ? { id: actor, role } : null)); transitionOrder.mockResolvedValue({ id, status: 'PREPARING', total: '120000' }); });
  afterAll(async () => { await app.close(); });
  it.each(['STAFF', 'ADMIN'])('%s calls exact B16 signature with original expectedVersion, response unchanged/no version', async (value) => {
    role = value; const r = await post(paths[0].replace(id, id.toUpperCase())).set('Origin', 'http://localhost:3000').send(body).expect(200);
    expect(transitionOrder).toHaveBeenCalledTimes(1); expect(transitionOrder).toHaveBeenCalledWith(id, 3, 'PREPARING');
    expect(r.body).toEqual({ id, status: 'PREPARING', total: '120000' }); expect(r.headers['cache-control']).toContain('no-store'); expect(r.headers.vary).toMatch(/Authorization/); expect(r.headers.vary).toMatch(/Origin/);
  });
  it.each(['PREPARING', 'READY', 'COMPLETED'])('valid DTO target %s delegates B16 graph enforcement', async (targetStatus) => {
    await post().send({ expectedVersion: 0, targetStatus }).expect(200); expect(transitionOrder).toHaveBeenCalledWith(id, 0, targetStatus);
  });
  it('ADMIN cancellation passes only CANCELLED and original version, even repeated CANCELLED', async () => {
    role = 'ADMIN'; transitionOrder.mockResolvedValue({ id, status: 'CANCELLED', paymentStatus: 'SUCCEEDED', earnedPoints: 0 });
    for (let n = 0; n < 2; n++) await post(paths[1]).send({ expectedVersion: 3 }).expect(200);
    expect(transitionOrder).toHaveBeenNthCalledWith(1, id, 3, 'CANCELLED'); expect(transitionOrder).toHaveBeenNthCalledWith(2, id, 3, 'CANCELLED');
  });
  it.each(paths)('auth required for %s', async (path) => {
    await request(app.getHttpServer()).post(path).send(body).expect(401);
    for (const token of ['invalid', jwt.sign({ sub: actor }, { expiresIn: -1 }), jwt.sign({ sub: randomUUID() })]) await post(path, token).send(body).expect(401);
    expect(transitionOrder).not.toHaveBeenCalled();
  });
  it.each(paths)('CUSTOMER/forged ADMIN/header cannot elevate on %s', async (path) => {
    role = 'CUSTOMER'; await post(path).send(body).expect(403);
    await post(path, jwt.sign({ sub: actor, role: 'ADMIN' })).set('X-Role', 'ADMIN').send(body).expect(403); expect(transitionOrder).not.toHaveBeenCalled();
  });
  it('STAFF paid-cancel denied before validation/lookup, including cancelled/missing resource', async () => {
    await post(paths[1]).send({ expectedVersion: 3 }).expect(403); await post('/admin/orders/invalid/paid-cancel').send({ expectedVersion: -1 }).expect(403);
    expect(transitionOrder).not.toHaveBeenCalled();
  });
  it('same JWT obeys current DB role changes', async () => {
    const token = jwt.sign({ sub: actor, role: 'ADMIN' }); role = 'ADMIN'; await post(paths[1], token).send({ expectedVersion: 3 }).expect(200);
    role = 'STAFF'; await post(paths[1], token).send({ expectedVersion: 3 }).expect(403); await post(paths[0], token).send(body).expect(200);
    role = 'CUSTOMER'; await post(paths[0], token).send(body).expect(403); expect(transitionOrder).toHaveBeenCalledTimes(2);
  });
  it.each([-1, 2147483648, 1.5, '3', null, undefined])('invalid version %p does not invoke engine', async (expectedVersion) => {
    role = 'ADMIN'; await post().send({ expectedVersion, targetStatus: 'PREPARING' }).expect(400); await post(paths[1]).send({ expectedVersion }).expect(400); expect(transitionOrder).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'PAID', 'PAYMENT_FAILED', 'CANCELLED', 'UNKNOWN', null, undefined])('invalid target %p is400, never a generic status setter', async (targetStatus) => {
    await post().send({ expectedVersion: 3, targetStatus }).expect(400); expect(transitionOrder).not.toHaveBeenCalled();
  });
  it.each(['userId', 'role', 'total', 'subtotal', 'stock', 'loyaltyPoints', 'paymentStatus'])('rejects extra %s', async (field) => {
    role = 'ADMIN'; await post().send({ ...body, [field]: 'untrusted' }).expect(400); await post(paths[1]).send({ expectedVersion: 3, [field]: 'untrusted' }).expect(400); expect(transitionOrder).not.toHaveBeenCalled();
  });
  it('empty query/UUID validation/cancel target rejection are enforced', async () => {
    role = 'ADMIN'; await post().query({ expectedVersion: 3 }).send(body).expect(400); await post(paths[1]).query({ userId: actor }).send({ expectedVersion: 3 }).expect(400);
    await post('/operator/orders/invalid/transitions').send(body).expect(400); await post(paths[1]).send(body).expect(400); expect(transitionOrder).not.toHaveBeenCalled();
  });
  it.each(['INVALID_ORDER_STATE', 'CONCURRENT_UPDATE'])('preserves B16 %s409 and does not retry', async (code) => {
    transitionOrder.mockRejectedValue(new ConflictException({ code, message: 'Reload and confirm' })); const r = await post().send(body).expect(409);
    expect(r.body).toMatchObject({ error: { code } }); expect(transitionOrder).toHaveBeenCalledTimes(1);
  });
  it('missing Order404 passes through', async () => {
    transitionOrder.mockRejectedValue(new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order not found' })); expect((await post().send(body).expect(404)).body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });
  });
  it('technical engine error sanitized503, auth DB error sanitized500', async () => {
    transitionOrder.mockRejectedValue(new ServiceUnavailableException('SQL secret private')); const r = await post().send(body).expect(503); expect(r.text).not.toMatch(/SQL|secret|private/);
    user.findUnique.mockRejectedValue(new Error('SQL passwordHash')); const auth = await post().send(body).expect(500); expect(auth.text).not.toMatch(/SQL|passwordHash/);
  });
});
