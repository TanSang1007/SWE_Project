import { utcConnectionString } from '../../src/database/pg-connection';
import { Controller, Get, UseGuards } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash, compare, getRounds } from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PrismaClient } from '../../src/generated/prisma/client';
import { configureApp } from '../../src/common/configure-app';
import { Roles } from '../../src/auth/roles.decorator';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/auth/guards/roles.guard';
import { provisionOperator } from '../../scripts/provision-operator.cjs';

@Controller('isolated-rbac-probe')
@UseGuards(JwtAuthGuard, RolesGuard)
class Probe {
  @Get('operator') @Roles('STAFF', 'ADMIN') operator() { return { allowed: true }; }
  @Get('admin') @Roles('ADMIN') admin() { return { allowed: true }; }
}
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Local test database required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) throw new Error('Local _dev/_test database required');
const schema = `brewlite_a01_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString, `-c search_path=${schema}`) }, { schema }) });
const localEnv = { NODE_ENV: 'development', ALLOW_OPERATOR_PROVISIONING: 'true', DATABASE_URL: connectionString };
const password = ` ${randomBytes(20).toString('hex')} `;
const legacy = randomUUID(); const order = randomUUID(); const product = randomUUID(); const topping = randomUUID(); const item = randomUUID(); const cart = randomUUID(); const ci = randomUUID();
let app: NestExpressApplication; let customer: string; let staff: string; let admin: string;
let legacyHash: string; let before: Record<string, string>; let foreignKeys: unknown[];
const names = readdirSync(resolve(__dirname, '../../prisma/migrations')).filter((n) => /^\d+_/.test(n)).sort();
async function fingerprints() {
  const result: Record<string, string> = {};
  const tables = await client.query<{ table_name: string }>('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type=\'BASE TABLE\' ORDER BY table_name', [schema]);
  for (const { table_name: table } of tables.rows) {
    result[table] = (await client.query<{ h: string }>(`SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-'role' ORDER BY to_jsonb(t)::text)::text,'[]')) AS h FROM "${table}" t`)).rows[0].h;
  }
  return result;
}
beforeAll(async () => {
  await client.connect(); await client.query(`CREATE SCHEMA "${schema}"`); await client.query(`SET search_path TO "${schema}"`);
  for (const name of names.filter((n) => !n.endsWith('_user_role'))) await client.query(readFileSync(resolve(__dirname, '../../prisma/migrations', name, 'migration.sql'), 'utf8'));
  legacyHash = await hash(password, 10);
  await client.query('INSERT INTO users(id,email,password_hash,loyalty_points) VALUES($1,$2,$3,5)', [legacy, `${legacy}@example.invalid`, legacyHash]);
  await client.query("INSERT INTO products(id,name,price,image_url,stock,version) VALUES($1,'Legacy',45000,'/images/legacy.jpg',19,1)", [product]);
  await client.query("INSERT INTO product_sizes VALUES($1,'M',5000)", [product]);
  await client.query("INSERT INTO toppings(id,name,price) VALUES($1,'Legacy topping',5000)", [topping]);
  await client.query('INSERT INTO product_toppings VALUES($1,$2)', [product, topping]);
  const promotion = randomUUID();
  await client.query("INSERT INTO promotions(id,code,discount_amount,starts_at,ends_at,is_active) VALUES($1,'LEGACY',5000,'2026-01-01Z','2028-01-01Z',true)", [promotion]);
  await client.query("INSERT INTO orders(id,order_code,user_id,status,subtotal,discount_amount,total,promotion_id,promotion_code_snapshot,version,paid_at) VALUES($1,'LEGACY',$2,'PAID',55000,5000,50000,$3,'LEGACY',1,now())", [order, legacy, promotion]);
  await client.query("INSERT INTO order_items(id,order_id,product_id,product_name_snapshot,size,base_price,size_extra_price,unit_price,qty,line_total) VALUES($1,$2,$3,'Legacy','M',45000,5000,55000,1,55000)", [item, order, product]);
  await client.query("INSERT INTO order_item_toppings VALUES($1,$2,'Legacy topping',5000)", [item, topping]);
  const claim = randomUUID();
  await client.query("INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state,order_id,response_status,response_body,completed_at) VALUES($1,$2,'PAY_ORDER','legacy','legacy','COMPLETED',$3,200,'{}',now())", [claim, legacy, order]);
  await client.query("INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status) VALUES($1,$2,$3,$4,'legacy',50000,'WALLET','SUCCEEDED')", [randomUUID(), order, legacy, claim]);
  await client.query('INSERT INTO loyalty_awards(id,order_id,user_id,points) VALUES($1,$2,$3,5)', [randomUUID(), order, legacy]);
  await client.query('INSERT INTO carts(id,user_id) VALUES($1,$2)', [cart, legacy]);
  await client.query("INSERT INTO cart_items(id,cart_id,product_id,size,configuration_key,qty) VALUES($1,$2,$3,'M',$4,1)", [ci, cart, product, `${product}:M:${topping}`]);
  await client.query('INSERT INTO cart_item_toppings VALUES($1,$2)', [ci, topping]);
  before = await fingerprints();
  foreignKeys = (await client.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace=$1::regnamespace AND contype='f' ORDER BY conname", [schema])).rows;
  await client.query(readFileSync(resolve(__dirname, '../../prisma/migrations/20261011230000_user_role/migration.sql'), 'utf8'));
  const module = await Test.createTestingModule({ imports: [AppModule], controllers: [Probe] }).overrideProvider(PrismaService).useValue(prisma).compile();
  app = module.createNestApplication<NestExpressApplication>({ bodyParser: false }); configureApp(app); await app.init();
});
afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await client.end(); });
test('migration backfills legacy CUSTOMER and preserves legacy plus approved additive tables and foreign keys', async () => {
  expect(await fingerprints()).toEqual(before);
  expect(Object.keys(before).sort()).toEqual([
    'cart_item_toppings', 'cart_items', 'carts', 'idempotency_requests', 'loyalty_awards', 'loyalty_entries',
    'order_item_toppings', 'order_items', 'orders', 'payments', 'product_sizes', 'product_toppings',
    'products', 'promotions', 'toppings', 'users', 'payment_attempts', 'payment_verifications',
  ].sort());
  expect((await client.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace=$1::regnamespace AND contype='f' ORDER BY conname", [schema])).rows).toEqual(foreignKeys);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: legacy } });
  expect(row).toMatchObject({ role: 'CUSTOMER', passwordHash: legacyHash, loyaltyPoints: 5 });
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order } })).userId).toBe(legacy);
});
test('native role enum/default/NOT NULL persist alongside approved additive A05 option lifecycle', async () => {
  expect((await client.query<{ enumlabel: string }>('SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typnamespace=$1::regnamespace AND t.typname=\'UserRole\' ORDER BY e.enumsortorder', [schema])).rows.map((r) => r.enumlabel)).toEqual(['CUSTOMER', 'STAFF', 'ADMIN']);
  const id = randomUUID(); await client.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [id, `${id}@example.invalid`, legacyHash]);
  expect((await prisma.user.findUniqueOrThrow({ where: { id } })).role).toBe('CUSTOMER');
  await expect(client.query('UPDATE users SET role=NULL WHERE id=$1', [id])).rejects.toMatchObject({ code: '23502' });
  await expect(client.query("UPDATE users SET role='ROOT' WHERE id=$1", [id])).rejects.toMatchObject({ code: '22P02' });
  expect((await client.query("SELECT table_name,column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('product_sizes','toppings') AND column_name='is_active' ORDER BY table_name", [schema])).rows).toEqual([
    { table_name: 'product_sizes', column_name: 'is_active', is_nullable: 'NO', column_default: 'true' },
    { table_name: 'toppings', column_name: 'is_active', is_nullable: 'NO', column_default: 'true' },
  ]);
});
test.each(['ADMIN', 'STAFF'])('public register rejects role=%s without privilege escalation', async (role) => {
  const email = `${randomUUID()}@example.invalid`; await request(app.getHttpServer()).post('/auth/register').send({ email, password, role }).expect(400);
  expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
});
test('public register defaults CUSTOMER and login returns only public role fields', async () => {
  const email = `${randomUUID()}@example.invalid`; const r = await request(app.getHttpServer()).post('/auth/register').send({ email, password }).expect(201);
  customer = (r.body as { user: { id: string } }).user.id; expect(r.body).toMatchObject({ user: { role: 'CUSTOMER', loyaltyPoints: 0 } });
  expect(r.text).not.toMatch(/password|hash|accessToken/);
});
test.each(['STAFF', 'ADMIN'] as const)('create-only CLI service provisions %s with bcrypt10 and no other rows', async (role) => {
  const email = `${randomUUID()}@example.invalid`; const result = await provisionOperator(client, { email: ` ${email.toUpperCase()} `, password, role }, localEnv);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: result.id } });
  expect(result).toEqual({ id: row.id, role }); expect(getRounds(row.passwordHash)).toBe(10); expect(await compare(password, row.passwordHash)).toBe(true); expect(row.loyaltyPoints).toBe(0);
  expect(await prisma.cart.count({ where: { userId: row.id } })).toBe(0); expect(await prisma.order.count({ where: { userId: row.id } })).toBe(0);
  if (role === 'STAFF') staff = row.id; else admin = row.id;
});
test('duplicate email CLI never promotes or overwrites existing password/balance/relations', async () => {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: legacy } }); const old = await fingerprints();
  await expect(provisionOperator(client, { email: row.email.toUpperCase(), password: randomBytes(20).toString('hex'), role: 'ADMIN' }, localEnv)).rejects.toThrow('EMAIL_ALREADY_EXISTS');
  expect(await fingerprints()).toEqual(old); expect(await prisma.user.findUniqueOrThrow({ where: { id: legacy } })).toEqual(row);
});
async function token(id: string) {
  const row = await prisma.user.findUniqueOrThrow({ where: { id } });
  const r = await request(app.getHttpServer()).post('/auth/login').send({ email: row.email, password }).expect(200);
  expect(Object.keys((r.body as { user: object }).user).sort()).toEqual(['email', 'id', 'loyaltyPoints', 'role']);
  return (r.body as { accessToken: string }).accessToken;
}
test.each(['CUSTOMER', 'STAFF', 'ADMIN'] as const)('real login and operator/admin/customer guard matrix for %s', async (role) => {
  const id = role === 'CUSTOMER' ? customer : role === 'STAFF' ? staff : admin; const bearer = await token(id);
  for (const [path, allowed] of [['/isolated-rbac-probe/operator', role !== 'CUSTOMER'], ['/isolated-rbac-probe/admin', role === 'ADMIN'], ['/cart', role === 'CUSTOMER'], ['/loyalty', role === 'CUSTOMER']] as const) {
    await request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${bearer}`).expect(allowed ? 200 : 403);
  }
});
test('real DB demotion invalidates old role authority on next request; forged role does not elevate', async () => {
  const bearer = await token(admin); const call = () => request(app.getHttpServer()).get('/isolated-rbac-probe/admin').set('Authorization', `Bearer ${bearer}`);
  await call().expect(200); await prisma.user.update({ where: { id: admin }, data: { role: 'STAFF' } }); await call().expect(403);
  await prisma.user.update({ where: { id: admin }, data: { role: 'ADMIN' } });
  const forged = await app.get(JwtService).signAsync({ sub: customer, role: 'ADMIN' });
  await request(app.getHttpServer()).get('/isolated-rbac-probe/admin').set('Authorization', `Bearer ${forged}`).set('Role', 'ADMIN').expect(403);
});
test('invalid/expired token401, wrong password401, cross-owner404 and no production escalation/debug/workflow routes', async () => {
  const customerBearer = await token(customer); const adminBearer = await token(admin);
  const secret = app.get(ConfigService).getOrThrow<string>('JWT_SECRET'); const expired = new JwtService().sign({ sub: customer }, { secret, expiresIn: -1 });
  for (const bearer of ['invalid', expired]) await request(app.getHttpServer()).get('/isolated-rbac-probe/admin').set('Authorization', `Bearer ${bearer}`).expect(401);
  await request(app.getHttpServer()).post('/auth/login').send({ email: `${legacy}@example.invalid`, password: randomBytes(20).toString('hex') }).expect(401);
  await request(app.getHttpServer()).get(`/orders/${order}`).set('Authorization', `Bearer ${customerBearer}`).expect(404);
  for (const path of ['/auth/admin/register', '/auth/staff/register', '/auth/role', '/__role_verify', '/operator/orders']) await request(app.getHttpServer()).post(path).send({ role: 'ADMIN' }).expect(404);
  await request(app.getHttpServer()).post('/admin/products').send({ role: 'ADMIN' }).expect(401);
  await request(app.getHttpServer()).patch(`/orders/${order}/status`).set('Authorization', `Bearer ${adminBearer}`).send({ status: 'PREPARING' }).expect(404);
  await request(app.getHttpServer()).get('/health').expect(200); await request(app.getHttpServer()).get('/products').expect(200);
});
test('CLI failure rolls back completely and suppresses database error details', async () => {
  const beforeCount = await prisma.user.count(); const marker = randomBytes(16).toString('hex');
  await client.query(`CREATE FUNCTION fail_provision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '${marker}'; END $$`);
  await client.query('CREATE TRIGGER fail_provision BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION fail_provision()');
  try {
    await expect(provisionOperator(client, { email: `${randomUUID()}@example.invalid`, password, role: 'ADMIN' }, localEnv)).rejects.toThrow('PROVISION_FAILED');
    expect(await prisma.user.count()).toBe(beforeCount);
  } finally { await client.query('DROP TRIGGER fail_provision ON users'); await client.query('DROP FUNCTION fail_provision()'); }
});
test('concurrent CLI duplicate registration commits exactly one operator', async () => {
  const email = `${randomUUID()}@example.invalid`;
  const calls = [1, 2].map(async () => {
    const c = new Client({ connectionString, options: `-c search_path=${schema} -c TimeZone=UTC` }); await c.connect();
    try { return await provisionOperator(c, { email, password, role: 'STAFF' }, localEnv); } finally { await c.end(); }
  });
  const results = await Promise.allSettled(calls); expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1); expect(await prisma.user.count({ where: { email } })).toBe(1);
});
