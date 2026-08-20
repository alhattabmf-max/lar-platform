-- Phase 5 — Supplier Financial Readiness

-- CreateEnum
CREATE TYPE "BankAccountVerificationStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "active_bank_account_id" UUID,
ADD COLUMN     "payout_hold_until" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "supplier_bank_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "account_holder_name" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "iban_ciphertext" TEXT NOT NULL,
    "iban_fingerprint" TEXT NOT NULL,
    "iban_last4" TEXT NOT NULL,
    "verification_status" "BankAccountVerificationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "rejection_reason" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_tax_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "is_vat_registered" BOOLEAN NOT NULL,
    "vat_number" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoicing_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "invoicing_legal_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_invoicing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_bank_accounts_company_id_idx" ON "supplier_bank_accounts"("company_id");

-- CreateIndex
CREATE INDEX "supplier_bank_accounts_iban_fingerprint_idx" ON "supplier_bank_accounts"("iban_fingerprint");

-- CreateIndex
CREATE INDEX "supplier_bank_accounts_verification_status_idx" ON "supplier_bank_accounts"("verification_status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_tax_profiles_company_id_key" ON "supplier_tax_profiles"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoicing_profiles_company_id_key" ON "supplier_invoicing_profiles"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "companies_active_bank_account_id_key" ON "companies"("active_bank_account_id");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_active_bank_account_id_fkey" FOREIGN KEY ("active_bank_account_id") REFERENCES "supplier_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_bank_accounts" ADD CONSTRAINT "supplier_bank_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_tax_profiles" ADD CONSTRAINT "supplier_tax_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoicing_profiles" ADD CONSTRAINT "supplier_invoicing_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Defense in depth: once a supplier_bank_accounts row leaves
-- PENDING_VERIFICATION (i.e. becomes VERIFIED, REJECTED, or
-- SUPERSEDED), its identity-defining fields (who/what the account is)
-- are frozen at the database level — application code never exposes
-- an edit path for them either, but this closes the gap regardless of
-- future code changes. verification_status, rejection_reason,
-- verified_at, and updated_at remain freely updatable (that is how a
-- row legitimately moves PENDING_VERIFICATION -> VERIFIED/REJECTED,
-- and VERIFIED -> SUPERSEDED).
CREATE OR REPLACE FUNCTION prevent_verified_bank_account_identity_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."verification_status" <> 'PENDING_VERIFICATION' THEN
    IF NEW."iban_ciphertext" IS DISTINCT FROM OLD."iban_ciphertext"
       OR NEW."iban_fingerprint" IS DISTINCT FROM OLD."iban_fingerprint"
       OR NEW."iban_last4" IS DISTINCT FROM OLD."iban_last4"
       OR NEW."account_holder_name" IS DISTINCT FROM OLD."account_holder_name"
       OR NEW."bank_name" IS DISTINCT FROM OLD."bank_name"
       OR NEW."company_id" IS DISTINCT FROM OLD."company_id"
    THEN
      RAISE EXCEPTION 'supplier_bank_accounts: cannot modify account identity fields once verification_status has left PENDING_VERIFICATION (id=%)', OLD."id";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_verified_bank_account_identity_change
  BEFORE UPDATE ON "supplier_bank_accounts"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_verified_bank_account_identity_change();
