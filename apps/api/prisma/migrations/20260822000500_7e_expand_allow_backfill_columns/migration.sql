-- Replaces 7D's trigger function wholesale (same pattern as 7D's own
-- migration 20260821000300, which itself replaced 7C's). Adds exactly
-- ONE new allowed no-status-change mutation: filling
-- dispute_window_closes_at from NULL, needed by the standalone
-- Backfill Command for already-DELIVERED historical rows. It may also
-- be filled inline as part of the normal SHIPPED->DELIVERED
-- transition (the live-order path).
--
-- payout_settled_at is deliberately given NO standalone fill path
-- here — the Backfill never touches it. Filling it will only become
-- legal in the Contract migration, guarded by a deferred cross-table
-- constraint trigger requiring a matching SupplierPayout row to
-- already exist, so it can only ever happen from within a real
-- settlement transaction.
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

  -- The four original 7D transitions, now additionally requiring
  -- dispute_window_closes_at / payout_settled_at to stay unchanged
  -- UNLESS this update is exactly the DELIVERED transition (which may
  -- ALSO fill dispute_window_closes_at in the same statement — see the
  -- dedicated branch below).
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

  -- SHIPPED -> DELIVERED may ALSO fill dispute_window_closes_at from
  -- NULL in the same statement (the normal live-order path). It may
  -- also leave it unchanged (a Backfill scenario where this row was
  -- delivered before dispute_window_closes_at existed at all and gets
  -- filled separately below) — both are accepted here.
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

  -- Standalone: fill dispute_window_closes_at from NULL with NO status
  -- change at all — the Backfill path for already-DELIVERED historical
  -- rows. This is the ONLY standalone (no-status-change) mutation
  -- Release A permits. payout_settled_at is deliberately NOT allowed
  -- here — the Backfill never touches it, and filling it is only ever
  -- legal from within a real settlement transaction (SupplierPayout +
  -- Ledger + Audit/Outbox), guarded by a deferred cross-table
  -- constraint trigger added in the Contract migration.
  IF NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND OLD."dispute_window_closes_at" IS NULL AND NEW."dispute_window_closes_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at"
     AND NEW."payout_settled_at" IS NOT DISTINCT FROM OLD."payout_settled_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'order_allocations: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
END;
$$ LANGUAGE plpgsql;
