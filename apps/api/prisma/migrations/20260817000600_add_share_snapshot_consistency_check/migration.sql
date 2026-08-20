-- Added AFTER the backfill migration (20260817000500) deliberately —
-- by this point every existing published opportunity has had its
-- share fields populated, so this constraint validates cleanly
-- against current data instead of rejecting the migration outright.
--
-- All-or-nothing group consistency, NULL allowed only for DRAFT or a
-- CANCELLED-from-DRAFT row — identical pattern to the location and
-- tax snapshot consistency constraints already in place.

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_share_snapshot_consistency" CHECK (
  (
    ("share_basis_points" IS NULL) = ("share_quantity" IS NULL)
    AND ("share_basis_points" IS NULL) = ("total_value_incl_tax_amount" IS NULL)
    AND ("share_basis_points" IS NULL) = ("share_tier_policy_version_id" IS NULL)
    AND ("share_basis_points" IS NULL) = ("share_tier_index" IS NULL)
    AND ("share_basis_points" IS NULL) = ("sales_unit_id" IS NULL)
    AND ("share_basis_points" IS NULL) = ("sales_unit_name_ar" IS NULL)
    AND ("share_basis_points" IS NULL) = ("sales_unit_name_en" IS NULL)
  )
  AND (
    "status" IN ('DRAFT', 'CANCELLED') OR "share_basis_points" IS NOT NULL
  )
);
