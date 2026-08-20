CREATE TABLE "shipping_tariff_policy_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" SERIAL NOT NULL,
    "same_city_fee_amount" DECIMAL(12,2) NOT NULL,
    "same_region_different_city_fee_amount" DECIMAL(12,2) NOT NULL,
    "different_region_fee_amount" DECIMAL(12,2) NOT NULL,
    "provider_code" TEXT NOT NULL DEFAULT 'ADMIN_TARIFF_V1',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_tariff_policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shipping_tariff_policy_versions_version_key" ON "shipping_tariff_policy_versions"("version");

ALTER TABLE "shipping_tariff_policy_versions" ADD CONSTRAINT "shipping_tariff_non_negative"
  CHECK (
    "same_city_fee_amount" >= 0
    AND "same_region_different_city_fee_amount" >= 0
    AND "different_region_fee_amount" >= 0
  );

CREATE OR REPLACE FUNCTION prevent_shipping_tariff_policy_version_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'shipping_tariff_policy_versions rows are immutable — insert a new version instead (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_shipping_tariff_policy_version_update
  BEFORE UPDATE ON "shipping_tariff_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_shipping_tariff_policy_version_change();

CREATE TRIGGER trg_prevent_shipping_tariff_policy_version_delete
  BEFORE DELETE ON "shipping_tariff_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_shipping_tariff_policy_version_change();
