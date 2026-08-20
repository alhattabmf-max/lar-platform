-- Phase 6 correction — reason_code on opportunities was plain TEXT
-- with no database-level constraint, enforced only in application
-- code (OPPORTUNITY_REASON_CODES). This closes that gap: only the
-- known, closed set of machine-readable reason codes is ever
-- accepted, matching OPPORTUNITY_REASON_CODES in
-- packages/domain/src/opportunity-reason-codes.ts exactly (including
-- SUPPLIER_NOT_VERIFIED, now a first-class member of the set).

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_reason_code_valid" CHECK (
  "reason_code" IS NULL OR "reason_code" IN (
    'SUPPLIER_NOT_VERIFIED',
    'PRODUCT_NOT_APPROVED',
    'PRODUCT_ARCHIVED',
    'LOCATION_INACTIVE',
    'LOCATION_CITY_INACTIVE',
    'SUPPLIER_NOT_FINANCIALLY_READY',
    'TAX_RATE_NOT_CONFIGURED'
  )
);
