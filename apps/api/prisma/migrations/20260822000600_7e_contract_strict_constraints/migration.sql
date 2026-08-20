-- =========================================================================
-- Phase 7E — CONTRACT migration (Release B). Applied ONLY after the
-- Backfill Command has completed and the Verification Gate has passed
-- with zero failures. Never applied automatically alongside Release A.
-- =========================================================================

-- Strict invariant: a DELIVERED allocation must always carry a
-- dispute_window_closes_at from this point forward (both for legacy
-- rows, now backfilled, and for every future live order).
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_delivered_has_dispute_window"
  CHECK ("status" != 'DELIVERED' OR "dispute_window_closes_at" IS NOT NULL);

-- Final replacement of the OrderAllocation trigger: adds exactly ONE
-- new standalone (no-status-change) mutation — filling
-- payout_settled_at from NULL. This is guarded by a DEFERRED
-- cross-table constraint trigger below, requiring a matching
-- SupplierPayout row to exist — so in practice it can only ever
-- succeed as part of a real settlement transaction that also inserts
-- that SupplierPayout row and calls
-- SET CONSTRAINTS ... IMMEDIATE before committing.
CREATE OR REPLACE FUNCTION prevent_order_allocation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_allocations: rows cannot be deleted (id=%)', OLD."id";
  END IF;

  IF NEW."master_order_id" IS DISTINCT FROM OLD."master_order_id"
     OR NEW."checkout_location_allocation_id" IS DISTINCT FROM OLD."checkout_location_allocation_id"
     OR NEW."expected_preparation_days" IS DISTINCT FROM OLD."expected_preparation_days"
     OR NEW."preparation_due_at" IS DISTINCT FROM OLD."preparation_due_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'order_allocations: frozen fields cannot be modified (id=%)', OLD."id";
  END IF;

  IF OLD."status" = 'AWAITING_PREPARATION' AND NEW."status" = 'PREPARING'
     AND OLD."preparation_started_at" IS NULL AND NEW."preparation_started_at" IS NOT NULL
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at"
     AND NEW."dispute_window_closes_at" IS NOT DISTINCT FROM OLD."dispute_window_closes_at"
     AND NEW."payout_settled_at" IS NOT DISTINCT FROM OLD."payout_settled_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PREPARING' AND NEW."status" = 'READY_TO_SHIP'
     AND OLD."ready_to_ship_at" IS NULL AND NEW."ready_to_ship_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at"
     AND NEW."dispute_window_closes_at" IS NOT DISTINCT FROM OLD."dispute_window_closes_at"
     AND NEW."payout_settled_at" IS NOT DISTINCT FROM OLD."payout_settled_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'READY_TO_SHIP' AND NEW."status" = 'SHIPPED'
     AND OLD."shipped_at" IS NULL AND NEW."shipped_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at"
     AND NEW."dispute_window_closes_at" IS NOT DISTINCT FROM OLD."dispute_window_closes_at"
     AND NEW."payout_settled_at" IS NOT DISTINCT FROM OLD."payout_settled_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'SHIPPED' AND NEW."status" = 'DELIVERED'
     AND OLD."delivered_at" IS NULL AND NEW."delivered_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND (NEW."dispute_window_closes_at" IS NOT DISTINCT FROM OLD."dispute_window_closes_at"
          OR (OLD."dispute_window_closes_at" IS NULL AND NEW."dispute_window_closes_at" IS NOT NULL))
     AND NEW."payout_settled_at" IS NOT DISTINCT FROM OLD."payout_settled_at" THEN
    RETURN NEW;
  END IF;

  -- Standalone: fill dispute_window_closes_at from NULL, no status change.
  IF NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND OLD."dispute_window_closes_at" IS NULL AND NEW."dispute_window_closes_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at"
     AND NEW."payout_settled_at" IS NOT DISTINCT FROM OLD."payout_settled_at" THEN
    RETURN NEW;
  END IF;

  -- NEW in Contract: standalone fill of payout_settled_at from NULL,
  -- no status change. Guarded by a DEFERRED constraint trigger
  -- (below) requiring a matching SupplierPayout — never enforceable
  -- by this trigger alone since it cannot see other tables.
  IF NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND OLD."payout_settled_at" IS NULL AND NEW."payout_settled_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at"
     AND NEW."dispute_window_closes_at" IS NOT DISTINCT FROM OLD."dispute_window_closes_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'order_allocations: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
END;
$$ LANGUAGE plpgsql;

-- Deferred cross-table check: payout_settled_at may only be non-NULL
-- if exactly one matching SupplierPayout row exists.
CREATE OR REPLACE FUNCTION check_payout_settled_has_supplier_payout()
RETURNS TRIGGER AS $$
DECLARE
  v_id UUID; v_payout_settled_at TIMESTAMPTZ; v_count INT;
