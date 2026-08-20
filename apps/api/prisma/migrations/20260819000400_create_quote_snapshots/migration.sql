CREATE TABLE "quote_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkout_session_id" UUID NOT NULL,
    "product_approval_snapshot_id" UUID NOT NULL,
    "sales_unit_name_ar" TEXT NOT NULL,
    "sales_unit_name_en" TEXT NOT NULL,
    "package_content_quantity" DECIMAL(10,3),
    "package_content_unit_name_ar" TEXT,
    "package_content_unit_name_en" TEXT,
    "quantity" INTEGER NOT NULL,
    "share_quantity" INTEGER NOT NULL,
    "share_percentage_readable" DECIMAL(5,2) NOT NULL,
    "unit_price_incl_tax_amount" DECIMAL(12,2) NOT NULL,
    "unit_price_excl_tax_amount" DECIMAL(12,2) NOT NULL,
    "unit_tax_amount" DECIMAL(12,2) NOT NULL,
    "tax_rate_percent" DECIMAL(5,2) NOT NULL,
    "tax_calculation_rule_code" TEXT NOT NULL,
    "tax_calculation_rule_version" TEXT NOT NULL,
    "products_subtotal_excl_tax_amount" DECIMAL(14,2) NOT NULL,
    "products_tax_amount" DECIMAL(14,2) NOT NULL,
    "products_subtotal_incl_tax_amount" DECIMAL(14,2) NOT NULL,
    "total_shipping_fee_amount" DECIMAL(12,2) NOT NULL,
    "grand_total_amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "shipping_tariff_policy_version_id" UUID NOT NULL,
    "shipping_provider_code" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quote_snapshots_checkout_session_id_key" ON "quote_snapshots"("checkout_session_id");

ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_checkout_session_id_fkey"
  FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_product_approval_snapshot_id_fkey"
  FOREIGN KEY ("product_approval_snapshot_id") REFERENCES "product_approval_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_shipping_tariff_policy_version_id_fkey"
  FOREIGN KEY ("shipping_tariff_policy_version_id") REFERENCES "shipping_tariff_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_package_content_group"
  CHECK (
    ("package_content_quantity" IS NULL AND "package_content_unit_name_ar" IS NULL AND "package_content_unit_name_en" IS NULL)
    OR
    ("package_content_quantity" IS NOT NULL AND "package_content_unit_name_ar" IS NOT NULL AND "package_content_unit_name_en" IS NOT NULL)
  );

ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_products_subtotal_equation"
  CHECK ("products_subtotal_incl_tax_amount" = "products_subtotal_excl_tax_amount" + "products_tax_amount");
ALTER TABLE "quote_snapshots" ADD CONSTRAINT "quote_snapshots_grand_total_equation"
  CHECK ("grand_total_amount" = "products_subtotal_incl_tax_amount" + "total_shipping_fee_amount");

CREATE OR REPLACE FUNCTION prevent_quote_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quote_snapshots: rows are append-only and cannot be deleted (id=%)', OLD."id";
  END IF;
  RAISE EXCEPTION 'quote_snapshots: rows are append-only and cannot be modified (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_quote_snapshot_mutation
  BEFORE UPDATE OR DELETE ON "quote_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_quote_snapshot_mutation();
