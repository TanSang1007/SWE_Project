-- User amendment: KG warns strictly below 3; L strictly below 2.
-- Only warning metadata changes; stock, reservations, versions and audit stay intact.
ALTER TABLE ingredients DROP CONSTRAINT ingredients_unit_threshold_check;

UPDATE ingredients SET low_stock_threshold = CASE unit::text
  WHEN 'KG' THEN 3 WHEN 'L' THEN 2 END
WHERE unit::text IN ('KG','L');

ALTER TABLE ingredients ADD CONSTRAINT ingredients_unit_threshold_check CHECK (
  low_stock_threshold = CASE
    WHEN unit::text='KG' THEN 3
    WHEN unit::text='L' THEN 2
    WHEN normalized_name='sốt caramel' AND unit::text='BOTTLE' THEN 1
    WHEN normalized_name='đá' AND unit::text='BAG' THEN 1
    ELSE CASE unit::text
      WHEN 'PIECE' THEN 10 WHEN 'G' THEN 10000 WHEN 'ML' THEN 5000
      WHEN 'EGG' THEN 10 WHEN 'BOTTLE' THEN 10 WHEN 'BAG' THEN 5 END
  END
);
