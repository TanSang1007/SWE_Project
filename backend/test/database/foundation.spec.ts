import { utcConnectionString } from '../../src/database/pg-connection';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../../src/generated/prisma/client';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('Database tests require a local development/test URL');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) {
  throw new Error('Database tests only accept local databases ending in _dev or _test');
}
const schema = `brewlite_b04_test_${randomUUID().replaceAll('-', '')}`;
const client = new Client({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: utcConnectionString(connectionString) }, { schema }) });
const user = randomUUID();
const product = randomUUID();
const order = randomUUID();
const item = randomUUID();
const topping = randomUUID();
const promotion = randomUUID();

async function rejected(sql: string, values: unknown[], code: string): Promise<void> {
  await client.query('SAVEPOINT expected_failure');
  try { await expect(client.query(sql, values)).rejects.toMatchObject({ code }); }
  finally { await client.query('ROLLBACK TO SAVEPOINT expected_failure'); }
}

beforeAll(async () => {
  await client.connect();
  // Generated identifier only, never user input. Public schema remains untouched.
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  const migrations = resolve(__dirname, '../../prisma/migrations');
  for (const dir of readdirSync(migrations).filter((entry) => /^\d+_/.test(entry)).sort()) {
    await client.query(readFileSync(resolve(migrations, dir, 'migration.sql'), 'utf8'));
  }
});
afterAll(async () => {
  await prisma.$disconnect();
  // Only this run's known, generated test schema is removed.
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});
beforeEach(async () => {
  await client.query('BEGIN');
  await client.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [user, 'fixture@example.invalid', 'NON_LOGIN_TEST_FIXTURE']);
  await client.query('INSERT INTO products(id,name,price,image_url,stock) VALUES($1,$2,45000,$3,20)', [product, 'Fixture', '/images/fixture.jpg']);
  await client.query('INSERT INTO toppings(id,name,price) VALUES($1,$2,5000)', [topping, 'Fixture topping']);
  await client.query("INSERT INTO product_sizes VALUES($1,'M',5000)", [product]);
  await client.query('INSERT INTO product_toppings VALUES($1,$2)', [product, topping]);
  await client.query("INSERT INTO promotions(id,code,discount_amount,starts_at,ends_at,is_active) VALUES($1,'FIXTURE',10000,'2026-01-01Z','2027-01-01Z',true)", [promotion]);
  await client.query("INSERT INTO orders(id,order_code,user_id,status,subtotal,total) VALUES($1,'FIXTURE',$2,'PENDING',120000,120000)", [order, user]);
  await client.query("INSERT INTO order_items(id,order_id,product_id,product_name_snapshot,size,base_price,size_extra_price,unit_price,qty,line_total) VALUES($1,$2,$3,'Fixture','M',45000,5000,60000,2,120000)", [item, order, product]);
  await client.query("INSERT INTO order_item_toppings VALUES($1,$2,'Fixture',5000)", [item, topping]);
});
afterEach(async () => { await client.query('ROLLBACK'); });

test('unique email, order code, promotion code and composite references reject duplicates', async () => {
  await rejected('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)', [randomUUID(), 'fixture@example.invalid', 'FIXTURE'], '23505');
  await rejected("INSERT INTO orders(id,order_code,user_id,status,subtotal,total) VALUES($1,'FIXTURE',$2,'PENDING',0,0)", [randomUUID(), user], '23505');
  await rejected("INSERT INTO promotions(id,code,discount_amount,starts_at,ends_at,is_active) VALUES($1,'FIXTURE',1,'2026-01-01Z','2027-01-01Z',true)", [randomUUID()], '23505');
  await rejected("INSERT INTO product_sizes VALUES($1,'M',0)", [product], '23505');
  await rejected('INSERT INTO product_toppings VALUES($1,$2)', [product, topping], '23505');
  await rejected("INSERT INTO order_item_toppings VALUES($1,$2,'Fixture',0)", [item, topping], '23505');
});

test('required FK and NOT NULL relations reject missing owners/products', async () => {
  await rejected('UPDATE orders SET user_id=$1 WHERE id=$2', [randomUUID(), order], '23503');
  await rejected('UPDATE orders SET user_id=NULL WHERE id=$1', [order], '23502');
  await rejected('UPDATE order_items SET product_id=$1 WHERE id=$2', [randomUUID(), item], '23503');
  await rejected('UPDATE product_sizes SET product_id=$1', [randomUUID()], '23503');
});

