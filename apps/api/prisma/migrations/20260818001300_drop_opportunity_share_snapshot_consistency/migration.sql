-- Explicit DROP first — a multi-column CHECK constraint referencing
-- sales_unit_id blocks dropping that column outright. Recreated with
-- the corrected reference (sales_unit_name_ar) plus the new commission
-- fields in the next-but-one migration, after the column is gone.

ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_share_snapshot_consistency";
