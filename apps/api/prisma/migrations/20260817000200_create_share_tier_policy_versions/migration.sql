-- share_tier_policy_versions — Append-Only, exactly like
-- product_approval_snapshots: every admin edit inserts a NEW row,
-- never UPDATEs. Enforced unconditionally by a trigger below.

CREATE TABLE "share_tier_policy_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" SERIAL NOT NULL,
    "tiers" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_tier_policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "share_tier_policy_versions_version_key" ON "share_tier_policy_versions"("version");

-- Validates: non-empty array; every maxTotalValueInclTax is a
-- positive number EXCEPT the last element, which must be exactly
-- null (open-ended final tier); bounds strictly ascending, no
-- duplicates; every shareBasisPoints is an integer in (0,10000] that
-- divides 10000 evenly (so a whole number of shares always completes
-- exactly 100%).
CREATE OR REPLACE FUNCTION validate_share_tiers(tiers JSONB) RETURNS BOOLEAN AS $$
DECLARE
  tier JSONB;
  idx INT;
  n INT;
  prev_bound NUMERIC := NULL;
  cur_bound NUMERIC;
  cur_bps INT;
BEGIN
  IF tiers IS NULL OR jsonb_typeof(tiers) != 'array' THEN RETURN false; END IF;
  n := jsonb_array_length(tiers);
  IF n = 0 THEN RETURN false; END IF;

  FOR idx IN 0..n-1 LOOP
    tier := tiers->idx;
    IF tier IS NULL OR jsonb_typeof(tier) != 'object' THEN RETURN false; END IF;

    IF jsonb_typeof(tier->'shareBasisPoints') != 'number' THEN RETURN false; END IF;
    cur_bps := (tier->>'shareBasisPoints')::INT;
    IF cur_bps IS NULL OR cur_bps <= 0 OR cur_bps > 10000 THEN RETURN false; END IF;
    IF 10000 % cur_bps != 0 THEN RETURN false; END IF;

    IF jsonb_typeof(tier->'maxTotalValueInclTax') = 'null' THEN
      IF idx != n - 1 THEN RETURN false; END IF;
    ELSIF jsonb_typeof(tier->'maxTotalValueInclTax') = 'number' THEN
      IF idx = n - 1 THEN RETURN false; END IF;
      cur_bound := (tier->>'maxTotalValueInclTax')::NUMERIC;
      IF cur_bound <= 0 THEN RETURN false; END IF;
      IF prev_bound IS NOT NULL AND cur_bound <= prev_bound THEN RETURN false; END IF;
      prev_bound := cur_bound;
    ELSE
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

ALTER TABLE "share_tier_policy_versions"
  ADD CONSTRAINT "share_tier_policy_versions_tiers_valid" CHECK (validate_share_tiers("tiers"));

CREATE OR REPLACE FUNCTION prevent_share_tier_policy_version_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'share_tier_policy_versions rows are immutable — insert a new version instead (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_share_tier_policy_version_update
  BEFORE UPDATE ON "share_tier_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_share_tier_policy_version_change();

CREATE TRIGGER trg_prevent_share_tier_policy_version_delete
  BEFORE DELETE ON "share_tier_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION prevent_share_tier_policy_version_change();

-- Version 1 — the documented default tiers, seeded here so
-- getCurrentPolicy() never has to invent an in-memory default: a
-- real, referenceable row always exists from the moment this
-- migration runs. created_by is NULL (system-seeded), matching the
-- existing nullable-actor precedent used elsewhere for SYSTEM rows.
INSERT INTO "share_tier_policy_versions" (tiers, created_by) VALUES (
  '[
    {"maxTotalValueInclTax": 50000, "shareBasisPoints": 1000},
    {"maxTotalValueInclTax": 200000, "shareBasisPoints": 500},
    {"maxTotalValueInclTax": null, "shareBasisPoints": 250}
  ]'::jsonb,
  NULL
);
