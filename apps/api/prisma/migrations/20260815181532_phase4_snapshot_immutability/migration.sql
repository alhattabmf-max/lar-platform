-- Enforce product_approval_snapshots immutability at the DATABASE
-- level — every row is a historical record of exactly what an admin
-- approved and when. Unlike policy_versions (Phase 2), where only
-- PUBLISHED rows are protected, every snapshot row here is immutable
-- unconditionally from the moment it is created — there is no
-- legitimate application code path that ever updates or deletes one.
CREATE OR REPLACE FUNCTION prevent_product_approval_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'product_approval_snapshots: rows are append-only and cannot be deleted (id=%)', OLD."id";
  END IF;

  -- TG_OP = 'UPDATE'
  RAISE EXCEPTION 'product_approval_snapshots: rows are append-only and cannot be modified (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_product_approval_snapshot_mutation
  BEFORE UPDATE OR DELETE ON "product_approval_snapshots"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_product_approval_snapshot_mutation();
