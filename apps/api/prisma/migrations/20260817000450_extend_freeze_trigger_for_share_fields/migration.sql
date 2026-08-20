-- Extends the SAME freeze trigger function (CREATE OR REPLACE — this
-- is a new migration, the previously-applied migration file that
-- first created this function is never touched) to also freeze the
-- share-tier and sales-unit snapshot fields, and removes the two
-- references to min_purchase_quantity/max_purchase_quantity dropped
-- in the previous migration.

CREATE OR REPLACE FUNCTION prevent_opportunity_core_field_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."first_activated_at" IS NOT NULL THEN

    IF OLD."extended_at" IS NOT NULL AND NEW."extended_at" IS DISTINCT FROM OLD."extended_at" THEN
      RAISE EXCEPTION 'opportunities: extended_at is immutable once set (id=%)', OLD."id";
    END IF;

    IF NEW."end_at" IS DISTINCT FROM OLD."end_at" OR NEW."extended_at" IS DISTINCT FROM OLD."extended_at" THEN
      IF NOT (
        OLD."status" = 'ACTIVE'
        AND OLD."extended_at" IS NULL
        AND NEW."extended_at" IS NOT NULL
        AND NEW."end_at" = OLD."end_at" + INTERVAL '3 days'
      ) THEN
        RAISE EXCEPTION 'opportunities: end_at changes only via the single atomic extension path (id=%)', OLD."id";
      END IF;
    END IF;

    IF NEW."product_id" IS DISTINCT FROM OLD."product_id"
    OR NEW."company_id" IS DISTINCT FROM OLD."company_id"
    OR NEW."fulfillment_location_id" IS DISTINCT FROM OLD."fulfillment_location_id"
    OR NEW."fulfillment_city_id" IS DISTINCT FROM OLD."fulfillment_city_id"
    OR NEW."fulfillment_city_name_ar" IS DISTINCT FROM OLD."fulfillment_city_name_ar"
    OR NEW."fulfillment_city_name_en" IS DISTINCT FROM OLD."fulfillment_city_name_en"
    OR NEW."fulfillment_region_id" IS DISTINCT FROM OLD."fulfillment_region_id"
    OR NEW."fulfillment_region_name_ar" IS DISTINCT FROM OLD."fulfillment_region_name_ar"
    OR NEW."fulfillment_region_name_en" IS DISTINCT FROM OLD."fulfillment_region_name_en"
    OR NEW."product_approval_snapshot_id" IS DISTINCT FROM OLD."product_approval_snapshot_id"
    OR NEW."unit_price_amount" IS DISTINCT FROM OLD."unit_price_amount"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."tax_rate_percent" IS DISTINCT FROM OLD."tax_rate_percent"
    OR NEW."unit_price_excl_tax_amount" IS DISTINCT FROM OLD."unit_price_excl_tax_amount"
    OR NEW."unit_tax_amount" IS DISTINCT FROM OLD."unit_tax_amount"
    OR NEW."tax_calculation_rule_code" IS DISTINCT FROM OLD."tax_calculation_rule_code"
    OR NEW."tax_calculation_rule_version" IS DISTINCT FROM OLD."tax_calculation_rule_version"
    OR NEW."target_quantity" IS DISTINCT FROM OLD."target_quantity"
    OR NEW."total_value_incl_tax_amount" IS DISTINCT FROM OLD."total_value_incl_tax_amount"
    OR NEW."share_tier_policy_version_id" IS DISTINCT FROM OLD."share_tier_policy_version_id"
    OR NEW."share_tier_index" IS DISTINCT FROM OLD."share_tier_index"
    OR NEW."share_basis_points" IS DISTINCT FROM OLD."share_basis_points"
    OR NEW."share_quantity" IS DISTINCT FROM OLD."share_quantity"
    OR NEW."sales_unit_id" IS DISTINCT FROM OLD."sales_unit_id"
    OR NEW."sales_unit_name_ar" IS DISTINCT FROM OLD."sales_unit_name_ar"
    OR NEW."sales_unit_name_en" IS DISTINCT FROM OLD."sales_unit_name_en"
    OR NEW."expected_preparation_days" IS DISTINCT FROM OLD."expected_preparation_days"
    OR NEW."start_at" IS DISTINCT FROM OLD."start_at"
    OR NEW."description_ar" IS DISTINCT FROM OLD."description_ar"
    OR NEW."description_en" IS DISTINCT FROM OLD."description_en"
    OR NEW."first_activated_at" IS DISTINCT FROM OLD."first_activated_at"
    THEN
      RAISE EXCEPTION 'opportunities: core fields are frozen after first activation (id=%)', OLD."id";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
