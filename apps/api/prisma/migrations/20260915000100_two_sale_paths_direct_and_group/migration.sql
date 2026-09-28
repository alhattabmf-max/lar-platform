-- TWO WAYS TO SELL, ONE RECORD.
--
-- «إضافة SaleMode: GROUP و DIRECT. الصفوف الحالية كلها GROUP.»
--
-- GROUP is the platform as it has always worked: a collective offer
-- with a target quantity, a share every buyer takes, a window it runs
-- for, and fulfilment that waits — every allocation is born
-- AWAITING_FUNDING and starts its clock only when the offer reaches
-- its target and turns FUNDED.
--
-- DIRECT is a fixed-price sale from stock. The supplier names a price
-- and a quantity; a buyer takes whatever amount they want out of what
-- is left; the order goes straight to AWAITING_PREPARATION the moment
-- the payment succeeds. No target, no share, no window, no FUNDED.
--
-- NO SECOND INVENTORY. `target_quantity - funded_quantity - active
-- locks`, computed under `SELECT ... FOR UPDATE` on the offer row, has
-- been the availability arithmetic since Phase 7B and is exactly what
-- stock control needs. DIRECT reuses it: `target_quantity` is the
-- shelf, `funded_quantity` is what left it, and the existing checkout
-- locks are what stop two buyers taking the same last unit.

-- == 1 == the discriminator ==========================================
CREATE TYPE "SaleMode" AS ENUM ('GROUP', 'DIRECT');

-- EVERY EXISTING ROW IS GROUP, stated by the default rather than by a
-- backfill: the column is NOT NULL with a default, so every row already
-- in the table takes it, and nothing has to guess what a historical
-- offer was.
ALTER TABLE "opportunities"
  ADD COLUMN "sale_mode" "SaleMode" NOT NULL DEFAULT 'GROUP';

CREATE INDEX "opportunities_sale_mode_status_idx" ON "opportunities" ("sale_mode", "status");

-- == 2 == a DIRECT listing has no window =============================
--
-- `end_at` was NOT NULL because every offer had a deadline. A sentinel
-- far-future date for DIRECT would have satisfied the column and lied
-- to the lifecycle sweep, the ENDING_SOON sort and the countdown on
-- the buyer's card, all of which read it. NULL is the truth, and the
-- CHECK below is what keeps it from becoming a hole in the GROUP path.
ALTER TABLE "opportunities" ALTER COLUMN "end_at" DROP NOT NULL;

ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_end_after_start";
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_end_after_start"
  CHECK ("end_at" IS NULL OR "end_at" > "start_at");

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sale_mode_window" CHECK (
  ("sale_mode" = 'GROUP' AND "end_at" IS NOT NULL)
  OR (
    "sale_mode" = 'DIRECT'
    AND "end_at" IS NULL
    -- The extension and the supplier's 24-hour decision are the two
    -- halves of a window closing. A listing with no window has
    -- neither, ever.
    AND "extended_at" IS NULL
    AND "decision_window_closes_at" IS NULL
  )
);

-- == 3 == DIRECT never reaches FUNDED ================================
--
-- «إذا أصبح المتاح صفرًا تبقى النشرة ACTIVE وتظهر نفد المخزون، وعند
--  إضافة مخزون تعود قابلة للشراء.»
--
-- FUNDED is terminal in `OPPORTUNITY_TRANSITIONS` — nothing leaves it —
-- and it means "the collective target was reached". A DIRECT listing
-- that sold its last unit has not finished; it is empty, and the
-- supplier refills it. Its sold-out state is ACTIVE with nothing
-- available, which is a reading of the numbers and not a status.
--
-- EXPIRED is refused for the same kind of reason: nothing can expire
-- that has no window. SCHEDULED too — a DIRECT listing is published
-- straight onto the market.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sale_mode_status" CHECK (
  "sale_mode" = 'GROUP'
  OR "status" IN ('DRAFT', 'ACTION_REQUIRED', 'ACTIVE', 'PAUSED', 'CANCELLED')
);

