-- -------------------------------------------------------------------
-- supplier_payouts
-- -------------------------------------------------------------------
CREATE TABLE "supplier_payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_allocation_id" UUID NOT NULL,
    "external_transfer_reference" TEXT NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "supplier_bank_account_id" UUID NOT NULL,
    "executed_by_admin_user_id" UUID NOT NULL,
    "executed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supplier_payouts_order_allocation_id_key" ON "supplier_payouts"("order_allocation_id");
CREATE UNIQUE INDEX "supplier_payouts_external_transfer_reference_key" ON "supplier_payouts"("external_transfer_reference");
ALTER TABLE "supplier_payouts" ADD CONSTRAINT "supplier_payouts_external_transfer_reference_non_empty" CHECK (length(btrim("external_transfer_reference")) > 0);
ALTER TABLE "supplier_payouts" ADD CONSTRAINT "supplier_payouts_order_allocation_id_fkey"
  FOREIGN KEY ("order_allocation_id") REFERENCES "order_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payouts" ADD CONSTRAINT "supplier_payouts_supplier_bank_account_id_fkey"
  FOREIGN KEY ("supplier_bank_account_id") REFERENCES "supplier_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_supplier_payout_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'supplier_payouts: rows are immutable (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_prevent_supplier_payout_mutation
  BEFORE UPDATE OR DELETE ON "supplier_payouts"
  FOR EACH ROW EXECUTE FUNCTION prevent_supplier_payout_mutation();

-- -------------------------------------------------------------------
-- invoice_documents — unified, immutable, self-referencing for credit
-- notes. No polymorphic type+id pair anywhere.
-- -------------------------------------------------------------------
CREATE TYPE "InvoiceDocumentType" AS ENUM ('PRODUCT_INVOICE', 'COMMISSION_INVOICE', 'CREDIT_NOTE');

CREATE TABLE "invoice_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_type" "InvoiceDocumentType" NOT NULL,
    "master_order_id" UUID NOT NULL,
    "related_invoice_document_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider_invoice_reference" TEXT,
    "snapshot_data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoice_documents_master_order_id_document_type_key"
  ON "invoice_documents"("master_order_id", "document_type")
  WHERE "document_type" IN ('PRODUCT_INVOICE', 'COMMISSION_INVOICE');
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_master_order_id_fkey"
  FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_related_invoice_document_id_fkey"
  FOREIGN KEY ("related_invoice_document_id") REFERENCES "invoice_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_credit_note_relation_consistency"
  CHECK (
    ("document_type" = 'CREDIT_NOTE' AND "related_invoice_document_id" IS NOT NULL)
    OR ("document_type" != 'CREDIT_NOTE' AND "related_invoice_document_id" IS NULL)
  );

CREATE OR REPLACE FUNCTION prevent_invoice_document_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'invoice_documents: rows are immutable — corrections must be a new CREDIT_NOTE row (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_prevent_invoice_document_mutation
  BEFORE UPDATE OR DELETE ON "invoice_documents"
  FOR EACH ROW EXECUTE FUNCTION prevent_invoice_document_mutation();

-- -------------------------------------------------------------------
-- shipping_documents — carrier reference only, never a FORSA-issued
-- tax invoice.
-- -------------------------------------------------------------------
CREATE TABLE "shipping_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_allocation_id" UUID NOT NULL,
    "carrier_reference" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shipping_documents_order_allocation_id_key" ON "shipping_documents"("order_allocation_id");
ALTER TABLE "shipping_documents" ADD CONSTRAINT "shipping_documents_carrier_reference_non_empty" CHECK (length(btrim("carrier_reference")) > 0);
ALTER TABLE "shipping_documents" ADD CONSTRAINT "shipping_documents_order_allocation_id_fkey"
  FOREIGN KEY ("order_allocation_id") REFERENCES "order_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_shipping_document_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'shipping_documents: rows are append-only (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_prevent_shipping_document_mutation
  BEFORE UPDATE OR DELETE ON "shipping_documents"
  FOR EACH ROW EXECUTE FUNCTION prevent_shipping_document_mutation();

-- -------------------------------------------------------------------
-- trader_tax_profiles — self-service
-- -------------------------------------------------------------------
CREATE TABLE "trader_tax_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "is_vat_registered" BOOLEAN NOT NULL,
    "vat_number" TEXT,
    "billing_legal_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trader_tax_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "trader_tax_profiles_company_id_key" ON "trader_tax_profiles"("company_id");
ALTER TABLE "trader_tax_profiles" ADD CONSTRAINT "trader_tax_profiles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trader_tax_profiles" ADD CONSTRAINT "trader_tax_profiles_vat_number_required_if_registered"
  CHECK (NOT "is_vat_registered" OR "vat_number" IS NOT NULL);

-- -------------------------------------------------------------------
-- master_order_buyer_billing_overrides — immutable, admin-only
-- -------------------------------------------------------------------
CREATE TABLE "master_order_buyer_billing_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "master_order_id" UUID NOT NULL,
    "trader_tax_profile_snapshot_override" JSONB NOT NULL,
    "created_by_admin_user_id" UUID NOT NULL,
    "reason_note" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_order_buyer_billing_overrides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "master_order_buyer_billing_overrides_master_order_id_key" ON "master_order_buyer_billing_overrides"("master_order_id");
ALTER TABLE "master_order_buyer_billing_overrides" ADD CONSTRAINT "mobbo_reason_note_non_empty" CHECK (length(btrim("reason_note")) > 0);
ALTER TABLE "master_order_buyer_billing_overrides" ADD CONSTRAINT "master_order_buyer_billing_overrides_master_order_id_fkey"
  FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_mobbo_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'master_order_buyer_billing_overrides: rows are immutable (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_prevent_mobbo_mutation
  BEFORE UPDATE OR DELETE ON "master_order_buyer_billing_overrides"
  FOR EACH ROW EXECUTE FUNCTION prevent_mobbo_mutation();
