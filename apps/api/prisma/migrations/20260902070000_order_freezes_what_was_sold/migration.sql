-- THE ORDER FREEZES WHAT WAS SOLD, AS IT ALREADY FREEZES WHO SOLD IT.
--
-- «منتج نشرت له عرضًا وانتهى وتم تسليم المشترين بضاعتهم — خلاص، يتم
--  التحكم فيه مثل التعديل يكون فيه حذف.»
--
-- WHAT WAS MISSING, AND IT IS NOT A SMALL THING. A master order carries
-- SEVEN snapshots of the parties — the supplier's legal name, its CR
-- number, its tax and invoicing profiles, the buyer's tax profile and
-- billing name — and the checkout allocation freezes the branch, the
-- city, the region, the address and the contact. Every one of those was
-- copied precisely so the record would outlive the row it came from.
--
-- NOTHING FREEZES THE GOODS. Not the order, not the allocation, and not
-- `invoice_documents.snapshot_data`, whose keys are buyer, seller,
-- currency, shipping, taxAmount, totalInclTax, documentPurpose and
-- subtotalExclTax. The only path from an invoice to WHAT WAS INVOICED
-- ran invoice -> order -> opportunity -> approval snapshot -> product,
-- five hops through rows that may be deleted.
--
-- SO AN INVOICE COULD NOT SURVIVE ITS PRODUCT, and the platform closed
-- the gap by refusing to let the product go — which is backwards. A
-- correct invoice is self-contained; it does not hold a pointer and
-- hope. Once it carries the line, deleting the product costs nothing,
-- and the owner gets the control he asked for without anything being
-- lost.
--
-- ADDED NULLABLE, BACKFILLED, THEN MADE NOT NULL. The columns cannot
-- start NOT NULL on a table that already has rows, and a default would
-- write a lie into an existing order. The backfill reads each order's
-- own frozen approval snapshot — the same source the screen reads
-- today — so an order written before this migration ends up holding
-- exactly what it was already showing.
--
-- THE PRICE AND QUANTITY ARE THE ONES THE ORDER WAS PRICED ON, not
-- today's: the unit price comes from the opportunity that was bought
-- and the quantity from the checkout session that was locked.
--
-- AND THE TAX-INCLUSIVE UNIT PRICE IS A SUM, because the opportunity
-- stores the two halves — `unit_price_excl_tax_amount` and
-- `unit_tax_amount` — rather than a third column that could disagree
-- with them. Checked against the one order on this database: 250 + 37.5
-- = 287.5, ten of them is 2,875, and `total_amount` is 2,925 because
-- it also carries 50 of shipping. The line and the total therefore do
-- not have to match, and neither is derived from the other.

ALTER TABLE "master_orders"
  ADD COLUMN IF NOT EXISTS "product_name_ar_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "product_name_en_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "sales_unit_name_ar_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "sales_unit_name_en_snapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "unit_price_incl_tax_snapshot" DECIMAL(14,2),
  ADD COLUMN IF NOT EXISTS "total_quantity_snapshot" INT;

-- THE BACKFILL DISABLES THE ORDER'S OWN GUARD, AND SAYS SO.
--
-- `prevent_master_order_mutation` permits exactly one change after
-- creation — IN_FULFILLMENT -> FULFILLED — and refuses every other
-- UPDATE with "core fields are frozen after creation". That is right,
-- and this migration is the single exception the rule cannot express:
-- it is not changing what an order SAYS, it is copying into the row
-- what the row already meant, from the frozen snapshot the screen has
-- been reading all along.
--
-- THE WINDOW IS ONE TRANSACTION AND ONE STATEMENT. DDL is
-- transactional in Postgres, so a failure anywhere between BEGIN and
-- COMMIT rolls the disable back with everything else — the guard can
-- never be left off. Nothing but the backfill runs inside it.

BEGIN;

ALTER TABLE "master_orders" DISABLE TRIGGER "trg_prevent_master_order_mutation";

-- The backfill. `product_approval_snapshots.snapshot` is the
-- frozen JSON an opportunity was published from; the two name keys have
-- been in it since Phase 4.
UPDATE "master_orders" m
SET
  "product_name_ar_snapshot" = COALESCE(s."snapshot" ->> 'nameAr', '—'),
  "product_name_en_snapshot" = COALESCE(s."snapshot" ->> 'nameEn', '—'),
  "sales_unit_name_ar_snapshot" = o."sales_unit_name_ar",
  "sales_unit_name_en_snapshot" = o."sales_unit_name_en",
  "unit_price_incl_tax_snapshot" = (o."unit_price_excl_tax_amount" + o."unit_tax_amount"),
  "total_quantity_snapshot" = cs."locked_quantity"
FROM "opportunities" o
  JOIN "product_approval_snapshots" s ON s."id" = o."product_approval_snapshot_id",
  "checkout_sessions" cs
WHERE o."id" = m."opportunity_id"
  AND cs."id" = m."checkout_session_id";

-- Anything the join could not reach — an order whose opportunity was
-- already gone — is stated as an absence rather than guessed at.
UPDATE "master_orders"
SET
  "product_name_ar_snapshot" = COALESCE("product_name_ar_snapshot", '—'),
  "product_name_en_snapshot" = COALESCE("product_name_en_snapshot", '—'),
  "unit_price_incl_tax_snapshot" = COALESCE("unit_price_incl_tax_snapshot", 0),
  "total_quantity_snapshot" = COALESCE("total_quantity_snapshot", 0)
WHERE "product_name_ar_snapshot" IS NULL
   OR "product_name_en_snapshot" IS NULL
   OR "unit_price_incl_tax_snapshot" IS NULL
   OR "total_quantity_snapshot" IS NULL;

ALTER TABLE "master_orders" ENABLE TRIGGER "trg_prevent_master_order_mutation";

COMMIT;

ALTER TABLE "master_orders"
  ALTER COLUMN "product_name_ar_snapshot" SET NOT NULL,
  ALTER COLUMN "product_name_en_snapshot" SET NOT NULL,
  ALTER COLUMN "unit_price_incl_tax_snapshot" SET NOT NULL,
  ALTER COLUMN "total_quantity_snapshot" SET NOT NULL;

-- The two unit names stay nullable: a listing may name no selling unit,
-- and an empty string would claim it named one.
