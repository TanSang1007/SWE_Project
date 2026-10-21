// Small development catalog/promotion; stable IDs, no users/passwords/orders/payments.
const { Client } = require('pg');
const { resolve } = require('node:path');
require('dotenv').config({ path: resolve(__dirname, '../../.env'), quiet: true });

const products = [
  ['11111111-1111-4111-8111-111111111111', 'Cappuccino', '45000', '/images/cappuccino.jpg', 20],
  ['11111111-1111-4111-8111-111111111112', 'Latte', '40000', '/images/latte.jpg', 20],
];
const toppings = [
  ['22222222-2222-4222-8222-222222222221', 'Kem', '5000'],
  ['22222222-2222-4222-8222-222222222222', 'Caramel', '7000'],
];

async function seedPromotion(client) {
  // Demo configuration, not business constants. Never reactivate/reprice an existing code.
  await client.query(`INSERT INTO promotions(id,code,discount_amount,minimum_subtotal,starts_at,ends_at,is_active)
    VALUES($1,'BREW10K',10000,0,'2026-01-01T00:00:00Z','2028-01-01T00:00:00Z',true)
    ON CONFLICT DO NOTHING`, ['44444444-4444-4444-8444-444444444441']);
}

async function seed(client) {
  await client.query('BEGIN');
  try {
    for (const product of products) {
      // Reruns preserve stock/version: seed must not restore consumed inventory.
      await client.query(`INSERT INTO products(id,name,price,image_url,stock) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,price=EXCLUDED.price,image_url=EXCLUDED.image_url,updated_at=CURRENT_TIMESTAMP`, product);
      for (const [size, price] of [['S', '0'], ['M', '5000'], ['L', '10000']]) {
        await client.query(`INSERT INTO product_sizes(product_id,size,extra_price) VALUES($1,$2,$3)
          ON CONFLICT(product_id,size) DO UPDATE SET extra_price=EXCLUDED.extra_price`, [product[0], size, price]);
      }
    }
    for (const topping of toppings) {
      await client.query(`INSERT INTO toppings(id,name,price) VALUES($1,$2,$3)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,price=EXCLUDED.price,updated_at=CURRENT_TIMESTAMP`, topping);
      for (const product of products) {
        await client.query('INSERT INTO product_toppings(product_id,topping_id) VALUES($1,$2) ON CONFLICT(product_id,topping_id) DO NOTHING', [product[0], topping[0]]);
      }
    }
    await seedPromotion(client);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

async function main() {
  if (process.env.NODE_ENV !== 'development') throw new Error('Seed requires NODE_ENV=development');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (process.argv.includes('--promotion-only')) {
      await seedPromotion(client); console.log('Seed PASS: BREW10K promotion only; existing rows preserved');
    } else {
      await seed(client); console.log('Seed PASS: catalog and BREW10K demo promotion; existing stock/promotion configuration preserved');
    }
  }
  finally { await client.end(); }
}
module.exports = { seed, seedPromotion };
if (require.main === module) main().catch(() => { console.error('Seed failed; credentials suppressed'); process.exitCode = 1; });
