// Small development catalog/promotion and demo accounts with short sequential IDs (BR001 for products, 1..N for others).
const { Client } = require('pg');
const { hash } = require('bcrypt');
const { resolve } = require('node:path');
require('dotenv').config({ path: resolve(__dirname, '../../.env'), quiet: true });

const sequences = [
  ['products_id_seq', 'products', "('BR' || lpad(nextval('products_id_seq')::text, 3, '0'))"],
  ['users_id_seq', 'users', "(nextval('users_id_seq')::text)"],
  ['toppings_id_seq', 'toppings', "(nextval('toppings_id_seq')::text)"],
  ['promotions_id_seq', 'promotions', "(nextval('promotions_id_seq')::text)"],
  ['orders_id_seq', 'orders', "(nextval('orders_id_seq')::text)"],
  ['order_items_id_seq', 'order_items', "(nextval('order_items_id_seq')::text)"],
  ['carts_id_seq', 'carts', "(nextval('carts_id_seq')::text)"],
  ['cart_items_id_seq', 'cart_items', "(nextval('cart_items_id_seq')::text)"],
  ['payments_id_seq', 'payments', "(nextval('payments_id_seq')::text)"],
  ['payment_attempts_id_seq', 'payment_attempts', "(nextval('payment_attempts_id_seq')::text)"],
  ['payment_verifications_id_seq', 'payment_verifications', "(nextval('payment_verifications_id_seq')::text)"],
  ['idempotency_requests_id_seq', 'idempotency_requests', "(nextval('idempotency_requests_id_seq')::text)"],
  ['loyalty_awards_id_seq', 'loyalty_awards', "(nextval('loyalty_awards_id_seq')::text)"],
  ['loyalty_entries_id_seq', 'loyalty_entries', "(nextval('loyalty_entries_id_seq')::text)"],
  ['auth_sessions_id_seq', 'auth_sessions', "(nextval('auth_sessions_id_seq')::text)"],
  ['ingredients_id_seq', 'ingredients', "(nextval('ingredients_id_seq')::text)"],
  ['ingredient_receipts_id_seq', 'ingredient_receipts', "(nextval('ingredient_receipts_id_seq')::text)"],
  ['ingredient_receipt_lines_id_seq', 'ingredient_receipt_lines', "(nextval('ingredient_receipt_lines_id_seq')::text)"],
  ['ingredient_counts_id_seq', 'ingredient_counts', "(nextval('ingredient_counts_id_seq')::text)"],
  ['ingredient_count_lines_id_seq', 'ingredient_count_lines', "(nextval('ingredient_count_lines_id_seq')::text)"],
  ['ingredient_movements_id_seq', 'ingredient_movements', "(nextval('ingredient_movements_id_seq')::text)"],
];

const demoUsers = [
  ['1', 'admin.demo@brewlite.local', 'AdminPass123!', 'ADMIN'],
  ['2', 'staff.demo@brewlite.local', 'StaffPass123!', 'STAFF'],
  ['3', 'customer.demo@brewlite.local', 'Customer123!', 'CUSTOMER'],
];

const products = [
  ['BR001', 'Cappuccino', '45000', '/images/cappuccino.jpg', 20],
  ['BR002', 'Latte', '40000', '/images/latte.jpg', 20],
];

const toppings = [
  ['1', 'Kem', '5000'],
  ['2', 'Caramel', '7000'],
];

