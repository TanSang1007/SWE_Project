-- I02: metadata only; do not alter physical quantities, versions or audit rows.
UPDATE ingredients SET low_stock_threshold = CASE unit
  WHEN 'PIECE' THEN 10 WHEN 'L' THEN 5 WHEN 'KG' THEN 10
  WHEN 'G' THEN 10000 WHEN 'ML' THEN 5000 END;

ALTER TABLE ingredients ADD CONSTRAINT ingredients_unit_threshold_check CHECK (
  low_stock_threshold = CASE unit
    WHEN 'PIECE' THEN 10 WHEN 'L' THEN 5 WHEN 'KG' THEN 10
    WHEN 'G' THEN 10000 WHEN 'ML' THEN 5000 END
);
