-- Removes supplier-controlled purchase limits — shareQuantity (below)
-- is now the single source of truth for the minimum/increment
-- purchase unit; there is no longer a separately-stored maximum
-- (the future ceiling is simply remaining availability at Checkout
-- time, computed dynamically in Phase 7, never stored here).

ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_min_purchase_positive";
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_min_purchase_within_target";
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_max_purchase_range";
ALTER TABLE "opportunities" DROP COLUMN "min_purchase_quantity";
ALTER TABLE "opportunities" DROP COLUMN "max_purchase_quantity";

ALTER TABLE "opportunities" ADD COLUMN "total_value_incl_tax_amount" DECIMAL(14,2);
ALTER TABLE "opportunities" ADD COLUMN "share_tier_policy_version_id" UUID;
ALTER TABLE "opportunities" ADD COLUMN "share_tier_index" INTEGER;
ALTER TABLE "opportunities" ADD COLUMN "share_basis_points" INTEGER;
ALTER TABLE "opportunities" ADD COLUMN "share_quantity" INTEGER;

ALTER TABLE "opportunities" ADD COLUMN "sales_unit_id" UUID;
ALTER TABLE "opportunities" ADD COLUMN "sales_unit_name_ar" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "sales_unit_name_en" TEXT;

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_share_tier_policy_version_id_fkey"
  FOREIGN KEY ("share_tier_policy_version_id") REFERENCES "share_tier_policy_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sales_unit_id_fkey"
  FOREIGN KEY ("sales_unit_id") REFERENCES "sales_units"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "opportunities_share_tier_policy_version_id_idx" ON "opportunities"("share_tier_policy_version_id");

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_total_value_positive"
  CHECK ("total_value_incl_tax_amount" IS NULL OR "total_value_incl_tax_amount" > 0);
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_share_quantity_positive"
  CHECK ("share_quantity" IS NULL OR "share_quantity" > 0);
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_share_basis_points_range"
  CHECK ("share_basis_points" IS NULL OR ("share_basis_points" > 0 AND "share_basis_points" <= 10000));
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_share_quantity_exact_division"
  CHECK ("share_basis_points" IS NULL OR ("target_quantity" * "share_basis_points") % 10000 = 0);

-- NOTE: the "all-or-nothing, required for non-DRAFT/CANCELLED" group
-- consistency constraint is added in a LATER migration
-- (20260817000600), deliberately AFTER the backfill migration —
-- adding it here would make Postgres validate it against EXISTING
-- published rows immediately, before backfill has had a chance to
-- populate them, and the migration would fail outright on any
-- environment that already has published opportunities (confirmed by
-- testing this exact sequencing failure in an isolated database
-- before finalizing this migration set).
