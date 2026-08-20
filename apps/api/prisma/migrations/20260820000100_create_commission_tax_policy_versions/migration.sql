CREATE TABLE "commission_tax_policy_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" SERIAL NOT NULL,
    "rate_percent" DECIMAL(5,2) NOT NULL,
    "rule_code" TEXT NOT NULL,
    "rule_version" TEXT NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_tax_policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commission_tax_policy_versions_version_key" ON "commission_tax_policy_versions"("version");

ALTER TABLE "commission_tax_policy_versions"
  ADD CONSTRAINT "commission_tax_policy_versions_rate_range"
  CHECK ("rate_percent" >= 0 AND "rate_percent" <= 100);

CREATE OR REPLACE FUNCTION prevent_commission_tax_policy_version_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'commission_tax_policy_versions rows are immutable — insert a new version instead (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_commission_tax_policy_version_update
  BEFORE UPDATE ON "commission_tax_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_commission_tax_policy_version_change();

CREATE TRIGGER trg_prevent_commission_tax_policy_version_delete
  BEFORE DELETE ON "commission_tax_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_commission_tax_policy_version_change();

-- Deliberately NO seed row — getCurrentPolicy() must fail explicitly
-- (COMMISSION_TAX_NOT_CONFIGURED) until an admin sets a real rate.
