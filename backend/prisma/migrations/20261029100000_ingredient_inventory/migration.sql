-- I01: additive only. Existing Product/Order/Payment/Loyalty rows are untouched.
CREATE TYPE "IngredientUnit" AS ENUM ('KG','G','L','ML','PIECE');
CREATE TYPE "IngredientReceiptStatus" AS ENUM ('DRAFT','CONFIRMED');
CREATE TYPE "IngredientCountStatus" AS ENUM ('SUBMITTED','APPROVED','REJECTED','RECOUNT_REQUIRED');
CREATE TABLE ingredients (
 id UUID NOT NULL PRIMARY KEY, name VARCHAR(120) NOT NULL, normalized_name VARCHAR(120) NOT NULL,
 unit "IngredientUnit" NOT NULL, quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
 low_stock_threshold DECIMAL(12,3) NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0,
 created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 request_key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ingredients_bounds CHECK (quantity >= 0 AND low_stock_threshold >= 0 AND version >= 0),
 CONSTRAINT ingredients_piece CHECK (unit <> 'PIECE' OR (quantity = trunc(quantity) AND low_stock_threshold = trunc(low_stock_threshold))),
 CONSTRAINT ingredients_name CHECK (length(trim(name)) > 0 AND length(trim(normalized_name)) > 0)
);
CREATE UNIQUE INDEX ingredients_normalized_name_key ON ingredients(normalized_name);
CREATE UNIQUE INDEX ingredients_created_by_id_request_key_key ON ingredients(created_by_id,request_key);
CREATE TABLE ingredient_receipts (
 id UUID NOT NULL PRIMARY KEY, status "IngredientReceiptStatus" NOT NULL DEFAULT 'DRAFT', note VARCHAR(500) NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
 created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 confirmed_by_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 request_key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, confirmed_at TIMESTAMPTZ(6),
 CONSTRAINT ingredient_receipts_state CHECK ((status='DRAFT' AND version=0 AND confirmed_by_id IS NULL AND confirmed_at IS NULL) OR (status='CONFIRMED' AND version=1 AND confirmed_by_id IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX ingredient_receipts_created_by_id_request_key_key ON ingredient_receipts(created_by_id,request_key);
CREATE INDEX ingredient_receipts_created_at_id_idx ON ingredient_receipts(created_at DESC,id DESC);
CREATE TABLE ingredient_receipt_lines (
 id UUID NOT NULL PRIMARY KEY,
 receipt_id UUID NOT NULL REFERENCES ingredient_receipts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 quantity DECIMAL(12,3) NOT NULL CHECK (quantity > 0)
);
CREATE UNIQUE INDEX ingredient_receipt_lines_receipt_id_ingredient_id_key ON ingredient_receipt_lines(receipt_id,ingredient_id);
CREATE INDEX ingredient_receipt_lines_ingredient_id_idx ON ingredient_receipt_lines(ingredient_id);
CREATE TABLE ingredient_counts (
 id UUID NOT NULL PRIMARY KEY, status "IngredientCountStatus" NOT NULL DEFAULT 'SUBMITTED', note VARCHAR(500) NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
 created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 reviewed_by_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 review_note VARCHAR(500), recount_of_id UUID REFERENCES ingredient_counts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 request_key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TIMESTAMPTZ(6),
 CONSTRAINT ingredient_counts_state CHECK ((status='SUBMITTED' AND version=0 AND reviewed_by_id IS NULL AND reviewed_at IS NULL AND review_note IS NULL) OR (status<>'SUBMITTED' AND version=1 AND reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL)),
 CONSTRAINT ingredient_counts_reason CHECK (status NOT IN ('REJECTED','RECOUNT_REQUIRED') OR length(trim(review_note)) > 0),
 CONSTRAINT ingredient_counts_not_self CHECK (recount_of_id IS NULL OR recount_of_id<>id)
);
CREATE UNIQUE INDEX ingredient_counts_recount_of_id_key ON ingredient_counts(recount_of_id);
CREATE UNIQUE INDEX ingredient_counts_created_by_id_request_key_key ON ingredient_counts(created_by_id,request_key);
CREATE INDEX ingredient_counts_created_at_id_idx ON ingredient_counts(created_at DESC,id DESC);
CREATE INDEX ingredient_counts_created_by_id_created_at_id_idx ON ingredient_counts(created_by_id,created_at DESC,id DESC);
CREATE TABLE ingredient_count_lines (
 id UUID NOT NULL PRIMARY KEY,
 count_id UUID NOT NULL REFERENCES ingredient_counts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 system_quantity DECIMAL(12,3) NOT NULL CHECK(system_quantity>=0), actual_quantity DECIMAL(12,3) NOT NULL CHECK(actual_quantity>=0),
 ingredient_version INTEGER NOT NULL CHECK(ingredient_version>=0), note VARCHAR(500) NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX ingredient_count_lines_count_id_ingredient_id_key ON ingredient_count_lines(count_id,ingredient_id);
CREATE INDEX ingredient_count_lines_ingredient_id_idx ON ingredient_count_lines(ingredient_id);
CREATE TABLE ingredient_movements (
 id UUID NOT NULL PRIMARY KEY,
 ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 receipt_line_id UUID REFERENCES ingredient_receipt_lines(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 count_line_id UUID REFERENCES ingredient_count_lines(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 before_quantity DECIMAL(12,3) NOT NULL, after_quantity DECIMAL(12,3) NOT NULL, delta DECIMAL(13,3) NOT NULL,
 actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT ingredient_movements_source CHECK ((receipt_line_id IS NULL) <> (count_line_id IS NULL)),
 CONSTRAINT ingredient_movements_arithmetic CHECK (before_quantity>=0 AND after_quantity>=0 AND delta=after_quantity-before_quantity)
);
CREATE UNIQUE INDEX ingredient_movements_receipt_line_id_key ON ingredient_movements(receipt_line_id);
CREATE UNIQUE INDEX ingredient_movements_count_line_id_key ON ingredient_movements(count_line_id);
CREATE INDEX ingredient_movements_created_at_id_idx ON ingredient_movements(created_at DESC,id DESC);
CREATE INDEX ingredient_movements_ingredient_id_created_at_id_idx ON ingredient_movements(ingredient_id,created_at DESC,id DESC);
CREATE FUNCTION ingredient_movement_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Ingredient movements are append-only'; END; $$;
CREATE TRIGGER ingredient_movement_immutable BEFORE UPDATE OR DELETE ON ingredient_movements FOR EACH ROW EXECUTE FUNCTION ingredient_movement_immutable();
