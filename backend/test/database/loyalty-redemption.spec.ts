import { ConfigService } from '@nestjs/config';
import type { LoyaltyService } from '../../src/loyalty/loyalty.service';
type HistoryBody = Awaited<ReturnType<LoyaltyService['history']>>;
import { utcConnectionString } from '../../src/database/pg-connection';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { PrismaClient } from '../../src/generated/prisma/client';
import { MockPaymentService } from '../../src/payments/mock-payment.service';
import { OrderService } from '../../src/orders/order.service';
import { configureApp } from '../../src/common/configure-app';
import { lockUser } from '../../src/orders/order-policy';
import { reconcileAccount } from '../../src/loyalty/loyalty-accounting';
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString)
    throw Error('Local DB required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname))
    throw Error('Local _dev/_test required');
const schema = `brewlite_l01_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const scoped = new URL(connectionString);
scoped.searchParams.set('options', `-c search_path=${schema}`);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(scoped.toString()) }, { schema }) });
let app: NestExpressApplication;
let jwt: JwtService;
let orders: OrderService;
let mode: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
let mockCalls = 0;
let preserved: boolean;
let legacyId: string;
let legacyOwner: string;
beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    const dir = resolve(__dirname, '../../prisma/migrations');
    const names = readdirSync(dir).filter(n => /^\d+_/.test(n)).sort();
    const cutover = '20261014090000_loyalty_redemption';
    for (const name of names.filter(name => name < cutover))
        await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
    legacyOwner = randomUUID();
    legacyId = randomUUID();
    await client.query("INSERT INTO users(id,email,password_hash,loyalty_points) VALUES($1,$2,'legacy-fixture',10)", [legacyOwner, `${legacyOwner}@example.invalid`]);
    await client.query("INSERT INTO orders(id,order_code,user_id,status,subtotal,total,paid_at) VALUES($1,$2,$3,'PAID',100000,100000,now())", [legacyId, `BL-${legacyId}`, legacyOwner]);
    await client.query('INSERT INTO loyalty_awards(id,order_id,user_id,points) VALUES($1,$2,$3,10)', [randomUUID(), legacyId, legacyOwner]);
    const key = randomUUID(), claim = randomUUID();
    await client.query("INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state,order_id,response_status,response_body,completed_at) VALUES($1,$2,'PAY_ORDER',$3,$4,'COMPLETED',$5,200,$6,now())", [claim, legacyOwner, key, 'a'.repeat(64), legacyId, JSON.stringify({ legacy: true })]);
    await client.query("INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status) VALUES($1,$2,$3,$4,$5,100000,'WALLET','SUCCEEDED')", [randomUUID(), legacyId, legacyOwner, claim, key]);
    const oldTables = ['users', 'orders', 'payments', 'loyalty_awards', 'idempotency_requests'];
    const columns = new Map<string, string[]>();
    const before = new Map<string, string>();
    for (const t of oldTables) {
        columns.set(t, (await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position', [schema, t])).rows.map(r => (r as {
            column_name: string;
        }).column_name));
        before.set(t, JSON.stringify((await client.query(`SELECT row_to_json(s) AS row FROM (SELECT ${columns.get(t)!.join(',')} FROM ${t} ORDER BY id) s`)).rows));
    }
    // A forced DDL collision proves the cutover transaction cannot partially add fields.
    await client.query('CREATE TABLE loyalty_entries(dummy INTEGER)');
    await expect(client.query(readFileSync(resolve(dir, cutover, 'migration.sql'), 'utf8'))).rejects.toBeDefined();
    await client.query('ROLLBACK');
    expect((await client.query<{
        n: number;
    }>("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND column_name='loyalty_debt'", [schema])).rows[0].n).toBe(0);
    await client.query('DROP TABLE loyalty_entries');
    await client.query(readFileSync(resolve(dir, cutover, 'migration.sql'), 'utf8'));
    preserved = true;
    for (const t of oldTables)
        preserved &&= before.get(t) === JSON.stringify((await client.query(`SELECT row_to_json(s) AS row FROM (SELECT ${columns.get(t)!.join(',')} FROM ${t} ORDER BY id) s`)).rows);
    for (const name of names.filter(name => name > cutover))
        await client.query(readFileSync(resolve(dir, name, 'migration.sql'), 'utf8'));
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma)
        .overrideProvider(MockPaymentService).useValue({ result: () => { mockCalls++; return mode; } }).compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app);
    await app.init();
    jwt = app.get(JwtService);
    orders = app.get(OrderService);
});
beforeEach(() => { mode = 'SUCCESS'; mockCalls = 0; });
afterAll(async () => {
    if (app)
        await app.close();
    await prisma.$disconnect();
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
});
async function owner(role: 'CUSTOMER' | 'STAFF' | 'ADMIN' = 'CUSTOMER') { const u = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'fixture', role } }); return { id: u.id, token: jwt.sign({ sub: u.id }) }; }
type Owner = Awaited<ReturnType<typeof owner>>;
const auth = (u: Owner) => `Bearer ${u.token}`;
async function cart(u: Owner, price = '100000', discount?: string) {
    const p = await prisma.product.create({ data: { name: 'L01 Coffee', price, stock: 30, imageUrl: '/images/test.jpg', sizes: { create: { size: 'S', extraPrice: '0' } } } });
    const c = await prisma.cart.upsert({ where: { userId: u.id }, create: { userId: u.id }, update: {} });
    await prisma.cartItem.create({ data: { cartId: c.id, productId: p.id, size: 'S', qty: 1, configurationKey: `${p.id}:S` } });
    let promotionCode: string | undefined;
    if (discount) {
        const promo = await prisma.promotion.create({ data: { code: randomUUID().replaceAll('-', '').toUpperCase(), discountAmount: discount, startsAt: new Date('2020-01-01'), endsAt: new Date('2100-01-01'), isActive: true } });
        promotionCode = promo.code;
    }
    return { product: p.id, body: { items: [{ productId: p.id, size: 'S', qty: 1, toppingIds: [] }], ...(promotionCode ? { promotionCode } : {}) } };
}
const create = (u: Owner, body: object, key = randomUUID()) => request(app.getHttpServer()).post('/orders').set('Authorization', auth(u)).set('Idempotency-Key', key).send(body);
const preview = (u: Owner, body: object) => request(app.getHttpServer()).post('/orders/preview').set('Authorization', auth(u)).send(body);
const pay = (u: Owner, id: string, key = randomUUID()) => request(app.getHttpServer()).post('/payments').set('Authorization', auth(u)).set('Idempotency-Key', key).send({ orderId: id, method: 'WALLET' });
const cancel = (u: Owner, id: string) => request(app.getHttpServer()).post(`/orders/${id}/cancel`).set('Authorization', auth(u)).send({});
const balance = (u: Owner) => request(app.getHttpServer()).get('/loyalty').set('Authorization', auth(u));
const history = (u: Owner, query = '') => request(app.getHttpServer()).get('/loyalty/transactions' + query).set('Authorization', auth(u));
async function earn(u: Owner, price = '1000000') {
    const c = await cart(u, price);
    const r = await create(u, c.body).expect(201);
    await pay(u, (r.body as {
        id: string;
    }).id).expect(200);
    return (r.body as {
        id: string;
    }).id;
}
async function paidCancel(id: string) { const row = await prisma.order.findUniqueOrThrow({ where: { id } }); return orders.transitionOrder(id, row.version, 'CANCELLED'); }
async function proof(u: Owner) { return prisma.$transaction(async (tx) => { await lockUser(tx, u.id); const a = await reconcileAccount(tx, u.id); return { available: a.available.toString(), reserved: a.reserved.toString(), debt: a.debt.toString() }; }); }
async function snapshot(u: Owner) { return { u: await prisma.user.findUnique({ where: { id: u.id } }), orders: await prisma.order.findMany({ where: { userId: u.id }, orderBy: { id: 'asc' } }), payments: await prisma.payment.findMany({ where: { userId: u.id }, orderBy: { id: 'asc' } }), awards: await prisma.loyaltyAward.findMany({ where: { userId: u.id }, orderBy: { id: 'asc' } }), entries: await prisma.loyaltyEntry.findMany({ where: { userId: u.id }, orderBy: { sequence: 'asc' } }), claims: await prisma.idempotencyRequest.findMany({ where: { userId: u.id }, orderBy: { id: 'asc' } }), cart: await prisma.cartItem.findMany({ where: { cart: { userId: u.id } }, orderBy: { id: 'asc' } }) }; }
test('R03/R04/R07 migration preserves old columns/claims/Awards/Payments and exact OPENING, old Order defaults', async () => {
    expect(preserved).toBe(true);
    const old = await prisma.order.findUniqueOrThrow({ where: { id: legacyId } });
    expect(old).toMatchObject({ redeemedPoints: 0, redemptionState: 'NONE', reservationCycle: 0 });
    expect(old.total.toFixed(0)).toBe('100000');
    const opening = await prisma.loyaltyEntry.findMany({ where: { userId: legacyOwner } });
    expect(opening).toHaveLength(1);
    expect(opening[0]).toMatchObject({ kind: 'OPENING', points: 10, availableDelta: 10, debtDelta: 0n });
    expect((await proof({ id: legacyOwner, token: '' })).available).toBe('10');
    await paidCancel(legacyId);
    expect(await proof({ id: legacyOwner, token: '' })).toEqual({ available: '0', reserved: '0', debt: '0' });
    expect((await prisma.payment.findFirstOrThrow({ where: { orderId: legacyId } })).status).toBe('SUCCEEDED');
});
test('P04/P12/L01/L02 authoritative preview100000-10000-50*100=85000, earn8; read-only and journal conservation', async () => {
    const u = await owner();
    await earn(u);
    const c = await cart(u, '100000', '10000');
    const before = await snapshot(u);
    const body = { ...c.body, redeemedPoints: 50 };
    const q = await preview(u, body).expect(200);
    expect(q.body).toMatchObject({ finalTotal: '85000', loyaltyDiscount: '5000', earnedPoints: 8, availablePoints: 100, availablePointsAfterReservation: 50 });
    expect(await snapshot(u)).toEqual(before);
    const r = await create(u, body).expect(201);
    expect(r.body).toMatchObject({ total: '85000', redeemedPoints: 50, loyaltyDiscountAmount: '5000', redemptionState: 'RESERVED' });
    expect(await proof(u)).toEqual({ available: '50', reserved: '50', debt: '0' });
    await pay(u, (r.body as {
        id: string;
    }).id).expect(200);
    expect(await proof(u)).toEqual({ available: '58', reserved: '0', debt: '0' });
    expect((await prisma.loyaltyEntry.findMany({ where: { orderId: (r.body as {
                id: string;
            }).id }, orderBy: { sequence: 'asc' } })).map(e => e.kind)).toEqual(['RESERVE', 'SETTLE', 'EARN']);
});
test.each(['SUCCESS', 'FAILURE'] as const)('P10 zero total %s still invokes mock and consistent Payment0, earning/release/replay', async (outcome) => {
    const u = await owner();
    await earn(u);
    const c = await cart(u, '10000');
    const r = await create(u, { ...c.body, redeemedPoints: 100 }).expect(201);
    expect((r.body as {
        total: string;
    }).total).toBe('0');
    expect((r.body as {
        status: string;
    }).status).toBe('PENDING');
    mode = outcome;
    mockCalls = 0;
    const key = randomUUID();
    const result = await pay(u, (r.body as {
        id: string;
    }).id, key).expect(200);
    expect(mockCalls).toBe(1);
    expect((result.body as {
        payment: {
            amount: string;
        };
    }).payment.amount).toBe('0');
    expect((result.body as {
        loyalty: {
            awardedPoints: number;
        };
    }).loyalty.awardedPoints).toBe(0);
    expect(await proof(u)).toEqual({ available: outcome === 'SUCCESS' ? '0' : '100', reserved: '0', debt: '0' });
    const before = await snapshot(u);
    await pay(u, (r.body as {
        id: string;
    }).id, key).expect(200);
    expect(await snapshot(u)).toEqual(before);
    expect(mockCalls).toBe(1);
});
test('L03–07/S10 repeated failure cycles release once, retry exact snapshot, cancel failed has no extra credit', async () => {
    const u = await owner();
    await earn(u);
    const c = await cart(u, '10000');
    const r = await create(u, { ...c.body, redeemedPoints: 10 }).expect(201);
    mode = 'FAILURE';
    await pay(u, (r.body as {
        id: string;
    }).id).expect(200);
    await prisma.product.update({ where: { id: c.product }, data: { price: '90000' } });
    await pay(u, (r.body as {
        id: string;
    }).id).expect(200);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: (r.body as {
                id: string;
            }).id } });
    expect(o).toMatchObject({ reservationCycle: 2, redemptionState: 'RELEASED' });
    expect(o.total.toFixed(0)).toBe('9000');
    expect(await proof(u)).toEqual({ available: '100', reserved: '0', debt: '0' });
    await cancel(u, o.id).expect(200);
    const before = await snapshot(u);
    await cancel(u, o.id).expect(200);
    expect(await snapshot(u)).toEqual(before);
    expect((await prisma.loyaltyEntry.findMany({ where: { orderId: o.id }, orderBy: { sequence: 'asc' } })).map(e => e.kind)).toEqual(['RESERVE', 'RELEASE', 'RESERVE', 'RELEASE']);
});
test('L08/L09/L11 paid spend -> original reversal debt -> refund offsets debt, immutable snapshots', async () => {
    const u = await owner();
    const a = await earn(u, '100000');
    const c = await cart(u, '9000');
    const b = await create(u, { ...c.body, redeemedPoints: 10 }).expect(201);
    await pay(u, (b.body as {
        id: string;
    }).id).expect(200);
    await paidCancel(a);
    expect(await proof(u)).toEqual({ available: '0', reserved: '0', debt: '10' });
    const before = await prisma.order.findUniqueOrThrow({ where: { id: (b.body as {
                id: string;
            }).id } });
    await paidCancel(before.id);
    expect(await proof(u)).toEqual({ available: '0', reserved: '0', debt: '0' });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.total).toEqual(before.total);
    expect(after.paidAt).toEqual(before.paidAt);
    expect(after.redemptionState).toBe('REFUNDED');
    const entries = await prisma.loyaltyEntry.findMany({ where: { orderId: before.id }, orderBy: { sequence: 'asc' } });
    expect(entries.find(e => e.kind === 'REFUND')).toMatchObject({ points: 10, availableDelta: 0, debtDelta: -10n });
});
test.each(['SUCCESS', 'FAILURE'] as const)('L10/L16 debt while pending blocks %s BEFORE mock/payment, existing cancel offsets and unlocks D31', async (outcome) => {
    const u = await owner();
    const a = await earn(u, '150000');
    const c = await cart(u, '1000');
    const b = await create(u, { ...c.body, redeemedPoints: 10 }).expect(201);
    await paidCancel(a);
    expect(await proof(u)).toEqual({ available: '0', reserved: '10', debt: '10' });
    mode = outcome;
    mockCalls = 0;
    const before = await snapshot(u);
    const blocked = await pay(u, (b.body as {
        id: string;
    }).id).expect(409);
    expect((blocked.body as {
        error: {
            code: string;
        };
    }).error.code).toBe('LOYALTY_REVERSAL_OUTSTANDING');
    expect(mockCalls).toBe(0);
    expect(await snapshot(u)).toEqual(before);
    await create(u, c.body).expect(409);
    await cancel(u, (b.body as {
        id: string;
    }).id).expect(200);
    expect(await proof(u)).toEqual({ available: '0', reserved: '0', debt: '0' });
    const next = await create(u, c.body).expect(201);
    expect((next.body as {
        redeemedPoints: number;
    }).redeemedPoints).toBe(0);
    await cancel(u, (next.body as {
        id: string;
    }).id).expect(200);
});
test('L16 remainder debt after cancel still permits zero-point cash earning', async () => {
    const u = await owner();
    const a = await earn(u, '200000');
    const spent = await cart(u, '1000');
    const b = await create(u, { ...spent.body, redeemedPoints: 10 }).expect(201);
    await pay(u, (b.body as {
        id: string;
    }).id).expect(200);
    const pending = await cart(u, '1000');
    const c = await create(u, { ...pending.body, redeemedPoints: 5 }).expect(201);
    await paidCancel(a);
    expect((await proof(u)).debt).toBe('15');
    await cancel(u, (c.body as {
        id: string;
    }).id).expect(200);
    expect((await proof(u)).debt).toBe('10');
    await prisma.cartItem.deleteMany({ where: { cart: { userId: u.id } } });
    const cash = await cart(u, '200000');
    const order = await create(u, cash.body).expect(201);
    await pay(u, (order.body as {
        id: string;
    }).id).expect(200);
    expect(await proof(u)).toEqual({ available: '10', reserved: '0', debt: '0' });
});
test.each([-1, 1.5, '1', null, 2147483648])('P09/S03 invalid selected points %p reject with no effects', async (points) => { const u = await owner(); const c = await cart(u); const before = await snapshot(u); await create(u, { ...c.body, redeemedPoints: points }).expect(400); expect(await snapshot(u)).toEqual(before); });
test('P07/P08 insufficient/exceeds-total never clamp', async () => {
    const u = await owner();
    const c = await cart(u, '100');
    await create(u, { ...c.body, redeemedPoints: 1 }).expect(409);
    await prisma.cartItem.deleteMany({ where: { cart: { userId: u.id } } });
    await earn(u);
    const q = await cart(u, '100');
    const before = await snapshot(u);
    const result = await create(u, { ...q.body, redeemedPoints: 2 }).expect(409);
    expect((result.body as {
        error: {
            code: string;
        };
    }).error.code).toBe('LOYALTY_REDEMPTION_EXCEEDS_TOTAL');
    expect(await snapshot(u)).toEqual(before);
});
test('C01/C02/C04 races same/different keys do not double spend/settle/award', async () => {
    const u = await owner();
    await earn(u);
    const c = await cart(u);
    const key = randomUUID();
    const body = { ...c.body, redeemedPoints: 50 };
    const results = await Promise.all([create(u, body, key), create(u, body, key)]);
    expect(results.every(r => r.status === 201 || r.status === 409)).toBe(true);
    const committed = results.find(r => r.status === 201)!;
    expect(committed).toBeDefined();
    expect((await proof(u)).reserved).toBe('50');
    await create(u, { ...c.body, redeemedPoints: 49 }, key).expect(409);
    const id = (committed.body as {
        id: string;
    }).id;
    const payKey = randomUUID();
    await Promise.all([pay(u, id, payKey), pay(u, id, payKey)]);
    await pay(u, id, payKey).expect(200);
    expect(await proof(u)).toEqual({ available: '59', reserved: '0', debt: '0' });
    expect(await prisma.loyaltyEntry.count({ where: { orderId: id, kind: 'SETTLE' } })).toBe(1);
});
test('S04/S10 database append-only guard, debt/Order/entry checks and unique effects enforce actual records', async () => { const u = await owner(); const id = await earn(u); const e = await prisma.loyaltyEntry.findFirstOrThrow({ where: { orderId: id } }); await expect(prisma.loyaltyEntry.update({ where: { id: e.id }, data: { points: e.points } })).rejects.toBeDefined(); await expect(prisma.loyaltyEntry.delete({ where: { id: e.id } })).rejects.toBeDefined(); await expect(prisma.loyaltyEntry.create({ data: { ...e, id: randomUUID(), sequence: undefined } })).rejects.toBeDefined(); await expect(prisma.user.update({ where: { id: u.id }, data: { loyaltyDebt: -1n } })).rejects.toBeDefined(); await expect(prisma.user.update({ where: { id: u.id }, data: { loyaltyDebt: 1n } })).rejects.toBeDefined(); await expect(prisma.order.update({ where: { id }, data: { redeemedPoints: 1 } })).rejects.toBeDefined(); await proof(u); });
test('S07–09 history owner guard/strict paging/cursor snapshot excludes new entries without leaks', async () => {
    const u = await owner();
    const v = await owner();
    await earn(u);
    await earn(u);
    await earn(u);
    const page = await history(u, '?limit=2').expect(200);
    expect((page.body as HistoryBody).items).toHaveLength(2);
    expect((page.body as HistoryBody).nextCursor).toEqual(expect.any(String));
    const before = await snapshot(u);
    const seen = [...(page.body as HistoryBody).items];
    let cursor = (page.body as HistoryBody).nextCursor as string;
    await earn(u);
    while (cursor) {
        const r = await history(u, '?limit=2&cursor=' + cursor).expect(200);
        seen.push(...(r.body as HistoryBody).items);
        cursor = (r.body as HistoryBody).nextCursor as string;
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen.map(e => e.orderId)).size).toBe(3);
    expect(JSON.stringify(seen)).not.toMatch(/effectKey|sequence|idempotency|passwordHash|userId/);
    expect((await snapshot(u)).entries.length).toBe(before.entries.length + 1);
    await history(v, '?cursor=' + (page.body as HistoryBody).nextCursor).expect(400);
    await history(u, '?cursor=bad').expect(400);
    for (const q of ['?limit=0', '?limit=51', '?limit=01', '?limit=1&limit=2', '?userId=' + v.id])
        await history(u, q).expect(400);
    await request(app.getHttpServer()).get('/loyalty/transactions').expect(401);
    const staff = await owner('STAFF');
    await history(staff).expect(403);
    await preview(staff, { items: [] }).expect(403);
    expect((await balance(u).expect(200)).body).toHaveProperty('pointValueVnd', '100');
});
test.each(['users', 'orders', 'products', 'payments', 'loyalty_awards', 'loyalty_entries', 'idempotency_requests', 'cart_items'])('C10 fault at %s rolls back counters, stock, journal and claims', async (table) => {
    const u = await owner();
    await earn(u);
    const c = await cart(u, '20000');
    const r = await create(u, { ...c.body, redeemedPoints: 10 }).expect(201);
    const before = await snapshot(u);
    const stock = await prisma.product.findUniqueOrThrow({ where: { id: c.product } });
    await client.query(`CREATE FUNCTION l01_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture fault'; END $$`);
    await client.query(`CREATE TRIGGER l01_fault AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION l01_fault()`);
    try {
        if (table === 'products')
            mode = 'FAILURE';
        await pay(u, (r.body as {
            id: string;
        }).id).expect(503);
        expect(await snapshot(u)).toEqual(before);
        expect(await prisma.product.findUniqueOrThrow({ where: { id: c.product } })).toEqual(stock);
    }
    finally {
        await client.query(`DROP TRIGGER l01_fault ON ${table}`);
        await client.query('DROP FUNCTION l01_fault()');
    }
    await proof(u);
});
test.each([1, 10, 50, 100, 500])('P03/P05 integer redemption%i keeps item prices and exact100VND conversion', async (points) => {
    const u = await owner();
    await earn(u, '5000000');
    const c = await cart(u, '100000');
    const result = await create(u, { ...c.body, redeemedPoints: points }).expect(201);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: (result.body as {
                id: string;
            }).id }, include: { items: true } });
    expect(o.loyaltyDiscountAmount.toFixed(0)).toBe(String(points * 100));
    expect(o.total.toFixed(0)).toBe(String(100000 - points * 100));
    expect(o.items[0].unitPrice.toFixed(0)).toBe('100000');
    await proof(u);
    await cancel(u, o.id.toUpperCase()).expect(200);
    await proof(u);
});
test('C03 legacy r0 create hash and omitted/explicit0 replay remain identical after current state changes', async () => {
    const u = await owner();
    const c = await cart(u);
    const key = randomUUID();
    const original = await create(u, c.body, key).expect(201);
    await pay(u, (original.body as {
        id: string;
    }).id).expect(200);
    const claims = await prisma.idempotencyRequest.findFirstOrThrow({ where: { userId: u.id, operation: 'CREATE_ORDER', idempotencyKey: key } });
    const normalized = { items: c.body.items.map(i => ({productId:i.productId,size:i.size,toppingIds:i.toppingIds,qty:i.qty})), promotionCode: null };
    const { createHash } = await import('node:crypto');
    expect(claims.requestHash).toBe(createHash('sha256').update(JSON.stringify(normalized)).digest('hex'));
    const before = await snapshot(u);
    const replay = await create(u, { ...c.body, redeemedPoints: 0 }, key).expect(201);
    expect(replay.body).toEqual(original.body);
    expect(await snapshot(u)).toEqual(before);
});
test('L17 failed reservation with later debt blocks retry before stock/cycle/mock, cancellation has no second release', async () => {
    const u = await owner();
    const a = await earn(u, '200000');
    const x = await cart(u, '1000');
    const spent = await create(u, { ...x.body, redeemedPoints: 10 }).expect(201);
    await pay(u, (spent.body as {
        id: string;
    }).id).expect(200);
    const c = await cart(u, '1000');
    const r = await create(u, { ...c.body, redeemedPoints: 5 }).expect(201);
    const id = (r.body as {
        id: string;
    }).id;
    mode = 'FAILURE';
    await pay(u, id).expect(200);
    await paidCancel(a);
    expect((await proof(u)).debt).toBe('10');
    const before = await snapshot(u), stock = await prisma.product.findUniqueOrThrow({ where: { id: c.product } });
    mockCalls = 0;
    await pay(u, id).expect(409);
    expect(mockCalls).toBe(0);
    expect(await snapshot(u)).toEqual(before);
    expect(await prisma.product.findUniqueOrThrow({ where: { id: c.product } })).toEqual(stock);
    const entries = await prisma.loyaltyEntry.count({ where: { orderId: id } });
    await cancel(u, id).expect(200);
    expect(await prisma.loyaltyEntry.count({ where: { orderId: id } })).toBe(entries);
    expect((await proof(u)).debt).toBe('10');
});
test('L15 final counter can be bounded while refund intermediate exceeds INTEGER', async () => {
    const { openingFixture } = await import('./loyalty-fixture');
    const u = await owner();
    await openingFixture(prisma, u.id, 2147483647);
    const c = await cart(u, '505000');
    const r = await create(u, { ...c.body, redeemedPoints: 50 }).expect(201);
    const id = (r.body as {
        id: string;
    }).id;
    await pay(u, id).expect(200);
    expect((await proof(u)).available).toBe('2147483647');
    await paidCancel(id);
    expect((await proof(u)).available).toBe('2147483647');
});
test('C05 two failed retries commit separate exact cycles; no duplicate points or stock', async () => {
    const u = await owner();
    await earn(u);
    const c = await cart(u, '10000');
    const result = await create(u, { ...c.body, redeemedPoints: 10 }).expect(201);
    const id = (result.body as {
        id: string;
    }).id;
    mode = 'FAILURE';
    await pay(u, id).expect(200);
    await Promise.all([pay(u, id), pay(u, id)]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(o).toMatchObject({ status: 'PAYMENT_FAILED', reservationCycle: 3, redemptionState: 'RELEASED' });
    expect(await prisma.loyaltyEntry.count({ where: { orderId: id, kind: 'RESERVE' } })).toBe(3);
    expect(await prisma.loyaltyEntry.count({ where: { orderId: id, kind: 'RELEASE' } })).toBe(3);
    expect((await proof(u)).available).toBe('100');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: c.product } })).stock).toBe(30);
});
test('L13 corrupt available cache never becomes explained debt; rollback preserves every effect', async () => { const u = await owner(); const id = await earn(u); await prisma.user.update({ where: { id: u.id }, data: { loyaltyPoints: 99 } }); const before = await snapshot(u); await expect(paidCancel(id)).rejects.toMatchObject({ status: 503 }); expect(await snapshot(u)).toEqual(before); });
test('C11 real owner lock timeout has no partial Payment/reservation/journal and no blind retry', async () => {
    const u = await owner();
    await earn(u);
    const c = await cart(u);
    const result = await create(u, { ...c.body, redeemedPoints: 10 }).expect(201);
    const before = await snapshot(u);
    const blocker = new Client({ connectionString: scoped.toString() });
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [u.id]);
    try {
        const response = await pay(u, (result.body as {
            id: string;
        }).id).expect(409);
        expect((response.body as {
            error: {
                code: string;
            };
        }).error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
        expect(await snapshot(u)).toEqual(before);
    }
    finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
    }
    await proof(u);
});
test.each(['reversal', 'payment-success', 'payment-failure'] as const)('C07 database lock barrier forces%s to win reversal versus existing reservation', async (first) => {
    const { PaymentService } = await import('../../src/payments/payment.service');
    const { PricingService } = await import('../../src/pricing/pricing.service');
    const u = await owner();
    const a = await earn(u, '100000');
    const c = await cart(u, '1000');
    const result = await create(u, { ...c.body, redeemedPoints: 10 }).expect(201);
    const b = (result.body as {
        id: string;
    }).id;
    const version = (await prisma.order.findUniqueOrThrow({ where: { id: a } })).version;
    const actorUrls = [new URL(scoped.toString()), new URL(scoped.toString())];
    const tags = [`l01_r_${randomUUID()}`, `l01_p_${randomUUID()}`];
    actorUrls.forEach((v, i) => v.searchParams.set('application_name', tags[i]));
    const actors = actorUrls.map(v => new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(v.toString()) }, { schema }) }));
    await Promise.all(actors.map(p => p.$connect()));
    await Promise.all(actors.map(p => p.$queryRaw`SELECT 1`));
    const reverseService = new OrderService(actors[0] as unknown as PrismaService, app.get(PricingService), app.get(ConfigService));
    const paymentService = new PaymentService(actors[1] as unknown as PrismaService, app.get(MockPaymentService));
    const blocker = new Client({ connectionString: scoped.toString() });
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [u.id]);
    mode = first === 'payment-failure' ? 'FAILURE' : 'SUCCESS';
    mockCalls = 0;
    const runReverse = () => reverseService.transitionOrder(a, version, 'CANCELLED').then(() => 200, (e: unknown) => (e as {
        getStatus(): number;
    }).getStatus());
    const runPayment = () => paymentService.pay(u.id, randomUUID(), { orderId: b, method: 'WALLET' }).then(() => 200, (e: unknown) => (e as {
        getStatus(): number;
    }).getStatus());
    const waiting = async (tag: string) => { for (let i = 0; i < 15; i++) {
        const n = (await client.query<{
            n: number;
        }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [tag])).rows[0].n;
        if (n)
            return;
        await new Promise(r => setTimeout(r, 5));
    } throw Error('Database lock barrier not reached'); };
    try {
        const reversalFirst = first === 'reversal';
        const one = reversalFirst ? runReverse() : runPayment();
        await waiting(tags[reversalFirst ? 0 : 1]);
        const two = reversalFirst ? runPayment() : runReverse();
        await waiting(tags[reversalFirst ? 1 : 0]);
        await blocker.query('COMMIT');
        const results = await Promise.all([one, two]);
        expect(results).toEqual(reversalFirst ? [200, 409] : [200, 200]);
        expect(mockCalls).toBe(reversalFirst ? 0 : 1);
        expect(await proof(u)).toEqual(first === 'reversal' ? { available: '0', reserved: '10', debt: '10' } : first === 'payment-success' ? { available: '0', reserved: '0', debt: '10' } : { available: '0', reserved: '0', debt: '0' });
    }
    finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
        await Promise.all(actors.map(p => p.$disconnect()));
    }
});
test('C08 last-stock barrier between two funded customers rolls back losing points/claim', async () => {
    const { PricingService } = await import('../../src/pricing/pricing.service');
    const u = await owner(), v = await owner();
    await earn(u);
    await earn(v);
    const c = await cart(u, '10000');
    await prisma.product.update({ where: { id: c.product }, data: { stock: 1 } });
    const second = await prisma.cart.upsert({ where: { userId: v.id }, create: { userId: v.id }, update: {} });
    await prisma.cartItem.create({ data: { cartId: second.id, productId: c.product, size: 'S', qty: 1, configurationKey: `${c.product}:S` } });
    const pricing = app.get(PricingService), original = pricing.validateCart.bind(pricing);
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>(r => { release = r; });
    const spy = jest.spyOn(pricing, 'validateCart').mockImplementation(async (...args) => { const value = await original(...args); if (args[1] === u.id || args[1] === v.id) {
        arrived++;
        if (arrived === 2)
            release();
        await barrier;
    } return value; });
    try {
        const results = await Promise.all([create(u, { ...c.body, redeemedPoints: 10 }), create(v, { ...c.body, redeemedPoints: 10 })]);
        expect(results.map(r => r.status).sort()).toEqual([201, 409]);
        const states = await Promise.all([proof(u), proof(v)]);
        expect(states.map(s => s.available).sort()).toEqual(['100', '90']);
        expect(states.map(s => s.reserved).sort()).toEqual(['0', '10']);
        expect((await prisma.product.findUniqueOrThrow({ where: { id: c.product } })).stock).toBe(0);
    }
    finally {
        spy.mockRestore();
    }
});
test('S08 stable sequence DESC across tied timestamps/default20/max50 and new commits above cursor U', async () => {
    const u = await owner();
    await client.query("CREATE FUNCTION l01_tied_time() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.created_at=date_trunc('day',now()); RETURN NEW; END $$");
    await client.query('CREATE TRIGGER l01_tied_time BEFORE INSERT ON loyalty_entries FOR EACH ROW EXECUTE FUNCTION l01_tied_time()');
    try {
        for (let i = 0; i < 23; i++)
            await earn(u, '10000');
    }
    finally {
        await client.query('DROP TRIGGER l01_tied_time ON loyalty_entries');
        await client.query('DROP FUNCTION l01_tied_time()');
    }
    const initial = await history(u).expect(200), page = initial.body as HistoryBody;
    expect(page.items).toHaveLength(20);
    await earn(u, '10000');
    const rest = await history(u, '?cursor=' + page.nextCursor).expect(200);
    expect((rest.body as HistoryBody).items).toHaveLength(3);
    const all = await history(u, '?limit=50').expect(200);
    expect((all.body as HistoryBody).items).toHaveLength(24);
    expect((all.body as HistoryBody).nextCursor).toBeNull();
    const before = await snapshot(u);
    await history(u).expect(200);
    await balance(u).expect(200);
    expect(await snapshot(u)).toEqual(before);
    await proof(u);
});

