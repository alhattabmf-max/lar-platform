-- MasterOrder: frozen trader billing snapshot, captured exactly once
-- at Capture time, inside the same transaction that creates the
-- order — never re-derived from the live TraderTaxProfile afterward.
ALTER TABLE "master_orders" ADD COLUMN "trader_tax_profile_snapshot" JSONB;
ALTER TABLE "master_orders" ADD COLUMN "trader_billing_legal_name_snapshot" TEXT;

-- trader_tax_profiles: non-empty legal name within a safe length, and
-- a validated Saudi VAT number format (15 digits) whenever present —
-- not merely "not null".
ALTER TABLE "trader_tax_profiles" ADD CONSTRAINT "trader_tax_profiles_billing_legal_name_non_empty"
  CHECK (length(btrim("billing_legal_name")) > 0 AND length("billing_legal_name") <= 300);
ALTER TABLE "trader_tax_profiles" ADD CONSTRAINT "trader_tax_profiles_vat_number_format"
  CHECK ("vat_number" IS NULL OR "vat_number" ~ '^[0-9]{15}$');