-- == 4 == the share fields belong to GROUP alone =====================
--
-- The deployed constraint tied NINE columns together and required all
-- of them from SCHEDULED onward: the five share columns, the two sales
-- unit names, and the two commission columns. Five of those are the
-- collective offer's own arithmetic — the tier, its basis points, the
-- share quantity, the pinned policy and the total value the tier was
-- chosen by — and a DIRECT listing has none of them.
--
-- THE OTHER FOUR STAY REQUIRED FOR BOTH. The sales unit names are what
-- a line on an invoice is counted in, and the commission version and
-- rate are what the platform is paid; a DIRECT sale produces exactly
-- the same order, ledger entries and invoices as a GROUP one, so both
-- are as necessary here as they ever were.
ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_share_snapshot_consistency";

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_share_snapshot_consistency" CHECK (
  -- The five share columns move together, whatever the mode.
  (("share_basis_points" IS NULL) = ("share_quantity" IS NULL))
  AND (("share_basis_points" IS NULL) = ("total_value_incl_tax_amount" IS NULL))
  AND (("share_basis_points" IS NULL) = ("share_tier_policy_version_id" IS NULL))
  AND (("share_basis_points" IS NULL) = ("share_tier_index" IS NULL))
  -- A DIRECT listing never has any of them.
  AND ("sale_mode" = 'GROUP' OR "share_basis_points" IS NULL)
  -- A published GROUP offer always has them.
  AND (
    "sale_mode" = 'DIRECT'
    OR "status" IN ('DRAFT', 'CANCELLED')
    OR "share_basis_points" IS NOT NULL
  )
);

-- WHAT BOTH MODES OWE ONCE PUBLISHED, split out of the constraint above
-- so the requirement is stated once for both rather than hidden inside
-- the share arithmetic.
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_commercial_snapshot_consistency" CHECK (
  (("sales_unit_name_ar" IS NULL) = ("sales_unit_name_en" IS NULL))
  AND (("commission_policy_version_id" IS NULL) = ("commission_rate_basis_points" IS NULL))
  AND (
    "status" IN ('DRAFT', 'CANCELLED')
    OR (
      "sales_unit_name_ar" IS NOT NULL
      AND "commission_policy_version_id" IS NOT NULL
    )
  )
);

-- == 5 == stock moves; price does not ================================
--
-- `prevent_opportunity_core_field_change` freezes every core column
-- from the first riyal taken, `target_quantity` among them. For a
-- collective offer that is exactly right: the target is what the share
-- was computed from and what the buyers were shown.
--
-- FOR A SHELF IT IS WRONG. «المورد يستطيع تعديل المخزون صعودًا أو
-- هبوطًا» — restocking is the normal life of a DIRECT listing, and
-- freezing the quantity at the first sale would mean a listing could be
-- sold exactly once and then had to be replaced.
--
-- THE FLOOR IS THE DATABASE'S TO HOLD. The service lowers stock under
-- `SELECT ... FOR UPDATE` and refuses anything below
-- `funded_quantity + active locks`, because only a transaction holding
-- that lock can count live baskets. This trigger cannot see locks, but
-- it can see what was SOLD, and that half of the floor is absolute: no
-- path, no migration and no hand-written UPDATE may take the shelf
-- below what has already left it.
--
-- THE PRICE STAYS FROZEN FOR BOTH MODES. «إذا حصلت مبيعات على DIRECT
-- لا تعدل السعر على النشرة الحالية» — the supplier stops the listing
-- and publishes a new one. That needs no new rule: `unit_price_amount`
-- and its tax breakdown are already in the frozen list below.
--
-- EVERY OTHER COLUMN AND EVERY OTHER BRANCH IS REPRODUCED VERBATIM from
-- the deployed definition. This migration adds one exception, adds
-- `sale_mode` itself to the frozen list, and changes nothing else.
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

    -- THE ONE EXCEPTION: a DIRECT shelf may be raised or lowered, never
    -- below what has already been sold off it.
    IF NEW."target_quantity" IS DISTINCT FROM OLD."target_quantity" THEN
      IF OLD."sale_mode" <> 'DIRECT' OR NEW."sale_mode" <> 'DIRECT' THEN
        RAISE EXCEPTION 'opportunities: target_quantity is frozen once the offer has been bought (id=%)', OLD."id";
      END IF;
      IF NEW."target_quantity" < OLD."funded_quantity" THEN
        RAISE EXCEPTION 'opportunities: stock (%) cannot go below what is already sold (%) (id=%)',
          NEW."target_quantity", OLD."funded_quantity", OLD."id";
      END IF;
    END IF;

    IF NEW."product_id" IS DISTINCT FROM OLD."product_id"
    OR NEW."company_id" IS DISTINCT FROM OLD."company_id"
    OR NEW."sale_mode" IS DISTINCT FROM OLD."sale_mode"
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
