-- Only warning metadata changes. Names, units, quantities, versions and audit stay intact.
ALTER TABLE ingredients DROP CONSTRAINT ingredients_unit_threshold_check;
UPDATE ingredients AS i SET low_stock_threshold = p.threshold
FROM (VALUES
  ('bột ca cao','KG',1::numeric), ('bột matcha','KG',0.5::numeric),
  ('bột quế','KG',0.1::numeric), ('cà phê','KG',3::numeric),
  ('sữa tươi','L',10::numeric), ('sữa đặc','L',3::numeric),
  ('đường','KG',5::numeric), ('sốt caramel','BOTTLE',1::numeric),
  ('đá','BAG',1::numeric)
) AS p(name,unit,threshold)
WHERE i.normalized_name=p.name AND i.unit::text=p.unit;
ALTER TABLE ingredients ADD CONSTRAINT ingredients_unit_threshold_check CHECK (
  low_stock_threshold = CASE
    WHEN normalized_name='bột ca cao' AND unit::text='KG' THEN 1
    WHEN normalized_name='bột matcha' AND unit::text='KG' THEN 0.5
    WHEN normalized_name='bột quế' AND unit::text='KG' THEN 0.1
    WHEN normalized_name='cà phê' AND unit::text='KG' THEN 3
    WHEN normalized_name='sữa tươi' AND unit::text='L' THEN 10
    WHEN normalized_name='sữa đặc' AND unit::text='L' THEN 3
    WHEN normalized_name='đường' AND unit::text='KG' THEN 5
    WHEN normalized_name='sốt caramel' AND unit::text='BOTTLE' THEN 1
    WHEN normalized_name='đá' AND unit::text='BAG' THEN 1
    ELSE CASE unit::text
      WHEN 'PIECE' THEN 10 WHEN 'L' THEN 5 WHEN 'KG' THEN 10
      WHEN 'G' THEN 10000 WHEN 'ML' THEN 5000 WHEN 'EGG' THEN 10
      WHEN 'BOTTLE' THEN 10 WHEN 'BAG' THEN 5 END
  END
);
