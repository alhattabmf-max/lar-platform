-- A SNAPSHOT IS PROTECTED BECAUSE AN OFFER READS IT — not because it
-- exists.
--
-- «أنت تحمي منتجًا معتمدًا وليس عليه أي حركة، لذلك هذا عيب، أصلح.»
--
-- WHAT THE ORIGINAL RULE SAID, and why it was written that way: every
-- snapshot is the frozen record of exactly what an administrator
-- approved, and every published offer carries
-- `product_approval_snapshot_id` — so erasing one leaves an offer that
-- cannot say what was sold. Phase 4 concluded there was "no legitimate
-- application code path that ever updates or deletes one" and refused
-- unconditionally.
--
-- WHAT CHANGED IS THAT THERE IS ONE NOW. The console can delete a
-- product outright, and a product approved but never published has a
-- snapshot NO OFFER POINTS AT. Measured on this database: 16 of 30
-- snapshots are referenced by nothing at all. Refusing those protects
-- a record nobody can reach through any screen or route.
--
-- SO THE GUARD ASKS THE QUESTION INSTEAD OF ASSUMING THE ANSWER.
-- Referenced: refused, and the message now says WHY rather than
-- restating the rule. Unreferenced: allowed.
--
-- UPDATE STAYS FORBIDDEN, UNCONDITIONALLY. Deleting an unread row
-- removes nothing anybody could have read; CHANGING a row rewrites
-- what an administrator approved, and that is a different act with no
-- honest case behind it.
--
-- AND THE CHECK IS INSIDE THE TRIGGER, not in the service. A caller
-- that skips the console and issues the DELETE itself meets the same
-- answer — which is the whole reason this lives in the database.
CREATE OR REPLACE FUNCTION prevent_product_approval_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM "opportunities" o
      WHERE o."product_approval_snapshot_id" = OLD."id"
    ) THEN
      RAISE EXCEPTION
        'product_approval_snapshots: cannot delete a snapshot a published offer reads (id=%)',
        OLD."id";
    END IF;
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE'
  RAISE EXCEPTION 'product_approval_snapshots: rows are append-only and cannot be modified (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