test('historical FKs restrict deletes and cascade key updates; optional promotion permits NULL', async () => {
  for (const [table, id] of [['users', user], ['products', product], ['orders', order], ['toppings', topping], ['order_items', item]]) {
    await rejected(`DELETE FROM ${table} WHERE id=$1`, [id], '23001');
  }
  const newId = randomUUID();
  await client.query('UPDATE products SET id=$1 WHERE id=$2', [newId, product]);
  expect((await client.query('SELECT product_id FROM order_items WHERE id=$1', [item])).rows[0]).toEqual({ product_id: newId });
  expect((await client.query('SELECT promotion_id FROM orders WHERE id=$1', [order])).rows[0]).toEqual({ promotion_id: null });
});

test.each([
  ['users', 'loyalty_points', '-1'], ['products', 'price', '-1'], ['products', 'stock', '-1'], ['products', 'version', '-1'],
  ['product_sizes', 'extra_price', '-1'], ['product_sizes', 'size', "'XL'"], ['toppings', 'price', '-1'],
  ['promotions', 'discount_amount', '0'], ['promotions', 'minimum_subtotal', '-1'], ['promotions', 'ends_at', 'starts_at'],
  ['orders', 'subtotal', '-1'], ['orders', 'discount_amount', '-1'], ['orders', 'discount_amount', '120001'],
  ['orders', 'total', '-1'], ['orders', 'total', '1'], ['orders', 'version', '-1'],
  ['orders', 'promotion_code_snapshot', "'MISSING_ID'"],
  ['order_items', 'base_price', '-1'], ['order_items', 'size_extra_price', '-1'], ['order_items', 'unit_price', '-1'],
  ['order_items', 'qty', '0'], ['order_items', 'qty', '100'], ['order_items', 'line_total', '1'], ['order_items', 'size', "'XL'"],
  ['order_item_toppings', 'price_snapshot', '-1'],
])('%s.%s rejects invalid value %s', async (table, column, value) => {
  await rejected(`UPDATE ${table} SET ${column}=${value}`, [], '23514');
});

test('discount snapshot supports fixed amount and rejects discount without promotion', async () => {
  await rejected('UPDATE orders SET discount_amount=10000,total=110000 WHERE id=$1', [order], '23514');
  await client.query("UPDATE orders SET promotion_id=$1,promotion_code_snapshot='FIXTURE',discount_amount=10000,total=110000 WHERE id=$2", [promotion, order]);
  expect((await client.query('SELECT total::text FROM orders')).rows[0]).toEqual({ total: '110000' });
  await rejected('DELETE FROM promotions WHERE id=$1', [promotion], '23001');
});

test('Prisma Decimal round trips exact maximum VND and timestamps/defaults', async () => {
  const id = randomUUID();
  try {
    const row = await prisma.product.create({ data: { id, name: 'Decimal fixture', price: new Prisma.Decimal('999999999999'), imageUrl: '/images/fixture.jpg', stock: 0 } });
    expect(row.price.toFixed(0)).toBe('999999999999');
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).price.toFixed(0)).toBe('999999999999');
    expect(row.version).toBe(0);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
    await expect(prisma.product.update({ where: { id }, data: { price: new Prisma.Decimal('1000000000000') } })).rejects.toThrow();
  } finally { await prisma.product.deleteMany({ where: { id } }); }
});

test('idempotency scope/state/result/HTTP bounds and enum persistence', async () => {
  const id = randomUUID();
  await client.query("INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state) VALUES($1,$2,'CREATE_ORDER','key','fixture','PROCESSING')", [id, user]);
  await rejected("INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state) VALUES($1,$2,'CREATE_ORDER','key','fixture','PROCESSING')", [randomUUID(), user], '23505');
  await client.query("INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state) VALUES($1,$2,'PAY_ORDER','key','fixture','PROCESSING')", [randomUUID(), user]);
  await rejected("UPDATE idempotency_requests SET state='COMPLETED' WHERE id=$1", [id], '23514');
  await rejected('UPDATE idempotency_requests SET response_status=99 WHERE id=$1', [id], '23514');
  await client.query("UPDATE idempotency_requests SET state='COMPLETED',order_id=$1,response_status=201,response_body='{}',completed_at=CURRENT_TIMESTAMP WHERE id=$2", [order, id]);
  await rejected('UPDATE idempotency_requests SET response_status=600 WHERE id=$1', [id], '23514');
  for (const status of ['PENDING', 'PAID', 'PAYMENT_FAILED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED']) {
    await client.query('UPDATE orders SET status=$1 WHERE id=$2', [status, order]);
    expect((await client.query('SELECT status FROM orders')).rows[0]).toEqual({ status });
  }
  await rejected("UPDATE orders SET status='CONFIRMED'", [], '22P02');
});

