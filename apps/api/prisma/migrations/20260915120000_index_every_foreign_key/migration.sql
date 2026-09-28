-- SEVENTEEN FOREIGN KEYS WITH NOTHING TO LOOK THEM UP BY.
--
-- Postgres indexes the PARENT side of a foreign key automatically —
-- it must, because the key points at a primary key. It indexes the
-- CHILD side never. So every delete or update of a parent row makes
-- the database scan the whole child table to find out whether anything
-- still points at it, and every «show me this order's rows» does the
-- same.
--
-- HOW THIS WAS FOUND, which is the part worth recording. It was not
-- found by reading the schema. It was found while stepping a 70,000
-- company measurement dataset back down: a batch that deleted product
-- approval snapshots sat at 46 SECONDS, because
-- `opportunities.product_approval_snapshot_id` carries
-- `ON DELETE SET NULL` and had no index, so each snapshot removed
-- scanned 42,000 opportunities. The index below took it to under a
-- second.
--
-- The same shape was then true of sixteen more, found with the
-- catalogue query for single-column foreign keys whose child column is
-- not the leading column of any index.
--
-- ── the ones that are read, not just enforced ───────────────────────
--
-- `checkout_location_allocations.checkout_session_id` is the worst of
-- them and it is not a delete path at all: it is how a checkout's
-- branch split is READ, on the money path, and it scanned every
-- allocation ever written to find one checkout's handful.
CREATE INDEX IF NOT EXISTS "checkout_location_allocations_checkout_session_id_idx"
  ON "checkout_location_allocations" ("checkout_session_id");
CREATE INDEX IF NOT EXISTS "checkout_location_allocations_company_location_id_idx"
  ON "checkout_location_allocations" ("company_location_id");

-- ── the snapshot fan-in, which is what was measured ─────────────────
CREATE INDEX IF NOT EXISTS "opportunities_product_approval_snapshot_id_idx"
  ON "opportunities" ("product_approval_snapshot_id");
CREATE INDEX IF NOT EXISTS "product_reports_reported_snapshot_id_idx"
  ON "product_reports" ("reported_product_approval_snapshot_id");
CREATE INDEX IF NOT EXISTS "quote_snapshots_product_approval_snapshot_id_idx"
  ON "quote_snapshots" ("product_approval_snapshot_id");

-- ── the rest, in the order the catalogue listed them ────────────────
CREATE INDEX IF NOT EXISTS "policy_acceptances_user_id_idx"
  ON "policy_acceptances" ("user_id");
CREATE INDEX IF NOT EXISTS "products_sales_unit_id_idx"
  ON "products" ("sales_unit_id");
CREATE INDEX IF NOT EXISTS "opportunities_fulfillment_location_id_idx"
  ON "opportunities" ("fulfillment_location_id");
CREATE INDEX IF NOT EXISTS "quote_snapshots_shipping_tariff_policy_version_id_idx"
  ON "quote_snapshots" ("shipping_tariff_policy_version_id");
CREATE INDEX IF NOT EXISTS "payment_attempts_accepted_by_user_id_idx"
  ON "payment_attempts" ("accepted_by_user_id");
CREATE INDEX IF NOT EXISTS "payment_attempts_policy_acceptance_id_idx"
  ON "payment_attempts" ("policy_acceptance_id");
CREATE INDEX IF NOT EXISTS "master_orders_supplier_bank_account_id_idx"
  ON "master_orders" ("supplier_bank_account_id");
CREATE INDEX IF NOT EXISTS "replacement_obligations_original_order_allocation_id_idx"
  ON "replacement_obligations" ("original_order_allocation_id");
CREATE INDEX IF NOT EXISTS "supplier_payouts_supplier_bank_account_id_idx"
  ON "supplier_payouts" ("supplier_bank_account_id");
CREATE INDEX IF NOT EXISTS "invoice_documents_related_invoice_document_id_idx"
  ON "invoice_documents" ("related_invoice_document_id");
CREATE INDEX IF NOT EXISTS "evidence_uploads_used_in_dispute_id_idx"
  ON "evidence_uploads" ("used_in_dispute_id");
CREATE INDEX IF NOT EXISTS "follow_up_assignments_updated_by_idx"
  ON "follow_up_assignments" ("updated_by");
