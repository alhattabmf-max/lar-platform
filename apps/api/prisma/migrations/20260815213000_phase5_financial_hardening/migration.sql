-- Phase 5 follow-up hardening.
-- Kept separate because 20260815190000_phase5_financial_readiness was already
-- applied to development and test databases before these concurrency and
-- consistency constraints were added.

-- At most one bank-account review may be pending for a company, including
-- when two submissions race after both observed no pending row.
CREATE UNIQUE INDEX "supplier_bank_accounts_one_pending_per_company"
  ON "supplier_bank_accounts" ("company_id")
  WHERE "verification_status" = 'PENDING_VERIFICATION';

ALTER TABLE "supplier_bank_accounts"
  ADD CONSTRAINT "supplier_bank_accounts_iban_last4_check"
  CHECK ("iban_last4" ~ '^[0-9]{4}$');

ALTER TABLE "supplier_tax_profiles"
  ADD CONSTRAINT "supplier_tax_profiles_vat_consistency_check"
  CHECK (
    ("is_vat_registered" = true AND "vat_number" ~ '^[0-9]{15}$') OR
    ("is_vat_registered" = false AND "vat_number" IS NULL)
  );