async function ensureShortIdSchema(client) {
  for (const [seq] of sequences) {
    await client.query(`CREATE SEQUENCE IF NOT EXISTS "${seq}" START WITH 1 INCREMENT BY 1`);
  }
  const uuidCols = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid' AND table_name <> '_prisma_migrations'
    ORDER BY table_name, column_name
  `);
  const hasLegacyUuidRows = await client.query(`
    SELECT (
      EXISTS (SELECT 1 FROM products WHERE id::text ~ '-')
      OR EXISTS (SELECT 1 FROM toppings WHERE id::text ~ '-')
      OR EXISTS (SELECT 1 FROM users WHERE id::text ~ '-')
      OR EXISTS (SELECT 1 FROM promotions WHERE id::text ~ '-')
    ) AS legacy
  `);
  if (uuidCols.rowCount > 0 || hasLegacyUuidRows.rows[0]?.legacy) {
    const allTables = sequences.map(([, t]) => `"${t}"`).concat(['"product_sizes"', '"product_toppings"', '"order_item_toppings"', '"cart_item_toppings"']);
    await client.query(`TRUNCATE TABLE ${allTables.join(', ')} RESTART IDENTITY CASCADE`);
    for (const [seq] of sequences) {
      await client.query(`SELECT setval('${seq}', 1, false)`);
    }
  }
  if (uuidCols.rowCount > 0) {
    const constraints = await client.query(`
      SELECT con.conname AS name, rel.relname AS table_name, con.contype AS type, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public' AND con.contype IN ('f', 'c') AND rel.relname <> '_prisma_migrations'
      ORDER BY CASE WHEN con.contype = 'f' THEN 0 ELSE 1 END, rel.relname, con.conname
    `);
    for (const c of constraints.rows) {
      await client.query(`ALTER TABLE "${c.table_name}" DROP CONSTRAINT "${c.name}"`);
    }
    for (const col of uuidCols.rows) {
      await client.query(`ALTER TABLE "${col.table_name}" ALTER COLUMN "${col.column_name}" TYPE TEXT USING "${col.column_name}"::text`);
    }
    for (const c of constraints.rows) {
      await client.query(`ALTER TABLE "${c.table_name}" ADD CONSTRAINT "${c.name}" ${c.def}`);
    }
  }
  for (const [, table, defaultExpr] of sequences) {
    const exists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    if (exists.rowCount > 0) {
      await client.query(`ALTER TABLE "${table}" ALTER COLUMN "id" SET DEFAULT ${defaultExpr}`);
    }
  }
}

async function syncSequences(client) {
  await client.query(`
    SELECT setval(
      'products_id_seq',
      GREATEST(COALESCE((SELECT MAX(SUBSTRING(id FROM '^BR([0-9]+)$')::bigint) FROM products WHERE id ~ '^BR[0-9]+$'), 0), 2),
      true
    )
  `);
  for (const [seq, table] of sequences.slice(1)) {
    const exists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    );
    if (exists.rowCount > 0) {
      const res = await client.query(`SELECT COALESCE(MAX(id::bigint), 0) AS max_id FROM "${table}" WHERE id ~ '^[0-9]+$'`);
      const maxId = Number(res.rows[0]?.max_id ?? 0);
      if (maxId > 0) {
        await client.query(`SELECT setval('${seq}', $1, true)`, [maxId]);
      }
    }
  }
}

async function seedPromotion(client) {
  await ensureShortIdSchema(client);
  await client.query(
    `INSERT INTO promotions(id,code,discount_amount,minimum_subtotal,starts_at,ends_at,is_active)
     VALUES($1,'BREW10K',10000,0,'2026-01-01T00:00:00Z','2028-01-01T00:00:00Z',true)
     ON CONFLICT DO NOTHING`,
    ['1'],
  );
  await syncSequences(client);
}

async function seed(client) {
  await client.query('BEGIN');
  try {
    await ensureShortIdSchema(client);
    for (const [id, email, plainPassword, role] of demoUsers) {
      const passwordHash = await hash(plainPassword, 10);
      await client.query(
        `INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)
         ON CONFLICT(email) DO UPDATE SET role=EXCLUDED.role,updated_at=CURRENT_TIMESTAMP`,
        [id, email, passwordHash, role],
      );
    }
    for (const product of products) {
      await client.query(
        `INSERT INTO products(id,name,price,image_url,stock) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,price=EXCLUDED.price,image_url=EXCLUDED.image_url,updated_at=CURRENT_TIMESTAMP`,
        product,
      );
      for (const [size, price] of [['S', '0'], ['M', '5000'], ['L', '10000']]) {
        await client.query(
          `INSERT INTO product_sizes(product_id,size,extra_price) VALUES($1,$2,$3)
           ON CONFLICT(product_id,size) DO UPDATE SET extra_price=EXCLUDED.extra_price`,
          [product[0], size, price],
        );
      }
    }
    for (const topping of toppings) {
      await client.query(
        `INSERT INTO toppings(id,name,price) VALUES($1,$2,$3)
         ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,price=EXCLUDED.price,updated_at=CURRENT_TIMESTAMP`,
        topping,
      );
      for (const product of products) {
        await client.query(
          'INSERT INTO product_toppings(product_id,topping_id) VALUES($1,$2) ON CONFLICT(product_id,topping_id) DO NOTHING',
          [product[0], topping[0]],
        );
      }
    }
    await seedPromotion(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  if (process.env.NODE_ENV !== 'development') throw new Error('Seed requires NODE_ENV=development');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (process.argv.includes('--promotion-only')) {
      await seedPromotion(client);
      console.log('Seed PASS: BREW10K promotion only; existing rows preserved');
    } else {
      await seed(client);
      console.log('Seed PASS: catalog (BR001, BR002), toppings (1, 2), demo accounts (1, 2, 3), and BREW10K promotion ready');
    }
  } finally {
    await client.end();
  }
}

module.exports = { seed, seedPromotion };
if (require.main === module) {
  main().catch((err) => {
    console.error('Seed failed:', err?.message || 'credentials suppressed');
    process.exitCode = 1;
  });
}
