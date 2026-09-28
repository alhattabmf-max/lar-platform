-- PAYMENT FREEZES THE OFFER — NOT PUBLICATION.
--
-- «احذف العرض أو عدّله دام ما عليه أي عملية… نفّذها الأربعة دام
--  المشتري ما بعد دفع.»
--
-- WHAT FROZE AN OFFER UNTIL NOW was `first_activated_at`: the moment it
-- went on the market, every core field became immutable at the database
-- level — price, quantity, dates, branch, description, all of it. The
-- reasoning was that a buyer may be relying on what they were shown.
--
-- AND IN THE COMMON CASE THERE IS NO BUYER. Most live offers have never
-- been touched by anyone; the supplier who spots his own mistake an
-- hour after publishing had no way to correct it, and neither did the
-- administrator he asked. The rule was protecting nobody and stopping
-- the person it belonged to.
--
-- THE NEW CONDITION IS THE PAYMENT, and `funded_quantity` is the row's
-- own witness to it: the payment webhook raises it inside the same
-- transaction that marks the checkout session PAID and writes the
-- master order, so it is never behind them. Below it the offer is the
-- supplier's to correct; from the first riyal it is a record and every
-- one of these columns is frozen exactly as before.
--
-- NOTHING ELSE IN THE FUNCTION CHANGES. The extension path, the
-- immutability of `extended_at` and the frozen column list are
-- reproduced verbatim from the deployed definition — this migration
-- moves one condition and touches nothing else.
--
-- THE FIRST PAYMENT ITSELF IS NOT BLOCKED: on that write
-- OLD.funded_quantity is still 0, so the guard stands down, and from
-- the second onwards `funded_quantity` and `status` were never in the
-- frozen list to begin with.

CREATE OR REPLACE FUNCTION public.prevent_opportunity_core_field_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD."funded_quantity" > 0 THEN

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
    OR NEW."sales_unit_name_ar" IS DISTINCT FROM OLD."sales_unit_name_ar"
    OR NEW."sales_unit_name_en" IS DISTINCT FROM OLD."sales_unit_name_en"
    OR NEW."package_content_quantity" IS DISTINCT FROM OLD."package_content_quantity"
    OR NEW."package_content_unit_name_ar" IS DISTINCT FROM OLD."package_content_unit_name_ar"
    OR NEW."package_content_unit_name_en" IS DISTINCT FROM OLD."package_content_unit_name_en"
    OR NEW."commission_policy_version_id" IS DISTINCT FROM OLD."commission_policy_version_id"
    OR NEW."commission_rate_basis_points" IS DISTINCT FROM OLD."commission_rate_basis_points"
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
$function$
;
