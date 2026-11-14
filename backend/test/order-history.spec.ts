import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { Prisma } from '../src/generated/prisma/client';

describe('B15 owned Order reads', () => {
  let app: NestExpressApplication; let jwt: JwtService;
  const owner = randomUUID(); const other = randomUUID(); const id = randomUUID();
  const user = { findUnique: jest.fn() };
  const order = { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() };
  const row = (status: string = 'PAID', points: number | null = 9) => ({ id, orderCode: 'BL-fixture', status, userId: owner, version: 1,
    redeemedPoints: 0, loyaltyDiscountAmount: new Prisma.Decimal('0'), redemptionState: 'NONE', reservationCycle: 0, total: new Prisma.Decimal('95000'), subtotal: new Prisma.Decimal('105000'), discountAmount: new Prisma.Decimal('10000'),
    createdAt: new Date('2026-10-07T00:00:00Z'), paidAt: status === 'PAID' ? new Date('2026-10-07T00:01:00Z') : null,
    promotionCodeSnapshot: 'SNAPSHOT', loyaltyAward: points === null ? null : { points, reversedAt: null as Date | null },
    payments: [{ status: 'SUCCEEDED', idempotencyKey: 'private', userId: owner }], items: [{ productId: id, productNameSnapshot: 'Historical drink', size: 'M', qty: 1,
      unitPrice: new Prisma.Decimal('105000'), lineTotal: new Prisma.Decimal('105000'), toppings: [{ toppingNameSnapshot: 'Cream', priceSnapshot: new Prisma.Decimal('5000') }] }] });
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://demo:example@localhost:5432/brewlite';
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({ user, order }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => {
    jest.clearAllMocks(); user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(
      [owner, other].some((id) => id === where.id) ? { id: where.id, email: 'fixture@example.invalid', loyaltyPoints: 0, role: 'CUSTOMER' } : null));
    order.findMany.mockResolvedValue([]); order.findFirst.mockResolvedValue(null);
  });
  afterEach(() => { expect(order.create).not.toHaveBeenCalled(); expect(order.update).not.toHaveBeenCalled(); expect(order.updateMany).not.toHaveBeenCalled(); });
  afterAll(async () => { await app.close(); });
  const get = (path = '/orders/me', userId: string = owner) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${jwt.sign({ sub: userId })}`);
  it('routes /me before /:id and returns empty without creating Order/Cart', async () => {
    expect((await get().expect(200)).body).toEqual({ items: [] }); expect(order.findFirst).not.toHaveBeenCalled();
  });
  it('projects exact summary fields and delegates stable native sorting/owner filtering to PostgreSQL', async () => {
    order.findMany.mockResolvedValue([row()]); const r = await get().set('Origin', 'http://localhost:3000').expect(200);
    expect(r.body).toEqual({ items: [{ id, orderCode: 'BL-fixture', status: 'PAID', total: '95000', redeemedPoints: 0, loyaltyDiscountAmount: '0', redemptionState: 'NONE', currency: 'VND', createdAt: '2026-10-07T00:00:00.000Z', earnedPoints: 9 }] });
    expect(order.findMany).toHaveBeenCalledWith({ where: { userId: owner }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, orderCode: true, status: true, total: true, redeemedPoints: true, loyaltyDiscountAmount: true, redemptionState: true, createdAt: true, loyaltyAward: { select: { points: true, reversedAt: true } } } });
    expect(r.headers['cache-control']).toBe('private, no-store, max-age=0'); expect(r.headers.vary).toMatch(/Authorization/); expect(r.headers.vary).toMatch(/Origin/);
    expect(r.text).not.toMatch(/userId|version|idempotencyKey|passwordHash|payments/);
  });
  it.each(['PENDING', 'PAYMENT_FAILED', 'PAID', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'])('keeps current status %s and effective earnedPoints', async (status) => {
    const unpaid = ['PENDING', 'PAYMENT_FAILED'].includes(status); order.findMany.mockResolvedValue([row(status, unpaid ? null : 9)]);
    expect((await get().expect(200)).body).toMatchObject({ items: [{ status, earnedPoints: status === 'CANCELLED' ? 0 : unpaid ? null : 9 }] });
  });
  it('preserves zero-point awards and reversed contribution without recalculating', async () => {
    const reversed = row(); reversed.loyaltyAward = { points: 9, reversedAt: new Date() };
    order.findMany.mockResolvedValue([row('PAID', 0), reversed]);
    expect((await get().expect(200)).body).toMatchObject({ items: [{ earnedPoints: 0 }, { earnedPoints: 0 }] });
  });
  it('keeps maximum money strings exact and fresh results on re-fetch', async () => {
    order.findMany.mockResolvedValueOnce([{ ...row(), total: new Prisma.Decimal('999999999999') }]).mockResolvedValueOnce([]);
    expect((await get().expect(200)).body).toMatchObject({ items: [{ total: '999999999999' }] }); expect((await get().expect(200)).body).toEqual({ items: [] });
  });
  it.each(['/orders/me', '/orders/active', `/orders/${id}`])('requires valid JWT on %s', async (path) => {
    for (const token of [undefined, 'invalid', jwt.sign({ sub: owner }, { expiresIn: -1 }), jwt.sign({ sub: randomUUID() })]) {
      const r = request(app.getHttpServer()).get(path); if (token) r.set('Authorization', `Bearer ${token}`); await r.expect(401);
    }
    expect(order.findMany).not.toHaveBeenCalled(); expect(order.findFirst).not.toHaveBeenCalled();
  });
  it.each(['userId', 'status', 'limit', 'offset', 'cursor', 'total'])('rejects unsupported history query %s', async (field) => {
    await get().query({ [field]: other }).expect(400); expect(order.findMany).not.toHaveBeenCalled();
  });
  it('rejects client body data, invalid UUID and owner/detail query fields', async () => {
    await get().send({ userId: other, status: 'PAID' }).expect(400); await get(`/orders/${id}`).send({ total: '1' }).expect(400);
    await get(`/orders/${id}`).query({ userId: other }).expect(400); await get('/orders/not-an-id').expect(400);
  });
  it('uses JWT owner for history and common404 for missing/cross-owner detail', async () => {
    await get('/orders/me', other).expect(200); expect(order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: other } }));
    const r = await get(`/orders/${id}`, other).expect(404); expect(r.body).toMatchObject({ error: { code: 'ORDER_NOT_FOUND' } });
    expect(order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id, userId: other } }));
  });
  it('routes /active before the UUID route and reads only the authenticated owner', async () => {
    const empty = await get('/orders/active').set('Origin', 'http://localhost:3000').expect(200);
    expect(empty.body).toEqual({ order: null, serverNow: expect.any(String) as unknown });
    expect(empty.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(empty.headers.vary).toMatch(/Authorization/); expect(empty.headers.vary).toMatch(/Origin/);
    order.findFirst.mockResolvedValue(row('PENDING', null));
    const active = await get('/orders/active').expect(200);
    expect(active.body).toMatchObject({ order: { id, status: 'PENDING', total: '95000' } });
    expect(order.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { userId: owner, status: { in: ['PENDING', 'PAYMENT_FAILED'] } } }));
    expect(active.text).not.toMatch(/userId|version|idempotencyKey|passwordHash/);
  });
  it('rejects active-order body and owner query injection before querying Orders', async () => {
    await get('/orders/active').query({ userId: other }).expect(400);
    await get('/orders/active').send({ userId: other }).expect(400);
    expect(order.findFirst).not.toHaveBeenCalled();
  });
  it.each(['STAFF', 'ADMIN'])('rejects current DB role %s on customer active-order discovery', async role => {
    user.findUnique.mockResolvedValue({ id: owner, email: 'fixture@example.invalid', role, loyaltyPoints: 0 });
    await get('/orders/active').expect(403);
    expect(order.findFirst).not.toHaveBeenCalled();
  });
  it('reuses immutable detail snapshot and exposes only contract payment/points metadata', async () => {
    order.findFirst.mockResolvedValue(row()); const r = await get(`/orders/${id}`).expect(200);
    expect(r.body).toMatchObject({ total: '95000', discountAmount: '10000', promotionCode: 'SNAPSHOT', paidAt: '2026-10-07T00:01:00.000Z', earnedPoints: 9,
      paymentStatus: 'SUCCEEDED', items: [{ productName: 'Historical drink', unitPrice: '105000', toppings: [{ name: 'Cream', price: '5000' }] }] });
    expect(r.text).not.toMatch(/userId|version|idempotencyKey|passwordHash/); expect(r.headers['cache-control']).toContain('no-store');
  });
  it.each(['/orders/me', '/orders/active', `/orders/${id}`])('sanitizes database read faults on %s', async (path) => {
    const fault = new Error('Prisma SELECT credential password_hash'); order.findMany.mockRejectedValue(fault); order.findFirst.mockRejectedValue(fault);
    const r = await get(path).expect(503); expect(r.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Internal server error' } });
    expect(r.text).not.toMatch(/Prisma|SELECT|credential|password_hash/);
  });
});
