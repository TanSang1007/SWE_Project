import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import type { OrderService } from '../src/orders/order.service';
const summaries = (res: { body: unknown }) => (res.body as Awaited<ReturnType<OrderService['operatorHistory']>>).items;

describe('A02 operator read contract and authorization', () => {
  let app: NestExpressApplication; let jwt: JwtService;
  const actor = randomUUID(); const id = randomUUID(); const owner = randomUUID();
  let role = 'STAFF';
  const user = { findUnique: jest.fn() };
  const order = { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() };
  const row = (status = 'PAID') => ({ id, userId: owner, orderCode: 'BL-fixture', status, version: 7,
    redeemedPoints: 0, loyaltyDiscountAmount: new Prisma.Decimal('0'), redemptionState: 'NONE', reservationCycle: 0, total: new Prisma.Decimal('95000'), subtotal: new Prisma.Decimal('105000'), discountAmount: new Prisma.Decimal('10000'),
    createdAt: new Date('2026-10-07T00:00:00Z'), updatedAt: new Date('2026-10-09T00:01:00Z'), paidAt: new Date('2026-10-07T00:01:00Z'),
    promotionCodeSnapshot: 'SNAPSHOT', loyaltyAward: { points: 9, reversedAt: null as Date | null },
    payments: [{ status: 'SUCCEEDED', idempotencyKey: 'private', userId: owner }],
    items: [{ productId: id, productNameSnapshot: 'Historical drink', size: 'M', qty: 1, unitPrice: new Prisma.Decimal('105000'),
      lineTotal: new Prisma.Decimal('105000'), toppings: [{ toppingNameSnapshot: 'Cream', priceSnapshot: new Prisma.Decimal('5000') }] }] });
  const summaryKeys = ['redeemedPoints','loyaltyDiscountAmount','redemptionState','estimatedEarnedPoints','id', 'orderCode', 'status', 'total', 'currency', 'createdAt', 'earnedPoints', 'version', 'updatedAt'].sort();
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://demo:example@localhost:5432/brewlite';
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({ user, order }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => {
    jest.clearAllMocks(); role = 'STAFF';
    user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === actor ? { id: actor, role } : null));
    order.findMany.mockResolvedValue([]); order.findUnique.mockResolvedValue(null); order.findFirst.mockResolvedValue(null);
  });
  afterEach(() => { for (const method of [order.create, order.update, order.updateMany]) expect(method).not.toHaveBeenCalled(); });
  afterAll(async () => { await app.close(); });
  const get = (path = '/operator/orders', token = jwt.sign({ sub: actor })) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token}`);
  it.each(['STAFF', 'ADMIN'])('%s list all owners with exact summary/private cache headers', async (value) => {
    role = value; order.findMany.mockResolvedValue([row()]);
    const r = await get().set('Origin', 'http://localhost:3000').expect(200);
    expect(Object.keys(summaries(r)[0]).sort()).toEqual(summaryKeys);
    expect(summaries(r)[0]).toMatchObject({ version: 7, updatedAt: '2026-10-09T00:01:00.000Z', total: '95000', earnedPoints: 9 });
    expect(order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: value === 'ADMIN' ? {} : { status: { in: ['PAID', 'PREPARING', 'READY'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
    expect(r.headers['cache-control']).toBe('private, no-store, max-age=0'); expect(r.headers.vary).toMatch(/Authorization/); expect(r.headers.vary).toMatch(/Origin/);
    expect(r.text).not.toMatch(/userId|email|passwordHash|idempotencyKey|payments|loyaltyAward/);
  });
  it('returns empty list and multiple independent orders without owner lookup', async () => {
    expect((await get().expect(200)).body).toEqual({ items: [] });
    order.findMany.mockResolvedValue([row(), { ...row('READY'), id: randomUUID() }]); expect(summaries(await get().expect(200))).toHaveLength(2);
    expect(order.findFirst).not.toHaveBeenCalled();
  });
  it.each(['PENDING', 'PAYMENT_FAILED', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'])('filters exact status %s and reads current revision', async (status) => {
    role = 'ADMIN';
    order.findMany.mockResolvedValue([row(status)]); const r = await get().query({ status }).expect(200);
    expect(summaries(r)[0]).toMatchObject({ status, version: 7, earnedPoints: status === 'CANCELLED' ? 0 : 9 });
    expect(order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status } }));
  });
  it.each(['/operator/orders', `/operator/orders/${id}`])('requires valid JWT on %s, including expired/deleted user', async (path) => {
    await request(app.getHttpServer()).get(path).expect(401);
    for (const token of ['invalid', jwt.sign({ sub: actor }, { expiresIn: -1 }), jwt.sign({ sub: randomUUID() })]) await get(path, token).expect(401);
    expect(order.findMany).not.toHaveBeenCalled(); expect(order.findUnique).not.toHaveBeenCalled();
  });
  it.each(['/operator/orders', `/operator/orders/${id}`, '/operator/orders/not-a-uuid'])('CUSTOMER denied before validation/resource lookup on %s', async (path) => {
    role = 'CUSTOMER'; await get(path).expect(403); await get(path, jwt.sign({ sub: actor, role: 'ADMIN' })).expect(403);
    expect(order.findMany).not.toHaveBeenCalled(); expect(order.findUnique).not.toHaveBeenCalled();
  });
  it('database role is authoritative on every request using the same token', async () => {
    const token = jwt.sign({ sub: actor, role: 'ADMIN' }); await get('/operator/orders', token).expect(200);
    role = 'CUSTOMER'; await get('/operator/orders', token).expect(403); role = 'ADMIN'; await get('/operator/orders', token).expect(200);
    expect(user.findUnique).toHaveBeenCalledTimes(3);
  });
  it.each(['', 'paid', 'UNKNOWN', ['PAID', 'READY'], null])('rejects invalid/multiple status %p', async (status) => {
    await get().query({ status }).expect(400); expect(order.findMany).not.toHaveBeenCalled();
  });
  it.each(['limit', 'offset', 'cursor', 'userId', 'sort', 'search'])('rejects unsupported list field %s', async (field) => {
    await get().query({ [field]: '1' }).expect(400); expect(order.findMany).not.toHaveBeenCalled();
  });
  it('rejects body, invalid UUID and detail query input', async () => {
    await get().send({ status: 'PAID' }).expect(400); await get('/operator/orders/invalid').expect(400);
    await get(`/operator/orders/${id}`).send({ version: 1 }).expect(400); await get(`/operator/orders/${id}`).query({ status: 'PAID' }).expect(400);
  });
  it.each(['STAFF', 'ADMIN'])('%s detail reuses exact immutable snapshot and payment/promotion projection', async (value) => {
    role = value; order.findFirst.mockResolvedValue(row()); const r = await get(`/operator/orders/${id.toUpperCase()}`).expect(200);
    expect(r.body).toEqual({ id, orderCode: 'BL-fixture', status: 'PAID', currency: 'VND', items: [{ productId: id, productName: 'Historical drink', size: 'M', qty: 1,
      unitPrice: '105000', lineTotal: '105000', toppings: [{ name: 'Cream', price: '5000' }] }], subtotal: '105000', discountAmount: '10000', total: '95000',
      redeemedPoints: 0, loyaltyDiscountAmount: '0', redemptionState: 'NONE', estimatedEarnedPoints: 9, promotionCode: 'SNAPSHOT', createdAt: '2026-10-07T00:00:00.000Z', paidAt: '2026-10-07T00:01:00.000Z', earnedPoints: 9, paymentStatus: 'SUCCEEDED',
      version: 7, updatedAt: '2026-10-09T00:01:00.000Z' });
    expect(order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: value === 'ADMIN' ? { id } : { id, status: { in: ['PAID', 'PREPARING', 'READY', 'COMPLETED'] } } }));
    expect(r.text).not.toMatch(/userId|email|passwordHash|idempotencyKey|payments|loyaltyAward/);
  });
  it('missing order uses ORDER_NOT_FOUND, after authorization', async () => {
    expect((await get(`/operator/orders/${id}`).expect(404)).body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });
  });
  it('preserves unpaid null, zero award, reversed award and current latest payment status', async () => {
    role = 'ADMIN'; order.findFirst.mockResolvedValue({ ...row('PAYMENT_FAILED'), loyaltyAward: null, payments: [{ status: 'FAILED' }] });
    expect((await get(`/operator/orders/${id}`).expect(200)).body).toMatchObject({ earnedPoints: null, paymentStatus: 'FAILED' });
    order.findMany.mockResolvedValue([{ ...row(), loyaltyAward: { points: 0, reversedAt: null } }, { ...row(), loyaltyAward: { points: 9, reversedAt: new Date() } }]);
    expect(summaries(await get().expect(200)).map((o) => o.earnedPoints)).toEqual([0, 0]);
  });
  it.each(['/operator/orders', `/operator/orders/${id}`])('sanitizes database errors on %s', async (path) => {
    const fault = new Error('SQL Prisma passwordHash private-key'); order.findMany.mockRejectedValue(fault); order.findFirst.mockRejectedValue(fault);
    const r = await get(path).expect(503); expect(r.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Internal server error' } }); expect(r.text).not.toMatch(/SQL|Prisma|passwordHash|private-key/);
  });
  it('keeps auth database errors sanitized500', async () => {
    user.findUnique.mockRejectedValue(new Error('SQL private-secret')); const r = await get().expect(500); expect(r.text).not.toMatch(/SQL|private-secret/);
  });
  it.each(['PAID', 'PREPARING', 'READY', 'COMPLETED'])('STAFF exact %s filter remains readable', async status => {
    order.findMany.mockResolvedValue([row(status)]); await get().query({ status }).expect(200);
    expect(order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status } }));
  });
  it.each(['PENDING', 'PAYMENT_FAILED', 'CANCELLED'])('STAFF cannot bypass %s scope with signed role claim or header', async status => {
    await get('/operator/orders', jwt.sign({ sub: actor, role: 'ADMIN' })).set('X-Role', 'ADMIN').query({ status }).expect(403);
    expect(order.findMany).not.toHaveBeenCalled();
    order.findFirst.mockResolvedValue(null);
    const r = await get(`/operator/orders/${id}`, jwt.sign({ sub: actor, role: 'ADMIN' })).set('X-Role', 'ADMIN').expect(404);
    expect(r.body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });
    expect(order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, status: { in: ['PAID', 'PREPARING', 'READY', 'COMPLETED'] } } }));
  });
  it.each(['PENDING', 'PAYMENT_FAILED', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'])('ADMIN detail reads %s', async status => {
    role = 'ADMIN'; order.findFirst.mockResolvedValue(row(status)); await get(`/operator/orders/${id}`).expect(200);
    expect(order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id } }));
  });
  it('does not expose generic customer status/debug; ADMIN CRUD denies STAFF', async () => {
    for (const path of [`/orders/${id}/transitions`, '/__auth_verify/operator'])
      await request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${jwt.sign({ sub: actor })}`).send({ expectedVersion: 7 }).expect(404);
    await request(app.getHttpServer()).post('/admin/products').set('Authorization', `Bearer ${jwt.sign({ sub: actor })}`).send({ expectedVersion: 7 }).expect(403);
  });
});
