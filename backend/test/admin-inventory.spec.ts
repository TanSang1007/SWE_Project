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
  test.each(['ADMIN', 'STAFF', 'CUSTOMER'])('manual drink stock endpoints are retired for %s', async value => {
    role=value; user.findUnique.mockResolvedValue({id:actor,role});
    await post({delta:10,expectedVersion:0}).expect(404);
    await request(app.getHttpServer()).get('/admin/inventory').set('Authorization', `Bearer ${jwt.sign({sub:actor})}`).expect(404);
    expect(inventory.list).not.toHaveBeenCalled(); expect(inventory.adjust).not.toHaveBeenCalled();
  });
  test('guest cannot call a retired adjustment route either', async()=>{
    await request(app.getHttpServer()).post(`/admin/products/${product}/inventory-adjustments`).send({delta:10,expectedVersion:0}).expect(404);
    expect(inventory.adjust).not.toHaveBeenCalled();
  });
});
