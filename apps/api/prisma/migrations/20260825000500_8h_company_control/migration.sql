-- Two columns, for two approved decisions. Nothing else.
--
-- =====================================================================
-- 1. A user may exist before they have a password.
-- =====================================================================
--
-- Importing a company from a spreadsheet creates its owner, and creating
-- a password for them is not something an operator may do: a default
-- password is a credential somebody else knows, and mailing one is a
-- credential in a mailbox forever. The invited person sets their own
-- through the reset flow that already exists.
--
-- NULL therefore means exactly one thing — "this account has not been
-- claimed yet" — and login refuses it explicitly rather than comparing
-- against nothing. The alternative considered and rejected was storing
-- a hash of a random secret: it makes an unclaimed account
-- indistinguishable from a real one in the data, which is the opposite
-- of what an auditor needs to see.
--
-- Nothing is back-filled. Every existing row has a hash and keeps it.

ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- =====================================================================
-- 2. Where a suspended user came from.
-- =====================================================================
--
-- Suspending a company suspends its people. Lifting it must NOT simply
-- set everyone to ACTIVE: a user who was already suspended for a reason
-- of their own, or disabled, would be silently reinstated by an
-- unrelated act.
--
-- So the status to return to is STORED, not inferred. NULL means this
-- user's status has nothing to do with the company — they are left
-- exactly as they are. A value means the company's suspension moved
-- them, and lifting it puts them back to that value and clears this.
--
-- The audit trail records what happened, but it is a log: reconstructing
-- current state by replaying it is a different kind of claim from
-- reading a column, and gets harder every time the rules change.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "status_before_company_suspension" "UserStatus";

-- =====================================================================
-- WHAT IS DELIBERATELY NOT HERE
-- =====================================================================
--
-- No change to `audit_logs`. It was suspected of making a company
-- undeletable, and it does not: `audit_logs.company_id` is a plain
-- nullable UUID with NO foreign key at all — verified against
-- pg_constraint, which reports zero constraints of type 'f' on that
-- table. A company can be removed while every line written about it
-- stays exactly where it is, which is the outcome wanted: the record of
-- who removed it, when and why survives the thing it describes.
--
-- No new enum member. `CompanyVerificationStatus.SUSPENDED` already
-- exists.
--
-- No spare columns for later, no data deleted, no table rewritten.
