-- Migration 20260817000300 dropped min_purchase_quantity and
-- max_purchase_quantity from opportunities, but the freeze trigger
-- function (created in 20260816000400, part of the original Phase 6
-- baseline) still referenced both columns in its comparison list.
-- Any UPDATE on an already-first_activated_at row — including the
-- backfill migration that follows this one — would fail with
-- "record NEW has no field min_purchase_quantity" the moment it hit
-- this stale trigger body.
--
-- This was previously worked around by hand directly against dev/test
-- (never captured as a real migration), discovered as a real gap only
-- by testing a from-scratch upgrade path in full isolation. This
-- migration closes it properly: the trigger is redefined here with
-- the two dropped-column references removed, and nothing else
-- changed — the share-tier fields are added to this same trigger by
-- the LATER 20260817000450 migration, in its own proper step.

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
