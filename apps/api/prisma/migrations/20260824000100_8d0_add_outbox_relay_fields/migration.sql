-- Phase 8D0 — outbox relay fields.
--
-- Adds the in-flight state, the lease, the backoff deferral and the
-- failure classification the relay needs.
--
-- NO DATA BACKFILL AND NO COLUMN REWRITE: every new column is nullable
-- with no default, so adding them does not rewrite existing row data,
-- and each pre-existing event keeps its exact values with all new
-- columns NULL.
--
-- Note this is NOT a wholly metadata-only migration. Adding the CHECK
-- constraint at the end may require PostgreSQL to scan the table to
-- validate existing rows, holding a lock for the duration. On a large
-- outbox_events table that scan is the part worth planning a
-- maintenance window around — not the ADD COLUMNs.
--
-- There is deliberately NO backfill and NO UPDATE. Historical events
-- were written as an intent ledger, not as email commands; they are
-- excluded from the relay by a positive event-type allowlist in code,
-- not by a status change here.

-- The in-flight state. Without it there is no way to tell "not started"
-- from "running", which makes crash recovery impossible.
ALTER TYPE "OutboxStatus" ADD VALUE 'PROCESSING';

ALTER TABLE "outbox_events"
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "locked_at"       TIMESTAMPTZ(3),
  ADD COLUMN "locked_until"    TIMESTAMPTZ(3),
  ADD COLUMN "locked_by"       TEXT,
  ADD COLUMN "claim_token"     UUID,
  ADD COLUMN "error_class"     TEXT,
  ADD COLUMN "failed_at"       TIMESTAMPTZ(3);

-- Serves the claim predicate. Filtering on "status" alone forces an
-- ever-growing scan, because the legacy event types stay PENDING for
-- ever by design and would otherwise be re-examined on every pass.
CREATE INDEX "outbox_events_claim_idx"
  ON "outbox_events" ("event_type", "status", "next_attempt_at", "locked_until");

-- Dead-letter inspection. Partial, because FAILED is a small minority of
-- the table and a full index would cost write amplification on every
-- ordinary insert for no read benefit.
CREATE INDEX "outbox_events_failed_idx"
  ON "outbox_events" ("status", "failed_at") WHERE "status" = 'FAILED';

-- The lease is all-or-nothing.
--
-- A row is either not leased (all four lease columns NULL) or fully
-- leased (all four set). A half-written lease — a claim token with no
-- expiry, an expiry with no owner — would leave a row that no worker
-- can safely reclaim and that no reader can reason about, so the
-- database refuses to hold that state at all.
--
-- WHY THE PREDICATE IS WRITTEN BY EXCLUSION, not as
-- `status = 'PROCESSING'`:
--
-- PostgreSQL forbids USING a newly added enum label in the same
-- transaction that added it ("unsafe use of new value of enum type").
-- 'PROCESSING' is added by the ALTER TYPE above, in this very
-- transaction, so naming it here would fail. Listing only the
-- PRE-EXISTING labels and negating them expresses the identical rule
-- while referencing no new label — and needs no ::text cast, whose
-- immutability inside a CHECK would be a second thing to prove.
--
-- Consequence to keep in mind: a FUTURE status added to OutboxStatus
-- would fall into the second branch and be wrongly required to carry a
-- lease. An enum-cardinality unit test asserts OutboxStatus is exactly
-- {PENDING, PROCESSING, PUBLISHED, FAILED} so that adding a value fails
-- the build and forces this constraint to be revisited.
--
-- Historical rows are PENDING/PUBLISHED/FAILED with all four new
-- columns NULL, so they satisfy the first branch and this constraint
-- validates without touching them.
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_lease_all_or_none" CHECK (
    (
      "status" IN ('PENDING','PUBLISHED','FAILED')
      AND "claim_token"  IS NULL
      AND "locked_at"    IS NULL
      AND "locked_until" IS NULL
      AND "locked_by"    IS NULL
    )
    OR
    (
      "status" NOT IN ('PENDING','PUBLISHED','FAILED')
      AND "claim_token"  IS NOT NULL
      AND "locked_at"    IS NOT NULL
      AND "locked_until" IS NOT NULL
      AND "locked_by"    IS NOT NULL
    )
  );
