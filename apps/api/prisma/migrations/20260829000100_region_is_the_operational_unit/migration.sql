-- The region becomes the platform's operational unit; the city becomes
-- an optional refinement.
--
-- WHY. Every operational question about a branch — where it ships
-- from, what a delivery costs, whether a listing may go live — was
-- answered through a city, and `company_locations.city_id` was NOT
-- NULL. So a branch could not be recorded by region alone, and
-- switching cities off switched the platform off with them: no listing
-- could be published and no branch could be added. The region is the
-- unit the business actually works in, and this makes the schema say
-- so.
--
-- WHAT IT DOES NOT DO, and this is most of it:
--
--   · It DELETES NO REFERENCE DATA. Every region and every city stays,
--     including the Sentinel rows, because historical records point at
--     them. `city_id` keeps its foreign key and every branch keeps the
--     city it already had.
--   · It TOUCHES NO SNAPSHOT AND NO ORDER. The four frozen name
--     columns on `checkout_location_allocations`, the fulfillment
--     snapshots on `opportunities`, and every stored
--     `shipping_tier_code` / `shipping_fee_amount` are left exactly as
--     they are. A snapshot records what was true when it was taken;
--     rewriting one falsifies a financial record.
--   · It CHANGES NO PRICE. The shipping tariff table is not read or
--     written here. The three tiers and their amounts are unchanged —
--     what changed is the rule that chooses between them, and that
--     lives in `packages/domain/src/checkout-shipping-tier.ts`.
--
-- IT IS WRITTEN TO BE RE-RUNNABLE. Every step is guarded, so a partial
-- run can be repeated without harm.

-- ---------------------------------------------------------------------
-- 1. The one row that has to go first.
--
-- A single branch sits on the Sentinel city — a test artefact created
-- while auditing this platform, already deactivated. It is deleted
-- rather than migrated, because the Sentinel region is inactive and
-- migrating it would put a live-looking branch in «غير محدد», which is
-- precisely the state this migration exists to make impossible.
--
-- THE DELETE IS CONDITIONAL ON HAVING NO REFERENCES. Both counts were
-- verified as zero before this was written, and the guard repeats the
-- check at run time rather than trusting that: nothing here may remove
-- a branch an order or a listing points at.
-- ---------------------------------------------------------------------
DELETE FROM "company_locations" l
WHERE l.city_id = '00000000-0000-0000-0000-000000000000'
  AND l.name LIKE 'فحص %'
  AND NOT EXISTS (SELECT 1 FROM "opportunities" o WHERE o.fulfillment_location_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM "checkout_location_allocations" k WHERE k.company_location_id = l.id);

-- ---------------------------------------------------------------------
-- 2. The region column, added nullable so the backfill has somewhere
--    to write before the constraint is applied.
-- ---------------------------------------------------------------------
ALTER TABLE "company_locations" ADD COLUMN IF NOT EXISTS "region_id" uuid;

-- ---------------------------------------------------------------------
-- 3. The backfill: every branch takes the region of the city it is
--    already in.
--
-- LOSSLESS. `cities.region_id` is NOT NULL, so every branch with a
-- city resolves to exactly one region, and no branch needs a default,
-- a guess, or a Sentinel. The city is KEPT — this copies, it does not
-- move.
-- ---------------------------------------------------------------------
UPDATE "company_locations" l
SET region_id = c.region_id
FROM "cities" c
WHERE c.id = l.city_id
  AND l.region_id IS NULL;

-- ---------------------------------------------------------------------
-- 4. Refuse to continue if anything was left behind.
--
-- A branch with no region after the backfill would be one the
-- constraint below cannot accept, and failing here with a readable
-- message is better than failing there with a constraint violation
-- that names no row.
-- ---------------------------------------------------------------------
DO $$
DECLARE orphans integer;
BEGIN
  SELECT count(*) INTO orphans FROM "company_locations" WHERE region_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      '% company_locations rows could not be given a region. Resolve them before re-running.', orphans;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. The region is required; the city is not.
--
-- BOTH HALVES MATTER. Making the region NOT NULL is what makes it the
-- unit of record. Making the city nullable is what lets a branch be
-- added on a region alone — without it, the first half would be
-- decoration and every new branch would still have to name a city.
-- ---------------------------------------------------------------------
ALTER TABLE "company_locations" ALTER COLUMN "region_id" SET NOT NULL;
ALTER TABLE "company_locations" ALTER COLUMN "city_id" DROP NOT NULL;

-- ---------------------------------------------------------------------
-- 6. The foreign key and the index.
--
-- The FK is what stops a branch naming a region that does not exist.
-- The index is what keeps a marketplace filter by region — now the
-- primary filter — from scanning the table.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_locations_region_id_fkey'
  ) THEN
    ALTER TABLE "company_locations"
      ADD CONSTRAINT "company_locations_region_id_fkey"
      FOREIGN KEY ("region_id") REFERENCES "regions"("id")
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "company_locations_region_id_idx"
  ON "company_locations"("region_id");

-- ---------------------------------------------------------------------
-- 7. The frozen city name on a checkout allocation becomes nullable.
--
-- NOT A CHANGE TO ANY EXISTING ROW. Every allocation ever written keeps
-- the exact names it froze; dropping NOT NULL reads no row and writes
-- none. What it permits is the NEXT allocation, from a branch that
-- names no city: there is no city name to freeze, and the honest
-- record of that is null.
--
-- THE ALTERNATIVE WAS TO WRITE AN EMPTY STRING, which would sit in a
-- financial record looking like a value somebody entered. A snapshot
-- says what was true; "" says nothing was true, which is different
-- from "there was no city".
--
-- THE REGION SNAPSHOTS STAY NOT NULL. A branch always has a region, so
-- there is always a region name to freeze.
-- ---------------------------------------------------------------------
ALTER TABLE "checkout_location_allocations" ALTER COLUMN "city_name_ar_snapshot" DROP NOT NULL;
ALTER TABLE "checkout_location_allocations" ALTER COLUMN "city_name_en_snapshot" DROP NOT NULL;

-- ---------------------------------------------------------------------
-- 8. A branch's city, when it has one, must belong to that branch's
--    region.
--
-- ENFORCED IN THE DATABASE, not only in a service. A branch whose city
-- and region disagree would price a delivery against one place and
-- display another, and the two would drift silently.
--
-- A TRIGGER RATHER THAN A CHECK CONSTRAINT, because a CHECK cannot
-- query another table and the rule is about a row in `cities`. It
-- reads one row by primary key, on write only, and only when a city is
-- actually named.
--
-- The services enforce the same rule with a message an operator can
-- act on. This is the floor underneath them: a direct write, a script,
-- or a service that forgets still cannot produce a branch whose city
-- is in another region.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION company_location_city_matches_region()
RETURNS trigger AS $$
DECLARE city_region uuid;
BEGIN
  IF NEW.city_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT region_id INTO city_region FROM "cities" WHERE id = NEW.city_id;
  IF city_region IS NULL THEN
    RAISE EXCEPTION 'company_locations.city_id % names no city', NEW.city_id;
  END IF;
  IF city_region <> NEW.region_id THEN
    RAISE EXCEPTION
      'company_locations.city_id % is not in region %', NEW.city_id, NEW.region_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS company_location_city_matches_region_trg ON "company_locations";
CREATE TRIGGER company_location_city_matches_region_trg
  BEFORE INSERT OR UPDATE OF city_id, region_id ON "company_locations"
  FOR EACH ROW EXECUTE FUNCTION company_location_city_matches_region();
