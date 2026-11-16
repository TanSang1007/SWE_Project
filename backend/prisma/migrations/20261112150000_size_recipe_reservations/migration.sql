CREATE TYPE "RecipeIngredientState" AS ENUM ('RESERVED','RELEASED','CONSUMED');
ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS reserved_quantity DECIMAL(12,3) NOT NULL DEFAULT 0;
ALTER TABLE ingredients ADD CONSTRAINT ingredients_recipe_reserved_bounds CHECK(reserved_quantity>=0 AND reserved_quantity<=quantity);
-- FK storage follows the existing development schema (UUID or legacy TEXT).
-- New reservation identities always use UUID; no historical identities change.
DO $$
DECLARE order_type text; ingredient_type text;
BEGIN
 SELECT format_type(atttypid,atttypmod) INTO order_type FROM pg_attribute WHERE attrelid='orders'::regclass AND attname='id';
 SELECT format_type(atttypid,atttypmod) INTO ingredient_type FROM pg_attribute WHERE attrelid='ingredients'::regclass AND attname='id';
 IF order_type NOT IN ('uuid','text') OR ingredient_type NOT IN ('uuid','text') THEN RAISE EXCEPTION 'Unsupported identity storage'; END IF;
 EXECUTE format('CREATE TABLE order_recipe_ingredients (
  id UUID NOT NULL PRIMARY KEY,
  order_id %s NOT NULL REFERENCES orders(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  ingredient_id %s NOT NULL REFERENCES ingredients(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  name_snapshot VARCHAR(120) NOT NULL, unit_snapshot "IngredientUnit" NOT NULL,
  quantity DECIMAL(12,3) NOT NULL CHECK(quantity>0),
  state "RecipeIngredientState" NOT NULL DEFAULT ''RESERVED'',
  cycle INTEGER NOT NULL DEFAULT 1 CHECK(cycle>0),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
 )',order_type,ingredient_type);
END $$;
CREATE UNIQUE INDEX order_recipe_ingredients_order_id_ingredient_id_key ON order_recipe_ingredients(order_id,ingredient_id);
CREATE INDEX order_recipe_ingredients_ingredient_id_state_idx ON order_recipe_ingredients(ingredient_id,state);
ALTER TABLE ingredient_movements ADD COLUMN reservation_id UUID REFERENCES order_recipe_ingredients(id) ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE ingredient_movements ADD COLUMN reservation_action VARCHAR(12);
ALTER TABLE ingredient_movements ADD COLUMN reservation_cycle INTEGER;
-- Preserve the existing source contract, including legacy reservation sources
-- if this shared development database has that earlier extension.
DO $$
DECLARE prior_source text; legacy_empty text := '';
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO prior_source FROM pg_constraint WHERE conrelid='ingredient_movements'::regclass AND conname='ingredient_movements_source';
 IF prior_source IS NULL THEN RAISE EXCEPTION 'Movement source constraint missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='ingredient_movements'::regclass AND attname='reservation_line_id' AND NOT attisdropped) THEN legacy_empty := ' AND reservation_line_id IS NULL'; END IF;
 ALTER TABLE ingredient_movements DROP CONSTRAINT ingredient_movements_source;
 EXECUTE format('ALTER TABLE ingredient_movements ADD CONSTRAINT ingredient_movements_source CHECK (
  (reservation_id IS NULL AND reservation_action IS NULL AND reservation_cycle IS NULL AND (%s)) OR
  (reservation_id IS NOT NULL AND receipt_line_id IS NULL AND count_line_id IS NULL %s AND reservation_action IS NOT NULL AND reservation_action IN (''RESERVE'',''RELEASE'',''CONSUME'') AND reservation_cycle IS NOT NULL AND reservation_cycle>0))',prior_source,legacy_empty);
END $$;
CREATE UNIQUE INDEX ingredient_movements_reservation_id_reservation_action_reserv_key ON ingredient_movements(reservation_id,reservation_action,reservation_cycle);
