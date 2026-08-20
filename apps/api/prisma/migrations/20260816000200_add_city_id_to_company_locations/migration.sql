-- Phase 6 — deterministic, production-safe migration: add city_id to
-- company_locations without truncating or assuming an empty table.
-- Nullable first -> backfill existing rows to the Sentinel city
-- (never silently, always visible via an inactive, obviously-named
-- row an operator can find and correct) -> only then NOT NULL.

ALTER TABLE "company_locations" ADD COLUMN "city_id" UUID;

UPDATE "company_locations" SET "city_id" = '00000000-0000-0000-0000-000000000000'
WHERE "city_id" IS NULL;

ALTER TABLE "company_locations" ALTER COLUMN "city_id" SET NOT NULL;

CREATE INDEX "company_locations_city_id_idx" ON "company_locations"("city_id");

ALTER TABLE "company_locations" ADD CONSTRAINT "company_locations_city_id_fkey"
  FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
