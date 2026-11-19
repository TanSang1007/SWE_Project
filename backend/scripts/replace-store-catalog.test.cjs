const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { replaceCatalog } = require('./replace-store-catalog.cjs');

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname) || !/_test$/.test(new URL(connectionString).pathname)) {
  throw Error('Explicit local TEST_DATABASE_URL ending in _test required');
}
const drinks = ['Cappuccino', 'Latte', 'Cold brew', 'Đen đá', 'Asian Dolce Latte', 'Matcha Coldwisk', 'Cacao đá'];
let db, schema;
beforeEach(async () => {
  schema = 'catalog_replace_' + randomUUID().replaceAll('-', '');
  db = new Client({ connectionString });
  await db.connect();
  await db.query(`CREATE SCHEMA "${schema}"`);
  await db.query(`SET search_path TO "${schema}"`);
  // Real PostgreSQL FK/default/CASCADE behavior in an isolated schema; no app workers.
  await db.query(`CREATE SEQUENCE products_id_seq START 100;
    CREATE TABLE products(id TEXT PRIMARY KEY DEFAULT ('BR' || lpad(nextval('products_id_seq')::text,3,'0')),
      name TEXT NOT NULL,price DECIMAL(12,0) NOT NULL,image_url TEXT NOT NULL,stock INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,has_custom_recipe BOOLEAN NOT NULL DEFAULT false,
      version INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE product_sizes(product_id TEXT REFERENCES products(id) ON DELETE RESTRICT,size TEXT,
      extra_price DECIMAL(12,0),is_active BOOLEAN DEFAULT true,PRIMARY KEY(product_id,size));
    CREATE TABLE toppings(id TEXT PRIMARY KEY);
    CREATE TABLE product_toppings(product_id TEXT REFERENCES products(id) ON DELETE RESTRICT,topping_id TEXT REFERENCES toppings(id),PRIMARY KEY(product_id,topping_id));
    CREATE TABLE order_items(id TEXT PRIMARY KEY,product_id TEXT REFERENCES products(id) ON DELETE RESTRICT);
    CREATE TABLE cart_items(id TEXT PRIMARY KEY,product_id TEXT REFERENCES products(id) ON DELETE RESTRICT);
    CREATE TABLE product_size_recipe_ingredients(product_id TEXT REFERENCES products(id) ON DELETE CASCADE,size TEXT,quantity DECIMAL(12,3),
      FOREIGN KEY(product_id,size) REFERENCES product_sizes(product_id,size) ON DELETE CASCADE);
    INSERT INTO toppings VALUES('cream');`);
  for (const [index, name] of drinks.entries()) {
    const id = 'old-' + index;
    await db.query('INSERT INTO products(id,name,price,image_url,stock,is_active) VALUES($1,$2,$3,$4,0,$5)', [id, name, String(40000 + index * 1000), '/images/old.jpg', index !== 0]);
    for (const [size, price] of [['S', '0'], ['M', '5000'], ['L', '10000']]) {
      await db.query('INSERT INTO product_sizes(product_id,size,extra_price) VALUES($1,$2,$3)', [id, size, price]);
    }
    await db.query("INSERT INTO product_toppings VALUES($1,'cream')", [id]);
  }
  await db.query("INSERT INTO order_items VALUES('order-item','old-0'); INSERT INTO cart_items VALUES('cart-item','old-1'); INSERT INTO product_size_recipe_ingredients VALUES('old-0','S',0.015),('old-2','S',0.020)");
});
afterEach(async () => {
  if (db) {
    if (/^catalog_replace_[a-f0-9]{32}$/.test(schema)) await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    await db.end();
  }
});
const rows = async table => (await db.query('SELECT * FROM ' + table + ' ORDER BY 1,2')).rows;
async function capture() {
  const result = {};
  for (const table of ['products', 'product_sizes', 'product_toppings', 'order_items', 'cart_items', 'product_size_recipe_ingredients']) result[table] = await rows(table);
  return result;
}

