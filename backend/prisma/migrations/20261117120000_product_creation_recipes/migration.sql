-- Additive I07 configuration only: preserve all existing recipes, balances and order snapshots.
ALTER TABLE products ADD COLUMN has_custom_recipe BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE product_sizes ADD COLUMN water_ml INTEGER NOT NULL DEFAULT 0
  CHECK (water_ml >= 0 AND water_ml <= 999999999);
-- Support both the original UUID database and the restored TEXT identity database.
DO $$
DECLARE product_type text; ingredient_type text;
BEGIN
 SELECT format_type(atttypid,atttypmod) INTO product_type FROM pg_attribute WHERE attrelid='products'::regclass AND attname='id';
 SELECT format_type(atttypid,atttypmod) INTO ingredient_type FROM pg_attribute WHERE attrelid='ingredients'::regclass AND attname='id';
 IF product_type NOT IN ('uuid','text') OR ingredient_type NOT IN ('uuid','text') THEN RAISE EXCEPTION 'Unsupported identity storage'; END IF;
 -- The restored database may retain older product_recipes/product_recipe_ingredients tables.
 -- Keep those identities and rows intact; new configuration has a distinct table.
 EXECUTE format('CREATE TABLE product_size_recipe_ingredients (
  product_id %s NOT NULL REFERENCES products(id) ON UPDATE CASCADE ON DELETE CASCADE,
  size TEXT NOT NULL CHECK(size IN (''S'',''M'',''L'')),
  ingredient_id %s NOT NULL REFERENCES ingredients(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  quantity DECIMAL(12,3) NOT NULL CHECK(quantity > 0),
  PRIMARY KEY(product_id,size,ingredient_id),
  FOREIGN KEY(product_id,size) REFERENCES product_sizes(product_id,size) ON UPDATE CASCADE ON DELETE CASCADE
 )',product_type,ingredient_type);
END $$;
CREATE INDEX product_size_recipe_ingredients_ingredient_id_idx ON product_size_recipe_ingredients(ingredient_id);
