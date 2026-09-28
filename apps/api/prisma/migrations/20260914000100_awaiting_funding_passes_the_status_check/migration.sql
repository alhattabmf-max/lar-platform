-- AWAITING_FUNDING WAS NEVER TAUGHT TO THE CHECK CONSTRAINT.
--
-- `20260902080000_fulfilment_waits_for_funding` made the group-buy
-- promise real — «لا يتم شحن البضاعة إلا بعد ما يتم العرض شروطه ووصوله
-- لهدفه» — by adding an `AWAITING_FUNDING` value to the enum and having
-- the payment webhook create every allocation in it:
--
--   status: "AWAITING_FUNDING",
--   preparationDueAt: null,
--
-- It taught the mutation TRIGGER the new transition
-- (AWAITING_FUNDING -> AWAITING_PREPARATION, filling the due date), and
-- it made `preparation_due_at` nullable. What it did not touch is
-- `order_allocations_status_timestamp_consistency`, a CHECK constraint
-- that ENUMERATES the legal statuses one by one:
--
--   (status='AWAITING_PREPARATION' AND ...) OR (status='PREPARING' AND ...)
--   OR (status='READY_TO_SHIP' AND ...) OR (status='SHIPPED' AND ...)
--   OR (status='DELIVERED' AND ...)
--
-- A row whose status matches none of the five satisfies none of the
-- branches, so the CHECK is false and the INSERT is refused.
--
-- THE CONSEQUENCE: the first successful payment on ANY group offer
-- fails inside the webhook's own transaction with a check-constraint
-- violation. The funding gate that migration delivered has never been
-- able to run.
--
-- PROVEN BEFORE WRITING THIS, by evaluating the deployed constraint's
-- own expression against the exact row the webhook creates — status
-- AWAITING_FUNDING with all four timestamps still NULL:
--
--   CHECK passes for AWAITING_FUNDING row?  false
--
-- WHY NO TEST CAUGHT IT. `fulfilment-waits-for-funding.spec.ts` is a
-- unit spec over a mocked Prisma client, which has no constraints to
-- violate. The integration spec that WOULD have caught it —
-- `payment-webhook-success.integration-spec.ts` — already asserts
-- exactly this status, but the integration suite is not part of
-- `pnpm test` and had a second, unrelated fixture fault of its own.
--
-- THE FIX IS ONE BRANCH, AT THE FRONT.
--
-- The constraint must be dropped and recreated: Postgres has no
-- "alter check constraint". The other five branches are reproduced
-- VERBATIM from `20260821000300_replace_order_allocation_mutation_trigger`
-- — this migration adds a case, it does not restate or revise the ones
-- that were already right.
--
-- AND THE NEW BRANCH ASSERTS THE DUE DATE IS EMPTY, which is the whole
-- meaning the funding migration gave the column: NULL is "not yet
-- permitted". A row claiming to await funding while already carrying a
-- preparation deadline would be a contradiction the table should not be
-- able to hold, and the trigger only guards UPDATEs — an INSERT reaches
-- it never.
--
-- EXISTING ROWS ARE UNAFFECTED. The added branch only widens what is
-- accepted; every row that satisfied the old constraint satisfies this
-- one, so the recreation validates without touching data.

ALTER TABLE "order_allocations"
  DROP CONSTRAINT "order_allocations_status_timestamp_consistency";

ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_status_timestamp_consistency"
  CHECK (
    ("status" = 'AWAITING_FUNDING' AND "preparation_due_at" IS NULL AND "preparation_started_at" IS NULL AND "ready_to_ship_at" IS NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
    OR ("status" = 'AWAITING_PREPARATION' AND "preparation_started_at" IS NULL AND "ready_to_ship_at" IS NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
    OR ("status" = 'PREPARING' AND "preparation_started_at" IS NOT NULL AND "ready_to_ship_at" IS NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
    OR ("status" = 'READY_TO_SHIP' AND "preparation_started_at" IS NOT NULL AND "ready_to_ship_at" IS NOT NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
    OR ("status" = 'SHIPPED' AND "preparation_started_at" IS NOT NULL AND "ready_to_ship_at" IS NOT NULL AND "shipped_at" IS NOT NULL AND "delivered_at" IS NULL)
    OR ("status" = 'DELIVERED' AND "preparation_started_at" IS NOT NULL AND "ready_to_ship_at" IS NOT NULL AND "shipped_at" IS NOT NULL AND "delivered_at" IS NOT NULL)
  );