test('check is read-only, includes seven existing prices/photos and separates history from unused products', async () => {
  const before = await capture();
  const plan = await replaceCatalog(db);
  assert.equal(plan.items.length, 7);
  assert.deepEqual(plan.archiveIds, ['old-0', 'old-1']);
  assert.equal(plan.deleteIds.length, 5);
  assert.deepEqual(plan.items.map(item => item.price), drinks.map((_, index) => String(40000 + index * 1000)));
  assert(plan.items.every(item => item.imageUrl.startsWith('/images/') && item.imageUrl.endsWith('.jpg')));
  assert.deepEqual(await capture(), before);
  assert.equal((await db.query('SELECT is_called FROM products_id_seq')).rows[0].is_called, false);
});

test('apply replaces the menu with new IDs and S/M/L, preserves prices, toppings, carts and order references; stale retry refuses writes', async () => {
  const before = await capture();
  const plan = await replaceCatalog(db);
  const result = await replaceCatalog(db, { apply: true, expectedHash: plan.expectedHash });
  assert.equal(result.applied, true);
  const active = (await db.query('SELECT * FROM products WHERE is_active=true ORDER BY id')).rows;
  assert.deepEqual(active.map(item => item.id), ['BR100', 'BR101', 'BR102', 'BR103', 'BR104', 'BR105', 'BR106']);
  assert.deepEqual(active.map(item => item.name), drinks);
  assert(active.every(item => item.stock === 0 && !item.has_custom_recipe));
  for (const [index, product] of active.entries()) {
    assert.equal(product.price, plan.items[index].price);
    assert.equal(product.image_url, plan.items[index].imageUrl);
    assert.equal((await db.query('SELECT * FROM product_sizes WHERE product_id=$1', [product.id])).rowCount, 3);
    assert.equal((await db.query('SELECT * FROM product_toppings WHERE product_id=$1', [product.id])).rowCount, 1);
  }
  assert.equal((await rows('products')).length, 9);
  for (const id of plan.archiveIds) {
    assert.equal((await db.query('SELECT is_active FROM products WHERE id=$1', [id])).rows[0].is_active, false);
    assert.deepEqual((await rows('product_sizes')).filter(row => row.product_id === id), before.product_sizes.filter(row => row.product_id === id));
  }
  assert.deepEqual(await rows('order_items'), before.order_items);
  assert.deepEqual(await rows('cart_items'), before.cart_items);
  assert.deepEqual(await rows('product_size_recipe_ingredients'), before.product_size_recipe_ingredients.filter(row => row.product_id === 'old-0'));
  const after = await capture();
  await assert.rejects(replaceCatalog(db, { apply: true, expectedHash: plan.expectedHash }), /Catalog changed/);
  assert.deepEqual(await capture(), after);
});

test('an insertion failure rolls back deletions, archival and partially created drinks', async () => {
  await db.query("ALTER TABLE products ADD CONSTRAINT synthetic_failure CHECK (id NOT LIKE 'BR%' OR name <> 'Latte')");
  const before = await capture(), plan = await replaceCatalog(db);
  await assert.rejects(replaceCatalog(db, { apply: true, expectedHash: plan.expectedHash }), /synthetic_failure/);
  assert.deepEqual(await capture(), before);
});

test('missing S/M/L or conflicting current prices abort before any catalog changes', async () => {
  await db.query("DELETE FROM product_sizes WHERE product_id='old-6' AND size='L'");
  let before = await capture();
  await assert.rejects(replaceCatalog(db), /S\/M\/L/);
  assert.deepEqual(await capture(), before);
  await db.query("INSERT INTO product_sizes VALUES('old-6','L',10000,true); INSERT INTO products(id,name,price,image_url,stock) VALUES('duplicate','Latte',1,'/images/latte.jpg',0)");
  before = await capture();
  await assert.rejects(replaceCatalog(db), /ambiguous current price/);
  assert.deepEqual(await capture(), before);
});
