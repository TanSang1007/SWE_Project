import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/database/prisma.service';

describe('Loyalty balance HTTP contract', () => {
  let app: NestExpressApplication; let jwt: JwtService;
  const a = randomUUID(); const b = randomUUID();
  const balances = new Map<string, number>([[a, 9], [b, 0]]);
  const user = { findUnique: jest.fn() };
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://demo:example@localhost:5432/brewlite';
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({user,$transaction:async (work: (tx: unknown)=>Promise<unknown>)=>work({user,$executeRawUnsafe:jest.fn().mockResolvedValue(0),order:{aggregate:jest.fn().mockResolvedValue({_sum:{redeemedPoints:0}})}})}).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => {
    jest.clearAllMocks(); balances.set(a, 9); balances.set(b, 0);
    user.findUnique.mockImplementation(({ where, select }: { where: { id: string }; select: { id?: boolean } }) => {
      const points = balances.get(where.id);
      return Promise.resolve(points === undefined ? null : select.id ? { id: where.id, email: 'fixture@example.invalid', loyaltyPoints: points, role: 'CUSTOMER' } : { loyaltyPoints: points, loyaltyDebt: 0n });
    });
  });
  afterAll(async () => { await app.close(); });
  const get = (id = a) => request(app.getHttpServer()).get('/loyalty').set('Authorization', `Bearer ${jwt.sign({ sub: id })}`);
  it('reads only stored owner balance, whitelists response and prevents shared/browser caching', async () => {
    const r = await get().set('Origin', 'http://localhost:3000').expect(200);
    expect(r.body).toEqual({ loyaltyPoints: 9, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" }); expect(r.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(r.headers.vary).toMatch(/Authorization/); expect(r.headers.vary).toMatch(/Origin/);
    expect(user.findUnique).toHaveBeenLastCalledWith({ where: { id: a }, select: { loyaltyPoints: true, loyaltyDebt: true } });
  });
  it('returns zero for user with no points and isolates another authenticated user', async () => {
    expect((await get(b).expect(200)).body).toEqual({ loyaltyPoints: 0, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
    expect((await get().expect(200)).body).toEqual({ loyaltyPoints: 9, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
  });
  it('fresh reads observe persisted updates rather than login/JWT snapshots', async () => {
    await get().expect(200); balances.set(a, 18);
    expect((await get().expect(200)).body).toEqual({ loyaltyPoints: 18, reservedPoints: 0, outstandingReversalPoints: "0", pointValueVnd: "100" });
  });
  it.each(['', 'Bearer invalid', 'Basic invalid'])('rejects unauthorized header %s', async (header) => {
    await request(app.getHttpServer()).get('/loyalty').set('Authorization', header).expect(401);
    expect(user.findUnique).not.toHaveBeenCalled();
  });
  it('rejects expired JWT and unknown user', async () => {
    const expired = jwt.sign({ sub: a }, { expiresIn: -1 });
    await request(app.getHttpServer()).get('/loyalty').set('Authorization', `Bearer ${expired}`).expect(401);
    await get(randomUUID()).expect(401);
  });
  it.each(['userId', 'loyaltyPoints', 'limit'])('rejects query option %s without reading another user', async (field) => {
    await get().query({ [field]: b }).expect(400);
    expect(user.findUnique).toHaveBeenCalledTimes(1); // Only existing authentication lookup.
  });
  it('rejects injected body and has no per-user/history/write endpoints', async () => {
    await get().send({ userId: b, loyaltyPoints: 100 }).expect(400);
    await request(app.getHttpServer()).get(`/loyalty/${b}`).expect(404);
    await request(app.getHttpServer()).get('/loyalty/history').expect(404);
    await request(app.getHttpServer()).post('/loyalty').send({ loyaltyPoints: 100 }).expect(404);
  });
  it('sanitizes database errors during balance read and guard lookup', async () => {
    const failure = new Error('Prisma SELECT password_hash PostgreSQL credential');
    user.findUnique.mockImplementation(({ select }: { select: { id?: boolean } }) => select.id
      ? Promise.resolve({ id: a, email: 'fixture@example.invalid', loyaltyPoints: 9, role: 'CUSTOMER' }) : Promise.reject(failure));
    const result = await get().expect(503); expect(result.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(result.text).not.toMatch(/Prisma|SELECT|password|credential|PostgreSQL/);
    user.findUnique.mockRejectedValue(failure);
    const guard = await get().expect(500); expect(guard.text).not.toMatch(/Prisma|SELECT|password|credential|PostgreSQL/);
  });
  it('returns401 if the user disappears between authentication and the balance read', async () => {
    user.findUnique.mockResolvedValueOnce({ id: a, email: 'fixture@example.invalid', loyaltyPoints: 9, role: 'CUSTOMER' }).mockResolvedValueOnce(null);
    await get().expect(401);
  });
});
