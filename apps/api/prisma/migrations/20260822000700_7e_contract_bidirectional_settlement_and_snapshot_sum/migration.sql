-- -------------------------------------------------------------------
-- Bidirectional settlement guard (the OTHER direction): a
-- SupplierPayout row existing implies order_allocations.payout_settled_at
-- IS NOT NULL for that same allocation. Registered for INSERT OR
-- UPDATE OR DELETE on supplier_payouts for defense-in-depth, even
-- though supplier_payouts already has its own separate immutability
-- trigger (prevent_supplier_payout_mutation) blocking UPDATE/DELETE
-- outright — this constraint trigger stays correct independently of
-- that other trigger ever changing.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_supplier_payout_has_payout_settled()
RETURNS TRIGGER AS $$
DECLARE
  v_order_allocation_id UUID;
  v_payout_settled_at TIMESTAMPTZ;
  v_payout_count INT;
BEGIN
  -- On DELETE, OLD is what we must check no longer needs backing;
  -- on INSERT/UPDATE, NEW is the row whose allocation must already
  -- (or still) point back to exactly this payout.
  IF TG_OP = 'DELETE' THEN
    v_order_allocation_id := OLD."order_allocation_id";
  ELSE
    v_order_allocation_id := NEW."order_allocation_id";
  END IF;

  SELECT "payout_settled_at" INTO v_payout_settled_at FROM "order_allocations" WHERE "id" = v_order_allocation_id;
  SELECT COUNT(*) INTO v_payout_count FROM "supplier_payouts" WHERE "order_allocation_id" = v_order_allocation_id;

  IF v_payout_count = 1 AND v_payout_settled_at IS NULL THEN
    RAISE EXCEPTION 'supplier_payouts: a settlement row exists for order_allocation_id=% but payout_settled_at is not set', v_order_allocation_id;
  END IF;
  IF v_payout_count = 0 AND v_payout_settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'supplier_payouts: order_allocation_id=% has payout_settled_at set but no matching settlement row exists', v_order_allocation_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_supplier_payout_has_payout_settled
  AFTER INSERT OR UPDATE OR DELETE ON "supplier_payouts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_supplier_payout_has_payout_settled();

-- -------------------------------------------------------------------
-- Snapshot-sum consistency: once EVERY OrderAllocation belonging to a
-- MasterOrder has a financial snapshot, their sums must match the
-- frozen MasterOrder totals AND the frozen QuoteSnapshot product
-- total, to the cent. Deferred — invoked via
-- SET CONSTRAINTS ... IMMEDIATE at the end of whichever transaction
-- inserted the snapshots (the live payment-success path, or the
-- standalone Backfill Command, both of which insert every sibling
-- allocation's snapshot within one transaction).
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_financial_snapshot_sums_match_source()
RETURNS TRIGGER AS $$
DECLARE
  v_master_order_id UUID;
  v_allocation_count INT;
  v_snapshot_count INT;
  v_commission_sum DECIMAL(14,2);
  v_commission_tax_sum DECIMAL(14,2);
  v_supplier_payable_sum DECIMAL(14,2);
  v_product_sum DECIMAL(14,2);
  v_commission_amount DECIMAL(14,2);
  v_commission_tax_amount DECIMAL(14,2);
  v_supplier_payable_amount DECIMAL(14,2);
  v_checkout_session_id UUID;
  v_quote_products_subtotal_incl_tax DECIMAL(14,2);
BEGIN
  SELECT "master_order_id" INTO v_master_order_id FROM "order_allocations" WHERE "id" = NEW."order_allocation_id";

  SELECT COUNT(*) INTO v_allocation_count FROM "order_allocations" WHERE "master_order_id" = v_master_order_id;
  SELECT COUNT(*) INTO v_snapshot_count
    FROM "order_allocation_financial_snapshots" oafs
    JOIN "order_allocations" oa ON oa."id" = oafs."order_allocation_id"
    WHERE oa."master_order_id" = v_master_order_id;

  -- Only enforced once every sibling allocation has a snapshot — this
  -- transaction must insert them ALL together (the atomic-per-MasterOrder
  -- rule), so by the time this deferred check fires the counts must match.
  IF v_snapshot_count != v_allocation_count THEN
    RAISE EXCEPTION 'order_allocation_financial_snapshots: master_order_id=% has % allocations but % snapshots — all sibling allocations must receive a snapshot within the same transaction', v_master_order_id, v_allocation_count, v_snapshot_count;
  END IF;

  SELECT SUM(oafs."commission_share_amount"), SUM(oafs."commission_share_tax_amount"), SUM(oafs."supplier_payable_share_amount"), SUM(oafs."product_amount_incl_tax")
    INTO v_commission_sum, v_commission_tax_sum, v_supplier_payable_sum, v_product_sum
    FROM "order_allocation_financial_snapshots" oafs
    JOIN "order_allocations" oa ON oa."id" = oafs."order_allocation_id"
    WHERE oa."master_order_id" = v_master_order_id;

  SELECT "commission_amount", "commission_tax_amount", "supplier_payable_amount", "checkout_session_id"
    INTO v_commission_amount, v_commission_tax_amount, v_supplier_payable_amount, v_checkout_session_id
    FROM "master_orders" WHERE "id" = v_master_order_id;

  IF v_commission_sum != v_commission_amount THEN
    RAISE EXCEPTION 'order_allocation_financial_snapshots: commission sum (%) does not match master_orders.commission_amount (%) for master_order_id=%', v_commission_sum, v_commission_amount, v_master_order_id;
  END IF;
  IF v_commission_tax_sum != v_commission_tax_amount THEN
    RAISE EXCEPTION 'order_allocation_financial_snapshots: commission tax sum (%) does not match master_orders.commission_tax_amount (%) for master_order_id=%', v_commission_tax_sum, v_commission_tax_amount, v_master_order_id;
  END IF;
  IF v_supplier_payable_sum != v_supplier_payable_amount THEN
    RAISE EXCEPTION 'order_allocation_financial_snapshots: supplier payable sum (%) does not match master_orders.supplier_payable_amount (%) for master_order_id=%', v_supplier_payable_sum, v_supplier_payable_amount, v_master_order_id;
  END IF;

  SELECT "products_subtotal_incl_tax_amount" INTO v_quote_products_subtotal_incl_tax
    FROM "quote_snapshots" WHERE "checkout_session_id" = v_checkout_session_id;

  IF v_quote_products_subtotal_incl_tax IS NOT NULL AND v_product_sum != v_quote_products_subtotal_incl_tax THEN
    RAISE EXCEPTION 'order_allocation_financial_snapshots: product amount sum (%) does not match quote_snapshots.products_subtotal_incl_tax_amount (%) for master_order_id=%', v_product_sum, v_quote_products_subtotal_incl_tax, v_master_order_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_financial_snapshot_sums_match_source
  AFTER INSERT ON "order_allocation_financial_snapshots"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_financial_snapshot_sums_match_source();
