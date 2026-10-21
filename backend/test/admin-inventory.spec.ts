import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AdminInventoryService } from '../src/catalog/admin-inventory.service';
import { configureApp } from '../src/common/configure-app';
describe('A06 HTTP contract', () => {
  let app: NestExpressApplication, jwt: JwtService, role = 'ADMIN'; const actor = randomUUID(), product = randomUUID();
  const user = { findUnique: jest.fn() }, inventory = { list: jest.fn(), adjust: jest.fn() };
  const post = (body: object, id: string = product) => request(app.getHttpServer()).post(`/admin/products/${id}/inventory-adjustments`).set('Authorization', `Bearer ${jwt.sign({ sub: actor, role: 'ADMIN' })}`).set('Idempotency-Key', 'fixture').send(body);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({ user }).overrideProvider(AdminInventoryService).useValue(inventory).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => { jest.clearAllMocks(); role = 'ADMIN'; user.findUnique.mockResolvedValue({ id: actor, role }); inventory.list.mockResolvedValue({ items: [] }); inventory.adjust.mockResolvedValue({ body: { productId: product }, replayed: true, status: 200 }); });
  afterAll(async () => { await app.close(); });
  test('normalized UUID/original signed delta/version and exact replay delegation/private headers', async () => {
    const r = await post({ delta: -2, expectedVersion: 7 }, product.toUpperCase()).set('Origin', 'http://localhost:3000').expect(200);
    expect(inventory.adjust).toHaveBeenCalledWith(actor, product, 'fixture', { delta: -2, expectedVersion: 7 });
    expect(r.headers['idempotency-replayed']).toBe('true'); expect(r.headers['cache-control']).toContain('no-store'); expect(r.headers.vary).toMatch(/Authorization/);
  });
  test.each([{}, { delta: 0, expectedVersion: 0 }, { delta: '1', expectedVersion: 0 }, { delta: 1.1, expectedVersion: 0 }, { delta: 1, expectedVersion: null }, { delta: 1, expectedVersion: '0' }, { delta: 1, expectedVersion: 2147483648 }, { delta: 1, expectedVersion: 0, stock: 10 }, { delta: 1, expectedVersion: 0, userId: actor }])('rejects invalid DTO %p before service', async body => { await post(body).expect(400); expect(inventory.adjust).not.toHaveBeenCalled(); });
  test.each(['STAFF', 'CUSTOMER'])('DB role %s overrides forged JWT and denies before replay', async value => {
    role = value; user.findUnique.mockResolvedValue({ id: actor, role }); await post({ delta: 1, expectedVersion: 0 }).expect(403);
    await request(app.getHttpServer()).get('/admin/inventory').set('Authorization', `Bearer ${jwt.sign({ sub: actor, role: 'ADMIN' })}`).expect(403);
    expect(inventory.list).not.toHaveBeenCalled(); expect(inventory.adjust).not.toHaveBeenCalled();
  });
  test('guest/invalid/expired/deleted-user JWT cannot access either route', async () => {
    for (const token of ['', 'invalid', jwt.sign({ sub: actor }, { expiresIn: -1 })]) {
      await request(app.getHttpServer()).get('/admin/inventory').set('Authorization', `Bearer ${token}`).expect(401);
      await request(app.getHttpServer()).post(`/admin/products/${product}/inventory-adjustments`).set('Authorization', `Bearer ${token}`).send({ delta: 1, expectedVersion: 0 }).expect(401);
    }
    user.findUnique.mockResolvedValue(null); await post({ delta: 1, expectedVersion: 0 }).expect(401);
  });
  test('GET rejects filters/body and has no mutation delegation', async () => {
    const call = (path: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${jwt.sign({ sub: actor })}`);
    await call('/admin/inventory').expect(200); await call('/admin/inventory?page=1').expect(400); await call('/admin/inventory').send({ stock: 2 }).expect(400);
    expect(inventory.list).toHaveBeenCalledTimes(1); expect(inventory.adjust).not.toHaveBeenCalled();
  });
});
