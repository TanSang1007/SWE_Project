-- Empty means this snapshot reserved Product.stock under the legacy workflow.
-- New recipe-based items store exact normalized ingredient/unit keys instead.
ALTER TABLE order_items ADD COLUMN ingredient_keys_snapshot TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
