-- Recreated group-consistency constraint: sales_unit_name_ar replaces
-- the removed sales_unit_id as the group's sales-unit member, and the
-- two commission fields join the same all-or-nothing group. Added
-- AFTER the commission backfill (already complete by this point), so
-- it validates cleanly against current data.

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_share_snapshot_consistency" CHECK (
  (
    ("share_basis_points" IS NULL) = ("share_quantity" IS NULL)
    AND ("share_basis_points" IS NULL) = ("total_value_incl_tax_amount" IS NULL)
    AND ("share_basis_points" IS NULL) = ("share_tier_policy_version_id" IS NULL)
    AND ("share_basis_points" IS NULL) = ("share_tier_index" IS NULL)
    AND ("share_basis_points" IS NULL) = ("sales_unit_name_ar" IS NULL)
    AND ("share_basis_points" IS NULL) = ("sales_unit_name_en" IS NULL)
    AND ("share_basis_points" IS NULL) = ("commission_policy_version_id" IS NULL)
    AND ("share_basis_points" IS NULL) = ("commission_rate_basis_points" IS NULL)
  )
  AND (
    "status" IN ('DRAFT', 'CANCELLED') OR "share_basis_points" IS NOT NULL
  )
);
