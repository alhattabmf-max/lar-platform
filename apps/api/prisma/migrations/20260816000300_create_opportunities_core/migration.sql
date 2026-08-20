-- Phase 6 — Opportunities Core: the table, with every business
-- invariant enforced at the database level (defense in depth,
-- matching the project's established pattern from Phase 1 onward).

CREATE TYPE "OpportunityStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTION_REQUIRED', 'ACTIVE', 'PAUSED', 'FUNDED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "OpportunityCurrency" AS ENUM ('SAR');

CREATE TABLE "opportunities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "fulfillment_location_id" UUID NOT NULL,

    "fulfillment_city_id" UUID,
    "fulfillment_city_name_ar" TEXT,
    "fulfillment_city_name_en" TEXT,
    "fulfillment_region_id" UUID,
    "fulfillment_region_name_ar" TEXT,
    "fulfillment_region_name_en" TEXT,

    "product_approval_snapshot_id" UUID,

    "target_quantity" INTEGER NOT NULL,
    "funded_quantity" INTEGER NOT NULL DEFAULT 0,
    "unit_price_amount" DECIMAL(12,2) NOT NULL,
    "currency" "OpportunityCurrency" NOT NULL DEFAULT 'SAR',
    "min_purchase_quantity" INTEGER NOT NULL,
    "max_purchase_quantity" INTEGER,

    "tax_rate_percent" DECIMAL(5,2),
    "unit_price_excl_tax_amount" DECIMAL(12,2),
    "unit_tax_amount" DECIMAL(12,2),
    "tax_calculation_rule_code" TEXT,
    "tax_calculation_rule_version" TEXT,

    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "expected_preparation_days" INTEGER NOT NULL,

    "description_ar" TEXT,
    "description_en" TEXT,

    "status" "OpportunityStatus" NOT NULL DEFAULT 'DRAFT',
    "first_activated_at" TIMESTAMPTZ(3),
    "extended_at" TIMESTAMPTZ(3),
    "paused_at" TIMESTAMPTZ(3),
    "pause_reason" TEXT,
    "cancel_reason" TEXT,

    "reason_code" TEXT,
    "reason_details" TEXT,
    "blocked_at" TIMESTAMPTZ(3),

    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id"),

    -- Quantities and price
    CONSTRAINT "opportunities_unit_price_positive" CHECK ("unit_price_amount" > 0),
    CONSTRAINT "opportunities_funded_quantity_non_negative" CHECK ("funded_quantity" >= 0),
    CONSTRAINT "opportunities_target_quantity_positive" CHECK ("target_quantity" > 0),
    CONSTRAINT "opportunities_funded_within_target" CHECK ("funded_quantity" <= "target_quantity"),
    CONSTRAINT "opportunities_min_purchase_positive" CHECK ("min_purchase_quantity" > 0),
    CONSTRAINT "opportunities_min_purchase_within_target" CHECK ("min_purchase_quantity" <= "target_quantity"),
    CONSTRAINT "opportunities_max_purchase_range" CHECK (
      "max_purchase_quantity" IS NULL
      OR ("max_purchase_quantity" >= "min_purchase_quantity" AND "max_purchase_quantity" <= "target_quantity")
    ),
    CONSTRAINT "opportunities_preparation_days_positive" CHECK ("expected_preparation_days" > 0),
    CONSTRAINT "opportunities_end_after_start" CHECK ("end_at" > "start_at"),

    -- Tax snapshot: internally consistent amounts
    CONSTRAINT "opportunities_tax_rate_range" CHECK ("tax_rate_percent" IS NULL OR ("tax_rate_percent" >= 0 AND "tax_rate_percent" <= 100)),
    CONSTRAINT "opportunities_tax_excl_non_negative" CHECK ("unit_price_excl_tax_amount" IS NULL OR "unit_price_excl_tax_amount" >= 0),
    CONSTRAINT "opportunities_tax_amount_non_negative" CHECK ("unit_tax_amount" IS NULL OR "unit_tax_amount" >= 0),
    CONSTRAINT "opportunities_tax_amounts_sum_to_price" CHECK (
      "unit_price_excl_tax_amount" IS NULL
      OR "unit_price_excl_tax_amount" + "unit_tax_amount" = "unit_price_amount"
    ),

    -- Tax snapshot: all-or-nothing together, and required outside DRAFT/CANCELLED
    CONSTRAINT "opportunities_tax_snapshot_consistency" CHECK (
      (
        ("tax_rate_percent" IS NULL) = ("unit_price_excl_tax_amount" IS NULL)
        AND ("tax_rate_percent" IS NULL) = ("unit_tax_amount" IS NULL)
        AND ("tax_rate_percent" IS NULL) = ("tax_calculation_rule_code" IS NULL)
        AND ("tax_rate_percent" IS NULL) = ("tax_calculation_rule_version" IS NULL)
      )
      AND (
        "status" IN ('DRAFT', 'CANCELLED') OR "tax_rate_percent" IS NOT NULL
      )
    ),

    -- Location/region/product snapshot: all-or-nothing together, and
    -- required outside DRAFT/CANCELLED. NULL is explicitly allowed
    -- for a CANCELLED row that started as DRAFT and was cancelled
    -- before ever being published (no fabricated snapshot); a
    -- CANCELLED row that WAS previously published keeps whatever
    -- snapshot it already had (this constraint doesn't force it to
    -- null — it only requires all-or-nothing consistency).
    CONSTRAINT "opportunities_location_snapshot_consistency" CHECK (
      (
        ("fulfillment_city_id" IS NULL) = ("fulfillment_city_name_ar" IS NULL)
        AND ("fulfillment_city_id" IS NULL) = ("fulfillment_city_name_en" IS NULL)
        AND ("fulfillment_city_id" IS NULL) = ("fulfillment_region_id" IS NULL)
        AND ("fulfillment_city_id" IS NULL) = ("fulfillment_region_name_ar" IS NULL)
        AND ("fulfillment_city_id" IS NULL) = ("fulfillment_region_name_en" IS NULL)
        AND ("fulfillment_city_id" IS NULL) = ("product_approval_snapshot_id" IS NULL)
      )
      AND (
        "status" IN ('DRAFT', 'CANCELLED') OR "fulfillment_city_id" IS NOT NULL
      )
    )
);

CREATE INDEX "opportunities_company_id_idx" ON "opportunities"("company_id");
CREATE INDEX "opportunities_product_id_idx" ON "opportunities"("product_id");
CREATE INDEX "opportunities_status_start_at_idx" ON "opportunities"("status", "start_at");
CREATE INDEX "opportunities_status_end_at_idx" ON "opportunities"("status", "end_at");
CREATE INDEX "opportunities_fulfillment_city_id_idx" ON "opportunities"("fulfillment_city_id");

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_fulfillment_location_id_fkey"
  FOREIGN KEY ("fulfillment_location_id") REFERENCES "company_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_fulfillment_city_id_fkey"
  FOREIGN KEY ("fulfillment_city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_product_approval_snapshot_id_fkey"
  FOREIGN KEY ("product_approval_snapshot_id") REFERENCES "product_approval_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
