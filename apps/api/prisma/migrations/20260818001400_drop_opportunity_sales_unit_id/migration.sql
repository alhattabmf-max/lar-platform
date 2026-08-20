-- sales_unit_id is no longer read by anything: the trigger no longer
-- references it (previous migration), the consistency constraint that
-- referenced it was already dropped (previous migration), and
-- Opportunity.salesUnitNameAr/En (already present, already correctly
-- populated for every existing published row) are the sole source of
-- truth going forward. Safe to drop outright — no Backfill needed here,
-- the meaningful data (the names) was never stored on this column.

ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_sales_unit_id_fkey";
ALTER TABLE "opportunities" DROP COLUMN "sales_unit_id";
