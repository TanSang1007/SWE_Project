import { Controller, Get, UseGuards } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { configureApp } from '../src/common/configure-app';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { Roles } from '../src/auth/roles.decorator';

@Controller('isolated-role-probe')
@UseGuards(JwtAuthGuard, RolesGuard)
class RoleProbe {
  @Get('customer') @Roles('CUSTOMER') customer() { return { allowed: true }; }
  @Get('operator') @Roles('STAFF', 'ADMIN') operator() { return { allowed: true }; }
  @Get('admin') @Roles('ADMIN') admin() { return { allowed: true }; }
  @Get('missing-metadata') missing() { return { allowed: true }; }
  @Get('empty-metadata') @Roles() empty() { return { allowed: true }; }
}
describe('A01 database-derived roles (isolated HTTP harness)', () => {
  let app: NestExpressApplication; let jwt: JwtService;
  const id = randomUUID(); let currentRole = 'CUSTOMER';
  const user = { findUnique: jest.fn() };
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://fixture:example@localhost:5432/brewlite_test';
    const module = await Test.createTestingModule({ imports: [AppModule], controllers: [RoleProbe] })
      .overrideProvider(PrismaService).useValue({ user }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init(); jwt = app.get(JwtService);
  });
  beforeEach(() => {
    currentRole = 'CUSTOMER'; user.findUnique.mockImplementation(() => Promise.resolve({ id, email: 'fixture@example.invalid', loyaltyPoints: 0, role: currentRole }));
  });
  afterAll(async () => { await app.close(); });
  const get = (path: string, payload: object = { sub: id }) => request(app.getHttpServer()).get(`/isolated-role-probe/${path}`).set('Authorization', `Bearer ${jwt.sign(payload)}`);
  it.each(['CUSTOMER', 'STAFF', 'ADMIN'])('enforces the explicit permission matrix for %s', async (role) => {
    currentRole = role;
    for (const [path, allowed] of [['customer', role === 'CUSTOMER'], ['operator', role !== 'CUSTOMER'], ['admin', role === 'ADMIN']] as const) {
      const response = await get(path).expect(allowed ? 200 : 403);
      if (!allowed) expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN', details: [] } });
    }
  });
  it('denies missing/empty metadata and unknown database roles', async () => {
    currentRole = 'ADMIN'; await get('missing-metadata').expect(403); await get('empty-metadata').expect(403);
    currentRole = 'ROOT'; await get('admin').expect(403);
  });
  it('authenticates before authorization and rejects absent/invalid/expired JWT401', async () => {
    for (const token of [undefined, 'invalid', jwt.sign({ sub: id }, { expiresIn: -1 })]) {
      const call = request(app.getHttpServer()).get('/isolated-role-probe/admin'); if (token) call.set('Authorization', `Bearer ${token}`);
      expect((await call.expect(401)).body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    }
  });
  it('ignores forged signed claims and arbitrary role headers/query/body', async () => {
    const response = await get('admin', { sub: id, role: 'ADMIN' }).set('Role', 'ADMIN').query({ role: 'ADMIN' }).send({ role: 'ADMIN' }).expect(403);
    expect(response.text).not.toMatch(/password|JWT|Prisma|SELECT/);
  });
  it('uses database role changes immediately with the same old token', async () => {
    const token = jwt.sign({ sub: id, role: 'ADMIN' });
    const call = () => request(app.getHttpServer()).get('/isolated-role-probe/admin').set('Authorization', `Bearer ${token}`);
    currentRole = 'ADMIN'; await call().expect(200); currentRole = 'STAFF'; await call().expect(403); currentRole = 'CUSTOMER'; await call().expect(403);
  });
  it('denies non-CUSTOMER existing private capabilities before resource lookup', async () => {
    currentRole = 'ADMIN';
    for (const path of ['/cart', '/orders/me', `/orders/${randomUUID()}`, '/loyalty']) {
      await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${jwt.sign({ sub: id })}`).expect(403);
    }
    await request(app.getHttpServer()).post('/orders').set('Authorization', `Bearer ${jwt.sign({ sub: id })}`).send({}).expect(403);
    await request(app.getHttpServer()).post('/payments').set('Authorization', `Bearer ${jwt.sign({ sub: id })}`).send({}).expect(403);
  });
});
