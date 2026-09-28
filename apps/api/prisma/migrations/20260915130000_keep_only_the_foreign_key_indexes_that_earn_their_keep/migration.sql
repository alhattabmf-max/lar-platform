-- TWELVE OF THE SEVENTEEN INDEXES DID NOT EARN THEIR KEEP.
--
-- `20260915120000_index_every_foreign_key` indexed every single-column
-- foreign key whose child side had no index. That was a rule, not a
-- decision — «Postgres scans the child on every parent delete» is true
-- of all seventeen, and it stops being a reason the moment you ask how
-- OFTEN the parent is deleted and whether anything ever reads the
-- column.
--
-- An index is not free. Every one of these is maintained on every
-- insert and update of a table on the money path, and several of these
-- tables are written on every payment. Paying that to make an
-- administrative action nobody performs monthly finish a tenth of a
-- second sooner is the wrong trade.
--
-- ── HOW EACH WAS JUDGED ─────────────────────────────────────────────
--
-- Three questions, in this order:
--
--   1. Does the APPLICATION read the child by this column — a lookup or
--      a join in real code, not a projection?
--   2. Is the parent ever DELETED by a real product flow, and how many
--      parent rows go per invocation?
--   3. What does the check cost, measured?
--
-- Question 3 alone never decided anything: measured on child tables
-- grown to 100,000 rows, EVERY one of the seventeen turned an 11–30 ms
-- sequential scan into a 0.06–0.11 ms index lookup. The number is the
-- same shape for all of them. What differs is how often it is paid.
--
-- ON UPDATE CASCADE is on every one of these and is not a reason for
-- any of them: the parent keys are UUID primary keys, and nothing in
-- this system updates one.
--
-- ── WHAT IS KEPT, AND WHY ───────────────────────────────────────────
--
-- `policy_acceptances.user_id` — READ on EVERY payment start, to find
-- the buyer's latest mandatory-policy acceptance
-- (payment-attempt.service.ts). 16.0 ms sequential scan against an
-- index scan; and the scan grows with the table while the buyer's own
-- acceptance count does not.
--
-- `checkout_location_allocations.checkout_session_id` — READ on EVERY
-- checkout view and inside EVERY payment-success transaction, to get
-- the session's branch split (checkout-session.view.ts,
-- payment-webhook.service.ts). 18.2 ms → 0.30 ms.
--
-- `opportunities.product_approval_snapshot_id` — SET NULL, fired on
-- EVERY product deletion, once per approval snapshot the product has
-- (removal.ts `deleteProductTx`). 322 ms → 0.78 ms per snapshot, the
-- widest gap of the seventeen because `opportunities` is a wide table.
-- Corroborated end to end: this is the index whose absence made a
-- delete batch sit at 46 SECONDS while the measurement data was being
-- stepped down.
--
-- `quote_snapshots.product_approval_snapshot_id` and
-- `product_reports.reported_product_approval_snapshot_id` — RESTRICT,
-- fired on that SAME per-product-deletion path, once per snapshot.
-- 12.0 ms and 11.4 ms each. Both child tables grow with platform
-- volume — one row per checkout, one per report — so both numbers grow
-- while the operation stays routine.
--
-- ── WHAT IS DROPPED, AND WHY ────────────────────────────────────────
--
-- SIX have no parent deletion at all. Nothing in this codebase deletes
-- a sales unit, a shipping tariff policy version, an order allocation,
-- an invoice document, a dispute, or an admin user — the first four are
-- append-only records, and the last two are closed rather than removed.
-- No delete, no read, no index.
DROP INDEX IF EXISTS "products_sales_unit_id_idx";
DROP INDEX IF EXISTS "quote_snapshots_shipping_tariff_policy_version_id_idx";
DROP INDEX IF EXISTS "replacement_obligations_original_order_allocation_id_idx";
DROP INDEX IF EXISTS "invoice_documents_related_invoice_document_id_idx";
DROP INDEX IF EXISTS "evidence_uploads_used_in_dispute_id_idx";
DROP INDEX IF EXISTS "follow_up_assignments_updated_by_idx";

-- SIX more are checked only when a company is permanently removed —
-- the one administrative action that deletes users, branches and bank
-- accounts — and the counts there are units, not thousands: a company
-- has a handful of users, a handful of branches, one to three bank
-- accounts. Measured per check, the whole of it adds well under a
-- second to a transaction nobody runs monthly. None of these columns is
-- read by the application.
--
-- `payment_attempts` and `master_orders` in particular are WRITTEN on
-- every payment. An index there is a cost paid by the money path to
-- speed up an admin screen.
DROP INDEX IF EXISTS "opportunities_fulfillment_location_id_idx";
DROP INDEX IF EXISTS "checkout_location_allocations_company_location_id_idx";
DROP INDEX IF EXISTS "payment_attempts_accepted_by_user_id_idx";
DROP INDEX IF EXISTS "payment_attempts_policy_acceptance_id_idx";
DROP INDEX IF EXISTS "master_orders_supplier_bank_account_id_idx";
DROP INDEX IF EXISTS "supplier_payouts_supplier_bank_account_id_idx";

-- The five named above are deliberately NOT dropped here. They stay in
-- `schema.prisma`; these twelve are removed from it in the same change.
