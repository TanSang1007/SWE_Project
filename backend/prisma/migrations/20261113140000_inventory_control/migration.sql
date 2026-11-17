-- I08: additive snapshots and configurable controls; preserve existing balances.
ALTER TYPE "IngredientCountStatus" ADD VALUE IF NOT EXISTS 'DRAFT';

ALTER TABLE ingredients
 ADD COLUMN variance_percent_threshold NUMERIC(7,3),
 ADD COLUMN variance_absolute_threshold NUMERIC(12,3),
 ADD CONSTRAINT ingredients_variance_thresholds CHECK (
   (variance_percent_threshold IS NULL OR variance_percent_threshold BETWEEN 0 AND 1000) AND
   (variance_absolute_threshold IS NULL OR variance_absolute_threshold BETWEEN 0 AND 999999999.999));

ALTER TABLE ingredient_movements ADD COLUMN sequence BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX ingredient_movements_sequence_key ON ingredient_movements(sequence);
CREATE INDEX ingredient_movements_ingredient_sequence_idx ON ingredient_movements(ingredient_id,sequence);

ALTER TABLE ingredient_counts
 ADD COLUMN submitted_at TIMESTAMPTZ(6),
 ADD COLUMN period_start TIMESTAMPTZ(6),
 ADD COLUMN recount_requested BOOLEAN NOT NULL DEFAULT false,
 DROP CONSTRAINT ingredient_counts_state;
-- Compare enum text so this migration also works atomically before the new
-- enum value can be used by another transaction.
ALTER TABLE ingredient_counts ADD CONSTRAINT ingredient_counts_state CHECK (
 (status::text IN ('DRAFT','SUBMITTED') AND version>=0 AND reviewed_by_id IS NULL AND reviewed_at IS NULL AND review_note IS NULL) OR
 (status::text NOT IN ('DRAFT','SUBMITTED') AND version>=1 AND reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL));
ALTER TABLE ingredient_counts ADD CONSTRAINT ingredient_counts_period CHECK (period_start IS NULL OR period_start<=created_at);
ALTER TABLE ingredient_counts ADD CONSTRAINT ingredient_counts_recount CHECK (NOT recount_requested OR status::text='REJECTED');

ALTER TABLE ingredient_count_lines
 ADD COLUMN movement_sequence BIGINT,
 ADD COLUMN theoretical_consumption NUMERIC(20,3),
 ADD COLUMN variance_percent_threshold NUMERIC(7,3),
 ADD COLUMN variance_absolute_threshold NUMERIC(12,3),
 ADD CONSTRAINT ingredient_count_lines_control CHECK (
   (movement_sequence IS NULL OR movement_sequence>=0) AND
   (theoretical_consumption IS NULL OR theoretical_consumption>=0) AND
   (variance_percent_threshold IS NULL OR variance_percent_threshold BETWEEN 0 AND 1000) AND
   (variance_absolute_threshold IS NULL OR variance_absolute_threshold BETWEEN 0 AND 999999999.999));
