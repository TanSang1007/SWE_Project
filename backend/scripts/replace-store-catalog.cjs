// User-requested replacement of the store menu. Never seed/reset the database.
// Referenced products stay inactive for historical orders/carts; unused ones are deleted.
// Prices, size surcharges and topping links come from the oldest matching drink.
const { createHash } = require('node:crypto');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { Client } = require('pg');

const menu = [
  ['Cappuccino', 'cappuccino.jpg'],
  ['Latte', 'latte.jpg'],
  ['Cold brew', 'cold-brew.jpg'],
  ['Đen đá', 'den-da.jpg'],
  ['Asian Dolce Latte', 'asian-dolce-latte.jpg'],
  ['Matcha Coldwisk', 'coldwisk.jpg'],
  ['Cacao đá', 'cacao-da.jpg'],
];
const normalize = value => value.trim().replace(/\s+/g, ' ').normalize('NFC').toLocaleLowerCase('vi');

async function snapshot(db) {
  const { rows } = await db.query(`SELECT p.id,p.name,p.price::text,p.is_active,p.version,p.image_url,p.has_custom_recipe,
    (SELECT json_agg(json_build_object('size',s.size,'extraPrice',s.extra_price::text) ORDER BY s.size)
      FROM product_sizes s WHERE s.product_id=p.id) AS sizes,
    (SELECT COALESCE(json_agg(t.topping_id::text ORDER BY t.topping_id), '[]'::json)
      FROM product_toppings t WHERE t.product_id=p.id) AS toppings,
    EXISTS(SELECT 1 FROM order_items i WHERE i.product_id=p.id)
      OR EXISTS(SELECT 1 FROM cart_items i WHERE i.product_id=p.id) AS referenced
    FROM products p ORDER BY p.created_at,p.id`);
  return rows;
}

function planCatalog(rows) {
  const items = menu.map(([name, photo]) => {
    const matches = rows.filter(row => normalize(row.name) === normalize(name));
    const source = matches[0];
    if (!source || new Set(matches.map(row => row.price)).size !== 1) throw Error('Missing or ambiguous current price: ' + name);
    if (!source.sizes || source.sizes.length !== 3 || !['S', 'M', 'L'].every(size => source.sizes.some(row => row.size === size))) {
      throw Error('Expected existing S/M/L prices: ' + name);
    }
    if (!existsSync(resolve(__dirname, '../../frontend/public/images', photo))) throw Error('Missing local photo: ' + photo);
    return { name, price: source.price, imageUrl: '/images/' + photo, sizes: source.sizes, toppingIds: source.toppings };
  });
  return {
    expectedHash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    items,
    archiveIds: rows.filter(row => row.referenced).map(row => row.id),
    deleteIds: rows.filter(row => !row.referenced).map(row => row.id),
  };
}

async function replaceCatalog(db, { apply = false, expectedHash } = {}) {
  await db.query(apply ? 'BEGIN ISOLATION LEVEL REPEATABLE READ' : 'BEGIN READ ONLY');
  try {
    await db.query("SET LOCAL lock_timeout='3000ms'");
    await db.query("SET LOCAL statement_timeout='15000ms'");
    if (apply) await db.query('LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE');
    const rows = await snapshot(db);
    const plan = planCatalog(rows);
    if (!apply) { await db.query('ROLLBACK'); return plan; }
    // A stale preview or retry must never replace the new menu a second time.
    if (!expectedHash || expectedHash !== plan.expectedHash) throw Error('Catalog changed; run --check and review the current plan first');
    const identity = await db.query("SELECT data_type,column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='products' AND column_name='id'");
    if (identity.rows[0]?.data_type !== 'text' || !identity.rows[0]?.column_default?.includes('products_id_seq')) {
      throw Error('Expected existing TEXT/default product sequence; no schema or identity changes are allowed');
    }
    // Keep sizes/recipes of referenced products intact for old order processing.
    for (const id of plan.archiveIds) await db.query('UPDATE products SET is_active=false,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND is_active=true', [id]);
    for (const id of plan.deleteIds) {
      await db.query('DELETE FROM product_toppings WHERE product_id=$1', [id]);
      await db.query('DELETE FROM product_sizes WHERE product_id=$1', [id]);
      await db.query('DELETE FROM products WHERE id=$1', [id]);
    }
    const items = [];
    for (const item of plan.items) {
      // The supplied seven recipes are resolved by name (has_custom_recipe=false).
      // Stock stays zero: availability comes from current ingredients, not seed stock.
      const result = await db.query('INSERT INTO products(name,price,image_url,stock,is_active,has_custom_recipe) VALUES($1,$2,$3,0,true,false) RETURNING id', [item.name, item.price, item.imageUrl]);
      const id = result.rows[0].id;
      if (rows.some(row => row.id === id)) throw Error('Product sequence reused an old ID');
      for (const size of item.sizes) await db.query('INSERT INTO product_sizes(product_id,size,extra_price,is_active) VALUES($1,$2,$3,true)', [id, size.size, size.extraPrice]);
      for (const toppingId of item.toppingIds) await db.query('INSERT INTO product_toppings(product_id,topping_id) VALUES($1,$2)', [id, toppingId]);
      items.push({ id, ...item });
    }
    await db.query('COMMIT');
    return { ...plan, items, applied: true };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args[0] === '--apply';
  if (!(args.length === 1 && args[0] === '--check') && !(apply && args.length === 2 && /^[a-f0-9]{64}$/.test(args[1]))) {
    throw Error('Usage: node backend/scripts/replace-store-catalog.cjs --check | --apply <expectedHash>');
  }
  require('dotenv').config({ path: resolve(__dirname, '../../.env'), quiet: true });
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) throw Error('Configure DIRECT_URL or DATABASE_URL before inspecting or replacing the catalog');
  const db = new Client({ connectionString, connectionTimeoutMillis: 8000 });
  try {
    await db.connect();
    console.log(JSON.stringify(await replaceCatalog(db, { apply, expectedHash: args[1] }), null, 2));
  } finally { await db.end(); }
}
module.exports = { planCatalog, replaceCatalog };
if (require.main === module) main().catch(error => {
  // PostgreSQL messages can contain connection details or data; print only the code.
  console.error('Catalog replacement failed: ' + (error.code || error.message));
  process.exitCode = 1;
});
