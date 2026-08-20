ALTER TABLE product_approval_snapshots DISABLE TRIGGER trg_prevent_product_approval_snapshot_mutation;

DO $$
DECLARE
  unexpected_count INT;
BEGIN
  UPDATE product_approval_snapshots SET approval_source = 'ADMIN' WHERE approved_by_admin_id IS NOT NULL;
  UPDATE product_approval_snapshots SET approval_source = 'AUTO' WHERE approved_by_admin_id IS NULL;

  SELECT count(*) INTO unexpected_count FROM product_approval_snapshots WHERE approval_source IS NULL;
  IF unexpected_count > 0 THEN
    RAISE EXCEPTION 'Backfill aborted: % product_approval_snapshots rows still have a NULL approval_source after backfill', unexpected_count;
  END IF;
END $$;

ALTER TABLE product_approval_snapshots ENABLE TRIGGER trg_prevent_product_approval_snapshot_mutation;
