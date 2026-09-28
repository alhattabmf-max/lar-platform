-- Follow-up assignments: WHO is on a case, and whether they have started.
--
-- WHAT THIS TABLE IS NOT. It does not hold the case. Every case shown in
-- the follow-up centre is DERIVED from the record it is about — an open
-- dispute, a bank account awaiting review, an allocation past its
-- preparation deadline. That is what makes "a case does not close
-- because somebody opened it" a property of the system rather than a
-- rule somebody has to remember: there is no closed flag here to set.
-- A case disappears when, and only when, its cause is actually resolved
-- in its own table.
--
-- WHAT IT HOLDS is the two facts a derivation cannot produce: which
-- administrator owns the case, and whether it is being worked on.
--
-- NOTHING SENSITIVE. A kind and a reference, never an amount, never a
-- party's name, never the text of a dispute.

CREATE TYPE "FollowUpCaseKind" AS ENUM (
  'SETTLEMENT_OVERDUE',
  'PAYMENT_REPEATEDLY_FAILED',
  'DISPUTE_OPEN',
  'BANK_ACCOUNT_REVIEW',
  'SUPPLIER_VERIFICATION',
  'PRODUCT_REVIEW'
);

CREATE TABLE "follow_up_assignments" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A CLOSED SET, enforced by the database and not only by the contract.
  -- A kind the code does not know would render as a blank row nobody
  -- could act on.
  "case_kind"   "FollowUpCaseKind" NOT NULL,

  -- The identifier of the record the case is about, in its own table.
  -- Text rather than a foreign key because the six kinds point at six
  -- different tables; the derivation is what proves a case still exists.
  "case_ref"    TEXT NOT NULL,

  "assignee_id" UUID REFERENCES "admin_users"("id") ON DELETE SET NULL,
  "in_progress" BOOLEAN NOT NULL DEFAULT false,

  -- WHO TOUCHED IT LAST. Never null: an assignment with no author is a
  -- change nobody can be asked about.
  "updated_by"  UUID NOT NULL REFERENCES "admin_users"("id") ON DELETE RESTRICT,

  "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ(3) NOT NULL,

  -- ONE ROW PER CASE. Without this, two administrators opening the same
  -- case at once would each create their own, and the list would show
  -- one case twice with two different owners.
  CONSTRAINT "follow_up_assignments_case_key" UNIQUE ("case_kind", "case_ref")
);

-- The list filters by assignee and by "being worked on"; both are read
-- on every page of the follow-up centre.
CREATE INDEX "follow_up_assignments_assignee_idx"
  ON "follow_up_assignments" ("assignee_id");
CREATE INDEX "follow_up_assignments_in_progress_idx"
  ON "follow_up_assignments" ("in_progress");