BEGIN
  v_id := NEW."id";
  SELECT "payout_settled_at" INTO v_payout_settled_at FROM "order_allocations" WHERE "id" = v_id;
  IF v_payout_settled_at IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM "supplier_payouts" WHERE "order_allocation_id" = v_id;
    IF v_count != 1 THEN
      RAISE EXCEPTION 'order_allocations: payout_settled_at requires exactly one supplier_payouts row, found % (id=%)', v_count, v_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_payout_settled_has_supplier_payout
  AFTER INSERT OR UPDATE ON "order_allocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_payout_settled_has_supplier_payout();

-- -------------------------------------------------------------------
-- Cross-table refund caps — DEFERRED constraint triggers on
-- refund_obligations, invoked via SET CONSTRAINTS ... IMMEDIATE
-- inside the refund-creation service before it returns success.
-- -------------------------------------------------------------------

-- Cap 1: sum of PENDING_EXECUTION/SENT/COMPLETED refund_obligations
-- for a given payment_attempt_id (across ALL sources combined) must
-- never exceed the amount actually captured on that PaymentAttempt.
CREATE OR REPLACE FUNCTION check_refund_obligation_payment_attempt_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_payment_attempt_id UUID;
  v_captured_amount DECIMAL(14,2);
  v_refunded_sum DECIMAL(14,2);
BEGIN
  v_payment_attempt_id := NEW."payment_attempt_id";
  SELECT "amount" INTO v_captured_amount FROM "payment_attempts" WHERE "id" = v_payment_attempt_id;
  SELECT COALESCE(SUM("amount"), 0) INTO v_refunded_sum
    FROM "refund_obligations"
    WHERE "payment_attempt_id" = v_payment_attempt_id
      AND "status" IN ('PENDING_EXECUTION', 'SENT', 'COMPLETED');
  IF v_refunded_sum > v_captured_amount THEN
    RAISE EXCEPTION 'refund_obligations: sum of active refunds (%) exceeds captured payment_attempt amount (%) for payment_attempt_id=%', v_refunded_sum, v_captured_amount, v_payment_attempt_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_refund_obligation_payment_attempt_cap
  AFTER INSERT OR UPDATE ON "refund_obligations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_refund_obligation_payment_attempt_cap();

-- Cap 2: sum of DISPUTE-source refund_obligations (active statuses)
-- linked (via dispute_decisions -> disputes -> order_allocations)
-- to a given OrderAllocation must never exceed that allocation's
-- refundable value from its OrderAllocationFinancialSnapshot
-- (product + shipping). PAYMENT_EXCEPTION rows are excluded entirely
-- from this cap.
CREATE OR REPLACE FUNCTION check_refund_obligation_allocation_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_order_allocation_id UUID;
  v_refundable_amount DECIMAL(14,2);
  v_refunded_sum DECIMAL(14,2);
BEGIN
  IF NEW."source" != 'DISPUTE' THEN
    RETURN NULL;
  END IF;

  SELECT d."order_allocation_id" INTO v_order_allocation_id
  FROM "dispute_decisions" dd
  JOIN "disputes" d ON d."id" = dd."dispute_id"
  WHERE dd."id" = NEW."dispute_decision_id";

  IF v_order_allocation_id IS NULL THEN
    RETURN NULL; -- structurally impossible given FK, but stay safe
  END IF;

  SELECT ("product_amount_incl_tax" + "shipping_fee_amount") INTO v_refundable_amount
  FROM "order_allocation_financial_snapshots"
  WHERE "order_allocation_id" = v_order_allocation_id;

  SELECT COALESCE(SUM(ro."amount"), 0) INTO v_refunded_sum
  FROM "refund_obligations" ro
  JOIN "dispute_decisions" dd2 ON dd2."id" = ro."dispute_decision_id"
  JOIN "disputes" d2 ON d2."id" = dd2."dispute_id"
  WHERE d2."order_allocation_id" = v_order_allocation_id
    AND ro."source" = 'DISPUTE'
    AND ro."status" IN ('PENDING_EXECUTION', 'SENT', 'COMPLETED');

  IF v_refunded_sum > v_refundable_amount THEN
    RAISE EXCEPTION 'refund_obligations: sum of active DISPUTE refunds (%) exceeds allocation refundable value (%) for order_allocation_id=%', v_refunded_sum, v_refundable_amount, v_order_allocation_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_refund_obligation_allocation_cap
  AFTER INSERT OR UPDATE ON "refund_obligations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_refund_obligation_allocation_cap();
