-- -------------------------------------------------------------------
-- Rename enum values: no legal invoice semantics in 7E. Postgres
-- supports renaming enum values directly (10+).
-- -------------------------------------------------------------------
ALTER TYPE "InvoiceDocumentType" RENAME VALUE 'PRODUCT_INVOICE' TO 'INTERNAL_PRODUCT_DRAFT';
ALTER TYPE "InvoiceDocumentType" RENAME VALUE 'COMMISSION_INVOICE' TO 'INTERNAL_COMMISSION_DRAFT';
ALTER TYPE "InvoiceDocumentType" RENAME VALUE 'CREDIT_NOTE' TO 'INTERNAL_ADJUSTMENT_DRAFT';

-- -------------------------------------------------------------------
-- Rename providerInvoiceReference -> internalDocumentReference,
-- required and unique whenever present (drafts always carry one).
-- -------------------------------------------------------------------
ALTER TABLE "invoice_documents" RENAME COLUMN "provider_invoice_reference" TO "internal_document_reference";
ALTER TABLE "invoice_documents" ALTER COLUMN "internal_document_reference" SET NOT NULL;
CREATE UNIQUE INDEX "invoice_documents_internal_document_reference_key" ON "invoice_documents"("internal_document_reference");

-- Drop and recreate the CHECK referencing the old enum literal.
ALTER TABLE "invoice_documents" DROP CONSTRAINT "invoice_documents_credit_note_relation_consistency";
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_adjustment_relation_consistency"
  CHECK (
    ("document_type" = 'INTERNAL_ADJUSTMENT_DRAFT' AND "related_invoice_document_id" IS NOT NULL)
    OR ("document_type" != 'INTERNAL_ADJUSTMENT_DRAFT' AND "related_invoice_document_id" IS NULL)
  );

-- Never allow a document to point to itself.
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_no_self_reference"
  CHECK ("related_invoice_document_id" IS NULL OR "related_invoice_document_id" != "id");

-- Amount must be non-negative.
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_amount_non_negative"
  CHECK ("amount" >= 0);

-- Amount must match the frozen snapshotData equation for each draft
-- type — not just trusted from the application layer.
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_product_amount_matches_snapshot"
  CHECK (
    "document_type" != 'INTERNAL_PRODUCT_DRAFT'
    OR "amount" = ("snapshot_data"->>'totalInclTax')::DECIMAL(14,2)
  );
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_commission_amount_matches_snapshot"
  CHECK (
    "document_type" != 'INTERNAL_COMMISSION_DRAFT'
    OR "amount" = (("snapshot_data"->>'commissionExclTax')::DECIMAL(14,2) + ("snapshot_data"->>'commissionTax')::DECIMAL(14,2))
  );

-- -------------------------------------------------------------------
-- Deferred: an adjustment must reference a document belonging to the
-- SAME MasterOrder, and the running sum of adjustments against one
-- original document may never exceed that document's own amount.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_invoice_adjustment_consistency()
RETURNS TRIGGER AS $$
DECLARE
  v_related_master_order_id UUID;
  v_related_amount DECIMAL(14,2);
  v_adjustment_sum DECIMAL(14,2);
BEGIN
  IF NEW."document_type" != 'INTERNAL_ADJUSTMENT_DRAFT' THEN
    RETURN NULL;
  END IF;

  SELECT "master_order_id", "amount" INTO v_related_master_order_id, v_related_amount
    FROM "invoice_documents" WHERE "id" = NEW."related_invoice_document_id";

  IF v_related_master_order_id != NEW."master_order_id" THEN
    RAISE EXCEPTION 'invoice_documents: adjustment (id=%) must reference a document from the SAME master_order_id (related belongs to %, this belongs to %)', NEW."id", v_related_master_order_id, NEW."master_order_id";
  END IF;

  SELECT COALESCE(SUM("amount"), 0) INTO v_adjustment_sum
    FROM "invoice_documents"
    WHERE "related_invoice_document_id" = NEW."related_invoice_document_id" AND "document_type" = 'INTERNAL_ADJUSTMENT_DRAFT';

  IF v_adjustment_sum > v_related_amount THEN
    RAISE EXCEPTION 'invoice_documents: sum of adjustments (%) against document % exceeds its original amount (%)', v_adjustment_sum, NEW."related_invoice_document_id", v_related_amount;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_invoice_adjustment_consistency
  AFTER INSERT ON "invoice_documents"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_invoice_adjustment_consistency();

-- -------------------------------------------------------------------
-- platform_billing_profile_versions — Versioned, Append-only. No
-- default seed row — absence must block commission draft creation
-- with an explicit error, never silently fall back to anything.
-- -------------------------------------------------------------------
CREATE TABLE "platform_billing_profile_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "cr_number" TEXT NOT NULL,
    "is_vat_registered" BOOLEAN NOT NULL,
    "vat_number" TEXT,
    "address_snapshot" JSONB NOT NULL,
    "created_by_admin_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_billing_profile_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_billing_profile_versions_version_key" ON "platform_billing_profile_versions"("version");
ALTER TABLE "platform_billing_profile_versions" ADD CONSTRAINT "pbpv_legal_name_non_empty"
  CHECK (length(btrim("legal_name")) > 0 AND length("legal_name") <= 300);
ALTER TABLE "platform_billing_profile_versions" ADD CONSTRAINT "pbpv_vat_number_required_if_registered"
  CHECK (NOT "is_vat_registered" OR "vat_number" IS NOT NULL);
ALTER TABLE "platform_billing_profile_versions" ADD CONSTRAINT "pbpv_vat_number_format"
  CHECK ("vat_number" IS NULL OR "vat_number" ~ '^[0-9]{15}$');

CREATE OR REPLACE FUNCTION prevent_pbpv_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'platform_billing_profile_versions: rows are append-only and immutable (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_prevent_pbpv_mutation
  BEFORE UPDATE OR DELETE ON "platform_billing_profile_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_pbpv_mutation();
