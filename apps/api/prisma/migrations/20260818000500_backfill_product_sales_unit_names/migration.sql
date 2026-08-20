DO $$
DECLARE
  orphan_ids TEXT := '';
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT p.id FROM products p
    WHERE p.sales_unit_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sales_units su WHERE su.id = p.sales_unit_id)
  LOOP
    orphan_ids := orphan_ids || rec.id::TEXT || ' ';
  END LOOP;

  IF orphan_ids != '' THEN
    RAISE EXCEPTION 'Backfill aborted: these products reference a non-existent sales_unit_id: %', orphan_ids;
  END IF;

  FOR rec IN SELECT id FROM products WHERE sales_unit_id IS NULL LOOP
    orphan_ids := orphan_ids || rec.id::TEXT || ' ';
  END LOOP;

  IF orphan_ids != '' THEN
    RAISE EXCEPTION 'Backfill aborted: these products have no sales_unit_id to backfill names from: %', orphan_ids;
  END IF;

  UPDATE products p
  SET sales_unit_name_ar = su.name_ar,
      sales_unit_name_en = su.name_en
  FROM sales_units su
  WHERE su.id = p.sales_unit_id;
END $$;
