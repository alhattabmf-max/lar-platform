-- commission_policy_versions — Append-Only, identical pattern to
-- share_tier_policy_versions: every admin change inserts a NEW row,
-- never UPDATEs. Enforced unconditionally by a trigger below.

CREATE TABLE "commission_policy_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" SERIAL NOT NULL,
    "rate_basis_points" INTEGER NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commission_policy_versions_version_key" ON "commission_policy_versions"("version");

ALTER TABLE "commission_policy_versions"
  ADD CONSTRAINT "commission_policy_versions_rate_range"
  CHECK ("rate_basis_points" >= 0 AND "rate_basis_points" <= 10000);

CREATE OR REPLACE FUNCTION prevent_commission_policy_version_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'commission_policy_versions rows are immutable — insert a new version instead (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_commission_policy_version_update
  BEFORE UPDATE ON "commission_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_commission_policy_version_change();

CREATE TRIGGER trg_prevent_commission_policy_version_delete
  BEFORE DELETE ON "commission_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_commission_policy_version_change();

INSERT INTO "commission_policy_versions" (rate_basis_points, created_by) VALUES (500, NULL);