test('L05 insufficient points after legitimate original reversal rejects failed retry before mock/stock/cycle', async () => {
    const u=await owner();const a=await earn(u);const c=await cart(u,'100000');
    const result=await create(u,{...c.body,redeemedPoints:50}).expect(201);const id=(result.body as {id:string}).id;
    mode='FAILURE';await pay(u,id).expect(200);await paidCancel(a);
    expect(await proof(u)).toEqual({available:'0',reserved:'0',debt:'0'});
    const before=await snapshot(u);mockCalls=0;const response=await pay(u,id).expect(409);
    expect((response.body as {error:{code:string}}).error.code).toBe('LOYALTY_INSUFFICIENT_POINTS');
    expect(mockCalls).toBe(0);expect(await snapshot(u)).toEqual(before);await cancel(u,id).expect(200);
});
test('L14 positive redemption preparation/completion leaves all accounting, Payment and stock unchanged', async () => {
    const u=await owner();await earn(u);const c=await cart(u,'100000');
    const result=await create(u,{...c.body,redeemedPoints:50}).expect(201);const id=(result.body as {id:string}).id;
    await pay(u,id).expect(200);const before=await snapshot(u);const stock=await prisma.product.findUniqueOrThrow({where:{id:c.product}});
    for(const target of ['PREPARING','READY','COMPLETED'] as const){const row=await prisma.order.findUniqueOrThrow({where:{id}});await orders.transitionOrder(id,row.version,target);}
    const after=await snapshot(u);
    for(const key of ['u','payments','awards','entries','claims','cart'] as const)expect(after[key]).toEqual(before[key]);
    expect(await prisma.product.findUniqueOrThrow({where:{id:c.product}})).toEqual(stock);
    expect((await prisma.order.findUniqueOrThrow({where:{id}})).redemptionState).toBe('SETTLED');await proof(u);
});
