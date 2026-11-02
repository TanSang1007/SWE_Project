ALTER TYPE "IngredientUnit" ADD VALUE 'EGG';

-- Cast to text so the new enum label is not consumed before this transaction commits.
ALTER TABLE ingredients DROP CONSTRAINT ingredients_unit_threshold_check;
ALTER TABLE ingredients ADD CONSTRAINT ingredients_unit_threshold_check CHECK (
  low_stock_threshold = CASE unit::text
    WHEN 'PIECE' THEN 10 WHEN 'L' THEN 5 WHEN 'KG' THEN 10
    WHEN 'G' THEN 10000 WHEN 'ML' THEN 5000 WHEN 'EGG' THEN 10 END
);
ALTER TABLE ingredients ADD CONSTRAINT ingredients_countable_units CHECK (
  unit::text NOT IN ('PIECE','EGG') OR
  (quantity=trunc(quantity) AND low_stock_threshold=trunc(low_stock_threshold))
);
