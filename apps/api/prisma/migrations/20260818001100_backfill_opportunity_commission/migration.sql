DO $$
DECLARE
  v1_id UUID;
  v1_rate INT;
BEGIN
  SELECT id, rate_basis_points INTO v1_id, v1_rate FROM commission_policy_versions WHERE version = 1;
  IF v1_id IS NULL THEN
    RAISE EXCEPTION 'Backfill aborted: commission_policy_versions Version 1 was not found — the seeding migration must run first';
  END IF;

  UPDATE opportunities
  SET commission_policy_version_id = v1_id,
      commission_rate_basis_points = v1_rate
  WHERE product_approval_snapshot_id IS NOT NULL;
END $$;
