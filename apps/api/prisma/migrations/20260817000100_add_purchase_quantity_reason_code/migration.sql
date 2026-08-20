-- Extends the closed reason_code set (see
-- 20260816010000_add_opportunity_reason_code_check) with the new
-- PURCHASE_QUANTITY_NOT_COMPATIBLE code, needed when the share-tier
-- policy makes an opportunity's target_quantity impossible to split
-- into whole share units. Never touches the previously-applied
-- migration file — this drops and recreates the same-named
-- constraint with an expanded value list.

ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_reason_code_valid";

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_reason_code_valid" CHECK (
  "reason_code" IS NULL OR "reason_code" IN (
    'SUPPLIER_NOT_VERIFIED',
    'PRODUCT_NOT_APPROVED',
    'PRODUCT_ARCHIVED',
    'LOCATION_INACTIVE',
    'LOCATION_CITY_INACTIVE',
    'SUPPLIER_NOT_FINANCIALLY_READY',
    'TAX_RATE_NOT_CONFIGURED',
    'PURCHASE_QUANTITY_NOT_COMPATIBLE'
  )
);