async function payment(status: string, failure: string | null, amount = '120000', key = randomUUID()): Promise<string> {
  const request = randomUUID();
  const id = randomUUID();
  await client.query("INSERT INTO idempotency_requests(id,user_id,operation,idempotency_key,request_hash,state,order_id,response_status,response_body,completed_at) VALUES($1,$2,'PAY_ORDER',$3,'fixture','COMPLETED',$4,200,'{}',CURRENT_TIMESTAMP)", [request, user, key, order]);
  await client.query("INSERT INTO payments(id,order_id,user_id,idempotency_request_id,idempotency_key,amount,method,status,failure_code) VALUES($1,$2,$3,$4,$5,$6,'WALLET',$7,$8)", [id, order, user, request, key, amount, status, failure]);
  return id;
}

test('payment SQL checks and partial unique allow failed attempts but only one success', async () => {
  await payment('FAILED', 'MOCK_DECLINED');
  await payment('FAILED', 'MOCK_DECLINED');
  await client.query('SAVEPOINT invalid_payment');
  await expect(payment('FAILED', null)).rejects.toMatchObject({ code: '23514' });
  await client.query('ROLLBACK TO SAVEPOINT invalid_payment');
  const id = await payment('SUCCEEDED', null);
  await rejected('UPDATE payments SET amount=-1 WHERE id=$1', [id], '23514');
  await rejected("UPDATE payments SET failure_code='unexpected' WHERE id=$1", [id], '23514');
  await client.query('SAVEPOINT duplicate_success');
  await expect(payment('SUCCEEDED', null)).rejects.toMatchObject({ code: '23505', constraint: 'payments_one_success_per_order_idx' });
  await client.query('ROLLBACK TO SAVEPOINT duplicate_success');
  await client.query("UPDATE payments SET method='CARD' WHERE id=$1", [id]);
  expect((await client.query<{ created_at: Date }>('SELECT created_at FROM payments WHERE id=$1', [id])).rows[0].created_at).toBeInstanceOf(Date);
});

test('integer original earned points and reversal timestamp persist without deleting payment history', async () => {
  const id = randomUUID();
  await client.query('INSERT INTO loyalty_awards(id,order_id,user_id,points) VALUES($1,$2,$3,12)', [id, order, user]);
  await rejected('INSERT INTO loyalty_awards(id,order_id,user_id,points) VALUES($1,$2,$3,12)', [randomUUID(), order, user], '23505');
  await rejected('UPDATE loyalty_awards SET points=-1', [], '23514');
  await rejected("UPDATE loyalty_awards SET reversed_at=created_at-interval '1 second'", [], '23514');
  const paid = await payment('SUCCEEDED', null);
  await client.query("UPDATE orders SET status='PAID',paid_at=CURRENT_TIMESTAMP WHERE id=$1", [order]);
  await client.query('UPDATE loyalty_awards SET reversed_at=created_at');
  await client.query("UPDATE orders SET status='CANCELLED' WHERE id=$1", [order]);
  const result = await client.query<{ points: number; type: string; reversed_at: Date }>('SELECT points,pg_typeof(points)::text AS type,reversed_at FROM loyalty_awards');
  expect(result.rows[0]).toMatchObject({ points: 12, type: 'integer' });
  expect(result.rows[0].reversed_at).toBeInstanceOf(Date);
  expect((await client.query<{ paid_at: Date }>('SELECT paid_at FROM orders')).rows[0].paid_at).toBeInstanceOf(Date);
  expect((await client.query('SELECT status FROM payments WHERE id=$1', [paid])).rows[0]).toEqual({ status: 'SUCCEEDED' });
});

test('seed reruns keep reference data unique and preserve consumed stock/version', async () => {
  const seedUrl = new URL(connectionString);
  seedUrl.searchParams.set('options', `-c search_path=${schema}`);
  const runSeed = (): void => {
    execFileSync(process.execPath, [resolve(__dirname, '../../prisma/seed.cjs')], {
      env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: seedUrl.toString() },
      stdio: 'pipe',
    });
  };
  runSeed();
  const id = '11111111-1111-4111-8111-111111111111';
  // This transaction sees the committed seed catalog in the isolated test schema.
  await client.query('UPDATE products SET stock=3,version=7 WHERE id=$1', [id]);
  await client.query('COMMIT');
  runSeed();
  await client.query('BEGIN');
  expect((await client.query('SELECT stock,version FROM products WHERE id=$1', [id])).rows[0]).toEqual({ stock: 3, version: 7 });
  expect((await client.query('SELECT count(*)::int AS count FROM product_sizes WHERE product_id IN ($1,$2)', [id, '11111111-1111-4111-8111-111111111112'])).rows[0]).toEqual({ count: 6 });
  expect((await client.query('SELECT count(*)::int AS count FROM product_toppings WHERE product_id IN ($1,$2)', [id, '11111111-1111-4111-8111-111111111112'])).rows[0]).toEqual({ count: 4 });
});
