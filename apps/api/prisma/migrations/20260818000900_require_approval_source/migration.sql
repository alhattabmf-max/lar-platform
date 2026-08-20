ALTER TABLE "product_approval_snapshots" ALTER COLUMN "approval_source" SET NOT NULL;

ALTER TABLE "product_approval_snapshots" ADD CONSTRAINT "product_approval_snapshots_source_actor_consistency"
  CHECK (
    ("approval_source" = 'AUTO' AND "approved_by_admin_id" IS NULL)
    OR
    ("approval_source" = 'ADMIN' AND "approved_by_admin_id" IS NOT NULL)
  );
