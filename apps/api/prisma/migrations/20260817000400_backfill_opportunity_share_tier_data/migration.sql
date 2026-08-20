-- Backfills share-tier fields for every ALREADY-PUBLISHED opportunity
-- (product_approval_snapshot_id IS NOT NULL is exactly the set of
-- rows that ever left DRAFT — DRAFT and CANCELLED-from-DRAFT rows
-- always have it NULL by the existing location/product snapshot
-- consistency constraint, so this filter is precise, not a guess).
--
-- sales_unit_id is read from the FROZEN
-- product_approval_snapshots.snapshot->>'salesUnitId' — never from a
-- live Product join. The two-pass design below (pre-flight check,
-- then apply) means the migration ABORTS with a clear list of
-- offending ids rather than silently rounding or guessing a value
-- for any pre-existing commercial commitment it cannot safely backfill.

DO $$
DECLARE
  v1_id UUID;
  v1_tiers JSONB;
  rec RECORD;
  tier JSONB;
  i INT;
  n INT;
  total_value NUMERIC;
  sel_bps INT;
  sel_index INT;
  sel_share_qty NUMERIC;
  su_id UUID;
  su_name_ar TEXT;
  su_name_en TEXT;
  divisibility_failures TEXT := '';
  sales_unit_failures TEXT := '';
BEGIN
  SELECT id, tiers INTO v1_id, v1_tiers FROM share_tier_policy_versions WHERE version = 1;
  IF v1_id IS NULL THEN
    RAISE EXCEPTION 'Backfill aborted: share_tier_policy_versions Version 1 was not found — the seeding migration must run first';
  END IF;
  n := jsonb_array_length(v1_tiers);

  FOR rec IN
    SELECT o.id, o.target_quantity, o.unit_price_amount,
           pas.snapshot->>'salesUnitId' AS sales_unit_id_text
    FROM opportunities o
    JOIN product_approval_snapshots pas ON pas.id = o.product_approval_snapshot_id
    WHERE o.product_approval_snapshot_id IS NOT NULL
  LOOP
    total_value := rec.target_quantity * rec.unit_price_amount;
    sel_bps := NULL;
    FOR i IN 0..n-1 LOOP
      tier := v1_tiers->i;
      IF (tier->>'maxTotalValueInclTax') IS NULL
         OR total_value <= (tier->>'maxTotalValueInclTax')::NUMERIC THEN
        sel_bps := (tier->>'shareBasisPoints')::INT;
        EXIT;
      END IF;
    END LOOP;

    IF sel_bps IS NULL OR (rec.target_quantity * sel_bps) % 10000 != 0 THEN
      divisibility_failures := divisibility_failures || rec.id::TEXT || ' ';
    END IF;

    IF rec.sales_unit_id_text IS NULL THEN
      sales_unit_failures := sales_unit_failures || rec.id::TEXT || ' (no salesUnitId in frozen snapshot) ';
    ELSIF NOT EXISTS (SELECT 1 FROM sales_units WHERE id = rec.sales_unit_id_text::UUID) THEN
      sales_unit_failures := sales_unit_failures || rec.id::TEXT || ' (sales unit no longer exists) ';
    END IF;
  END LOOP;

  IF divisibility_failures != '' THEN
    RAISE EXCEPTION 'Backfill aborted: these opportunities cannot be evenly split into shares under Version 1: %', divisibility_failures;
  END IF;
  IF sales_unit_failures != '' THEN
    RAISE EXCEPTION 'Backfill aborted: these opportunities have an unresolvable sales unit: %', sales_unit_failures;
  END IF;

  FOR rec IN
    SELECT o.id, o.target_quantity, o.unit_price_amount,
           pas.snapshot->>'salesUnitId' AS sales_unit_id_text
    FROM opportunities o
    JOIN product_approval_snapshots pas ON pas.id = o.product_approval_snapshot_id
    WHERE o.product_approval_snapshot_id IS NOT NULL
  LOOP
    total_value := rec.target_quantity * rec.unit_price_amount;
    sel_bps := NULL;
    sel_index := NULL;
    FOR i IN 0..n-1 LOOP
      tier := v1_tiers->i;
      IF (tier->>'maxTotalValueInclTax') IS NULL
         OR total_value <= (tier->>'maxTotalValueInclTax')::NUMERIC THEN
        sel_bps := (tier->>'shareBasisPoints')::INT;
        sel_index := i;
        EXIT;
      END IF;
    END LOOP;

    sel_share_qty := (rec.target_quantity * sel_bps) / 10000;
    su_id := rec.sales_unit_id_text::UUID;
    SELECT name_ar, name_en INTO su_name_ar, su_name_en FROM sales_units WHERE id = su_id;

    UPDATE opportunities SET
      total_value_incl_tax_amount = total_value,
      share_tier_policy_version_id = v1_id,
      share_tier_index = sel_index,
      share_basis_points = sel_bps,
      share_quantity = sel_share_qty,
      sales_unit_id = su_id,
      sales_unit_name_ar = su_name_ar,
      sales_unit_name_en = su_name_en
    WHERE id = rec.id;
  END LOOP;
END $$;
