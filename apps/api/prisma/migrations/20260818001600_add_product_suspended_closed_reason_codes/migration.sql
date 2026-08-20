-- Extends the closed reason_code set (see
-- 20260816010000_add_opportunity_reason_code_check,
-- 20260817000100_add_purchase_quantity_reason_code) with
-- PRODUCT_SUSPENDED and PRODUCT_CLOSED — needed by
-- AdminProductsService's cascade when a product is suspended/closed
-- and a SCHEDULED opportunity built on it transitions to
-- ACTION_REQUIRED. Never touches a previously-applied migration file
-- — drops and recreates the same-named constraint with an expanded
-- value list, matching the exact established pattern.

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
    'PURCHASE_QUANTITY_NOT_COMPATIBLE',
    'PRODUCT_SUSPENDED',
    'PRODUCT_CLOSED'
  )
);
