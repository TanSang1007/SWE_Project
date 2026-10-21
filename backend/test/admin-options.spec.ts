import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/common/configure-app';
import { AdminOptionService } from '../src/catalog/admin-option.service';
describe('A05 strict HTTP contracts and DB-authoritative authorization', () => {
  let app: NestExpressApplication; let jwt: JwtService; let role = 'ADMIN'; const actor = randomUUID(); const p = randomUUID(); const t = randomUUID();
  const user = { findUnique: jest.fn() };
  const service = { sizes: jest.fn(), createSize: jest.fn(), updateSize: jest.fn(), deleteSize: jest.fn(), toppings: jest.fn(), topping: jest.fn(), createTopping: jest.fn(), updateTopping: jest.fn(), deleteTopping: jest.fn(), productToppings: jest.fn(), attach: jest.fn(), detach: jest.fn() };
  const routes = [
    ['get', `/admin/products/${p}/sizes`, undefined], ['post', `/admin/products/${p}/sizes`, { expectedVersion: 7, size: 'M', extraPrice: '5000' }],
    ['patch', `/admin/products/${p}/sizes/M`, { expectedVersion: 7, isActive: false }], ['delete', `/admin/products/${p}/sizes/M`, { expectedVersion: 7 }],
    ['get', '/admin/toppings', undefined], ['get', `/admin/toppings/${t}`, undefined], ['post', '/admin/toppings', { name: ' Cream ', price: '5000' }],
    ['patch', `/admin/toppings/${t}`, { expectedVersion: 7, name: 'Changed', price: '0', isActive: true }], ['delete', `/admin/toppings/${t}`, { expectedVersion: 7 }],
    ['get', `/admin/products/${p}/toppings`, undefined], ['post', `/admin/products/${p}/toppings`, { expectedVersion: 7, toppingId: t }], ['delete', `/admin/products/${p}/toppings/${t}`, { expectedVersion: 7 }],
  ] as const;
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object, token = jwt.sign({ sub: actor })) => { const r = request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`); return body ? r.send(body) : r; };
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://demo:example@localhost:5432/brewlite';
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({ user }).overrideProvider(AdminOptionService).useValue(service).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => { jest.clearAllMocks(); role = 'ADMIN'; user.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === actor ? { id: actor, role } : null)); for (const fn of Object.values(service)) fn.mockResolvedValue({ fixture: true }); });
  afterAll(async () => { await app.close(); });
  test.each(routes)('ADMIN %s %s preserves status/private headers and strict delegation', async (method, path, body) => {
    const r = await call(method, path, body).set('Origin', 'http://localhost:3000').expect(method === 'post' ? 201 : method === 'delete' ? 204 : 200);
    expect(r.headers['cache-control']).toContain('no-store'); expect(r.headers.vary).toMatch(/Authorization/); expect(r.headers.vary).toMatch(/Origin/);
    expect(Object.values(service).reduce((count, fn) => count + fn.mock.calls.length, 0)).toBe(1);
  });
  test('original expectedVersions and normalized IDs are passed, Topping name trimmed', async () => {
    await call('patch', `/admin/toppings/${t.toUpperCase()}`, { expectedVersion: 7, price: '9000' }).expect(200);
    expect(service.updateTopping).toHaveBeenCalledWith(t, expect.objectContaining({ expectedVersion: 7, price: '9000' }));
    await call('post', '/admin/toppings', { name: ' Cream ', price: '0' }).expect(201); expect(service.createTopping).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cream' }));
  });
  test.each(['STAFF', 'CUSTOMER'])('%s cannot use any A05 endpoint even forged role/header', async value => {
    role = value; for (const [method, path, body] of routes) await call(method, path, body, jwt.sign({ sub: actor, role: 'ADMIN' })).set('X-Role', 'ADMIN').expect(403);
    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
  });
  test('all endpoints require authentication; expired/invalid/deleted-user JWT denied', async () => {
    for (const [method, path] of routes) await request(app.getHttpServer())[method](path).expect(401);
    for (const token of ['invalid', jwt.sign({ sub: actor }, { expiresIn: -1 }), jwt.sign({ sub: randomUUID() })]) await call('get', '/admin/toppings', undefined, token).expect(401);
  });
  test('same old JWT immediately reflects DB demotion', async () => { const token = jwt.sign({ sub: actor, role: 'ADMIN' }); await call('get', '/admin/toppings', undefined, token).expect(200); role = 'STAFF'; await call('get', '/admin/toppings', undefined, token).expect(403); });
  test.each(['stock', 'version', 'isActive', 'role', 'id', 'productId'])('create Topping rejects injection %s', async field => { await call('post', '/admin/toppings', { name: 'Cream', price: '0', [field]: 0 }).expect(400); expect(service.createTopping).not.toHaveBeenCalled(); });
  test.each(['-1', '1.5', '01', '1000000000000', 5000, null])('rejects money %p in Size/Topping', async price => {
    await call('post', '/admin/toppings', { name: 'Cream', price }).expect(400); await call('post', `/admin/products/${p}/sizes`, { expectedVersion: 7, size: 'M', extraPrice: price }).expect(400);
  });
  test.each([-1, 1.5, '7', null, 2147483648])('rejects expectedVersion %p', async expectedVersion => {
    await call('patch', `/admin/toppings/${t}`, { expectedVersion, price: '0' }).expect(400); await call('delete', `/admin/toppings/${t}`, { expectedVersion }).expect(400);
  });
  test('strict size enum/UUID/query/body/null lifecycle and PATCH fields', async () => {
    await call('post', `/admin/products/${p}/sizes`, { expectedVersion: 7, size: 'XL', extraPrice: '0' }).expect(400);
    await call('patch', `/admin/products/${p}/sizes/m`, { expectedVersion: 7, extraPrice: '0' }).expect(400);
    await call('get', '/admin/toppings/invalid').expect(400); await call('get', '/admin/toppings').query({ search: 'Cream' }).expect(400);
    await call('get', `/admin/products/${p}/sizes`, { role: 'ADMIN' }).expect(400);
    await call('post', `/admin/products/${p}/toppings`, { expectedVersion: 7, toppingId: 'invalid' }).expect(400);
    for (const isActive of [null, 'false', 0]) await call('patch', `/admin/toppings/${t}`, { expectedVersion: 7, isActive }).expect(400);
    await call('patch', `/admin/toppings/${t}`, { expectedVersion: 7, stock: 1 }).expect(400);
  });
});
