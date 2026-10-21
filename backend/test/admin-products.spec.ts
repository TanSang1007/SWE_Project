import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { AdminProductService } from '../src/catalog/admin-product.service';
describe('A04 Product HTTP contract and authorization', () => {
  let app: NestExpressApplication; let jwt: JwtService; let role = 'ADMIN';
  const actor = randomUUID(); const id = randomUUID(); const topping = randomUUID();
  const user = { findUnique: jest.fn() };
  const service = { list: jest.fn(), get: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
  const input = { name: ' Drink ', price: '45000', imageUrl: '/images/drink.svg', sizes: [{ size: 'M', extraPrice: '0' }], toppingIds: [topping] };
  const call = (method: 'get' | 'post' | 'patch' | 'delete', token = jwt.sign({ sub: actor }), path = '/admin/products') => request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://demo:example@localhost:5432/brewlite';
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({ user }).overrideProvider(AdminProductService).useValue(service).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => { jest.clearAllMocks(); role = 'ADMIN'; user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === actor ? { id: actor, role } : null));
    service.create.mockResolvedValue({ id }); service.update.mockResolvedValue({ id }); service.remove.mockResolvedValue(undefined); service.list.mockResolvedValue({ items: [] }); service.get.mockResolvedValue({ id }); });
  afterAll(async () => { await app.close(); });
  test('ADMIN create trims name, uses exact nested DTO, money strings and private headers', async () => {
    const r = await call('post').set('Origin', 'http://localhost:3000').send(input).expect(201);
    expect(r.body).toEqual({ id }); expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ ...input, name: 'Drink' }));
    expect(r.headers['cache-control']).toContain('no-store'); expect(r.headers.vary).toMatch(/Authorization/); expect(r.headers.vary).toMatch(/Origin/);
  });
  test('ADMIN list/detail/PATCH/DELETE normalized ID, status and original version', async () => {
    await call('get').expect(200); await call('get', undefined, `/admin/products/${id.toUpperCase()}`).expect(200); expect(service.get).toHaveBeenCalledWith(id);
    await call('patch', undefined, `/admin/products/${id}`).send({ expectedVersion: 7, price: '0', isActive: false }).expect(200);
    expect(service.update).toHaveBeenCalledWith(id, expect.objectContaining({ expectedVersion: 7, price: '0', isActive: false }));
    const r = await call('delete', undefined, `/admin/products/${id}`).send({ expectedVersion: 7 }).expect(204); expect(r.text).toBe(''); expect(service.remove).toHaveBeenCalledWith(id, 7);
  });
  test.each(['STAFF', 'CUSTOMER'])('%s forbidden on every method, including invalid resources and forged claims', async value => {
    role = value; const token = jwt.sign({ sub: actor, role: 'ADMIN' });
    for (const method of ['get', 'post', 'patch', 'delete'] as const) await call(method, token, method === 'get' || method === 'post' ? '/admin/products' : '/admin/products/invalid').set('X-Role', 'ADMIN').send(input).expect(403);
    for (const mock of Object.values(service)) expect(mock).not.toHaveBeenCalled();
  });
  test.each(['get', 'post', 'patch', 'delete'] as const)('%s requires valid JWT', async method => {
    const path = method === 'get' || method === 'post' ? '/admin/products' : `/admin/products/${id}`;
    await request(app.getHttpServer())[method](path).send(input).expect(401);
    for (const token of ['invalid', jwt.sign({ sub: actor }, { expiresIn: -1 }), jwt.sign({ sub: randomUUID() })]) await call(method, token, path).send(input).expect(401);
  });
  test('current DB role overrides old ADMIN JWT on next request', async () => { const token = jwt.sign({ sub: actor, role: 'ADMIN' }); await call('get', token).expect(200); role = 'STAFF'; await call('get', token).expect(403); });
  test.each(['stock', 'version', 'isActive', 'role', 'category', 'description', 'userId'])('create rejects mass-assignment %s', async field => { await call('post').send({ ...input, [field]: 0 }).expect(400); expect(service.create).not.toHaveBeenCalled(); });
  test.each(['stock', 'version', 'sizes', 'toppingIds', 'role', 'total'])('update rejects %s', async field => { await call('patch', undefined, `/admin/products/${id}`).send({ expectedVersion: 1, name: 'Drink', [field]: 0 }).expect(400); expect(service.update).not.toHaveBeenCalled(); });
  test.each(['', ' ', 'x'.repeat(121), null, 7])('invalid name %p', async name => { await call('post').send({ ...input, name }).expect(400); });
  test.each(['-1', '1.5', '01', '1000000000000', 45000, null])('invalid monetary price %p', async price => { await call('post').send({ ...input, price }).expect(400); });
  test.each(['/images/../secret', '/images/%2e%2e/secret', 'https://example.invalid/x', '/images/x?token=secret', '/images//x'])('rejects image path %s', async imageUrl => { await call('post').send({ ...input, imageUrl }).expect(400); });
  test('nested options are required, bounded, unique and strict', async () => {
    for (const sizes of [[], [{ size: 'XL', extraPrice: '0' }], [{ size: 'M', extraPrice: '0', stock: 1 }], [{ size: 'M', extraPrice: '0' }, { size: 'M', extraPrice: '0' }]]) await call('post').send({ ...input, sizes }).expect(400);
    await call('post').send({ ...input, toppingIds: [topping, topping.toUpperCase()] }).expect(400);
    await call('post').send({ ...input, sizes: undefined }).expect(400);
  });
  test.each([-1, 2147483648, 1.5, '1', null])('invalid version %p and invalid boolean rejected', async expectedVersion => {
    await call('patch', undefined, `/admin/products/${id}`).send({ expectedVersion, name: 'Drink' }).expect(400);
    await call('delete', undefined, `/admin/products/${id}`).send({ expectedVersion }).expect(400);
  });
  test('strict query/body/UUID and null/boolean enforcement', async () => {
    await call('get').query({ active: true }).expect(400); await call('get').send({ role: 'ADMIN' }).expect(400);
    await call('post').query({ stock: 7 }).send(input).expect(400); await call('get', undefined, '/admin/products/invalid').expect(400);
    for (const isActive of [null, 'false', 0]) await call('patch', undefined, `/admin/products/${id}`).send({ expectedVersion: 0, isActive }).expect(400);
  });
});
