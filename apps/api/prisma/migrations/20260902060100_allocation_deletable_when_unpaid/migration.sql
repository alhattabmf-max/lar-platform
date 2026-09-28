-- A CHECKOUT IS PROTECTED BECAUSE AN ORDER WAS BUILT ON IT — not
-- because a page was once opened.
--
-- «الميتة أريد أن أقدر أحذفها.»
--
-- THREE GUARDS STAND IN THE WAY OF A DEAD SESSION, and they are here
-- together because they are one decision, not three. Splitting them
-- across migrations would leave a state in which a delete gets past the
-- first and is refused by the second.
--
--   1. the allocation's own immutability
--   2. the quote snapshot's immutability
--   3. the deferred check that allocations sum to the session's lock
--
-- WHAT THESE ROWS ARE. An allocation is the quantity a buyer reserved
-- at one branch; a quote snapshot is the price and shipping that were
-- quoted for it. When the session is PAID both become part of the
-- order — what was bought, from where, at what price — and the invoice
-- and the ledger are built on them. Those can never go.
--
-- WHAT AN ABANDONED ONE IS: a page somebody opened and walked away
-- from. No money, no invoice, no ledger entry, nothing downstream. On
-- this database 11 of 12 sit under sessions with no order at all.
--
-- THE COST, NAMED RATHER THAN GLOSSED: these rows are also the trace
-- of abandoned attempts, and that trace has a use the accounts do not
-- — somebody who reserves a supplier's stock repeatedly and never pays
-- blocks it for free, and this is the evidence. So deleting them is
-- deliberately NOT an operation of its own: no screen offers "clear the
-- sessions". They go only when the product they point at goes, which
-- an administrator does for a reason the audit log records.
--
-- UPDATE STAYS FORBIDDEN, UNCONDITIONALLY, in both. Removing a row
-- nothing was built on erases nothing; CHANGING one rewrites what a
-- buyer reserved or what they were quoted.

-- 1 ── the allocation itself
CREATE OR REPLACE FUNCTION prevent_checkout_location_allocation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM "master_orders" m
      WHERE m."checkout_session_id" = OLD."checkout_session_id"
    ) THEN
      RAISE EXCEPTION
        'checkout_location_allocations: cannot delete an allocation an order was built on (id=%)',
        OLD."id";
    END IF;
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'checkout_location_allocations: rows are append-only and cannot be modified (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

-- 2 ── the quote that was shown beside it
CREATE OR REPLACE FUNCTION prevent_quote_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM "master_orders" m
      WHERE m."checkout_session_id" = OLD."checkout_session_id"
    ) THEN
      RAISE EXCEPTION
        'quote_snapshots: cannot delete a quote an order was built on (id=%)',
        OLD."id";
    END IF;
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'quote_snapshots: rows are append-only and cannot be modified (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

-- 3 ── and the sum check stops asking a question with no subject
--
-- IT IS DEFERRED TO COMMIT, so by the time it runs the session may be
-- gone with its allocations. The invariant it enforces is "these
-- allocations add up to THEIR session's locked quantity"; with no
-- session there are no allocations left to be consistent with, and the
-- old body answered that by raising 'no checkout_sessions row found'.
--
-- IT STILL FIRES WITH FULL FORCE while the session exists — which is
-- every path that inserts or edits an allocation. Only the case where
-- the whole checkout has been removed returns early, and a partial
-- delete that leaves the session behind is still refused, loudly,
-- because then the sum genuinely stops matching.
CREATE OR REPLACE FUNCTION check_checkout_allocation_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_session_id UUID;
  v_quantity_sum INT;
  v_shipping_sum DECIMAL(12,2);
  v_locked_quantity INT;
  v_total_shipping DECIMAL(12,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_session_id := OLD.checkout_session_id;
  ELSE
    v_session_id := NEW.checkout_session_id;
  END IF;

  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM checkout_sessions WHERE id = v_session_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(shipping_fee_amount), 0)
    INTO v_quantity_sum, v_shipping_sum
    FROM checkout_location_allocations WHERE checkout_session_id = v_session_id;

  SELECT locked_quantity INTO v_locked_quantity FROM checkout_sessions WHERE id = v_session_id;
  IF v_locked_quantity IS NULL THEN
    RAISE EXCEPTION 'checkout_location_allocations: no checkout_sessions row found for %', v_session_id;
  END IF;

  IF v_quantity_sum != v_locked_quantity THEN
    RAISE EXCEPTION 'checkout_location_allocations: sum(quantity)=% does not match checkout_sessions.locked_quantity=% for session %',
      v_quantity_sum, v_locked_quantity, v_session_id;
  END IF;

  SELECT total_shipping_fee_amount INTO v_total_shipping FROM quote_snapshots WHERE checkout_session_id = v_session_id;
  IF v_total_shipping IS NULL THEN
    RAISE EXCEPTION 'checkout_location_allocations: no quote_snapshots row found for session %', v_session_id;
  END IF;

  IF v_shipping_sum != v_total_shipping THEN
    RAISE EXCEPTION 'checkout_location_allocations: sum(shipping_fee_amount)=% does not match quote_snapshots.total_shipping_fee_amount=% for session %',
      v_shipping_sum, v_total_shipping, v_session_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
