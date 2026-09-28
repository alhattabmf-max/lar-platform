-- FULFILMENT WAITS FOR THE TARGET.
--
-- «المشترون يشترون حصصهم، إذا اكتمل الهدف يتم إرسال الطلبات للمورد… ولا
--  يتم شحن البضاعة إلا بعد ما يتم العرض شروطه ووصوله لهدفه.»
-- «العرض مثلاً سبعة أيام، اكتمل الهدف في ثلاثة أيام أو يوم — المهم أنه
--  اكتمل قبل نهاية العرض، خلاص يقفل تلقائي ويبدأ التجهيز من بداية إقفال
--  العرض.»
--
-- WHAT THE PLATFORM SAYS ABOUT ITSELF TODAY, in
-- `packages/domain/src/opportunity-transitions.ts`:
--
--   "targetQuantity is a supply CAP the supplier is willing to sell,
--    never a collective goal that must be reached before any order
--    proceeds — every paid order is created and sent for fulfillment
--    immediately, independent of how much of the cap is sold"
--
-- That is the opposite of what this platform is for. Its own promise to
-- a buyer is «حين يجتمع الطلب، يتغيّر معنى السعر» — a wholesale price
-- earned because others are buying too. Shipping the first buyer while
-- the offer sits at 20% hands out that price for a condition that never
-- happened, and makes a collective refund impossible ever after: what
-- has been delivered cannot be returned, and what has been paid out to
-- the supplier cannot be recalled.
--
-- THREE CHANGES, AND THEY ARE ONE DECISION.

-- 1 ── THE DUE DATE IS NOT KNOWN AT PAYMENT.
--
-- It was stamped `capturedAt + expectedPreparationDays` the moment a
-- buyer paid, which dated work nobody was allowed to start. Three
-- screens read it as overdue —
--   `status = 'AWAITING_PREPARATION' AND preparation_due_at < now()`
-- in the admin dashboard, the supplier dashboard and the late list — so
-- a supplier whose offer stood at 20% was already reported late.
--
-- NULL NOW MEANS "NOT YET PERMITTED", which is a fact the column could
-- not state before. Freezing it on an invented value and then forbidding
-- correction was the original mistake.
ALTER TABLE "order_allocations" ALTER COLUMN "preparation_due_at" DROP NOT NULL;

-- 2 ── A STATE FOR MONEY TAKEN AND WORK NOT YET OWED.
--
-- `AWAITING_PREPARATION` meant two different things: "paid, waiting for
-- the others" and "the target is in, the clock runs". They need
-- different answers from every screen, so they need different names.
--
-- BEFORE the existing first state, so the enum's own order still reads
-- as the journey: funding, preparation, ready, shipped, delivered.
ALTER TYPE "OrderAllocationStatus" ADD VALUE IF NOT EXISTS 'AWAITING_FUNDING' BEFORE 'AWAITING_PREPARATION';

-- 3 ── THE GUARD LEARNS ONE TRANSITION, AND ONLY ONE.
--
-- `prevent_order_allocation_mutation` lists every legal step by hand and
-- refuses everything else — which is why it refused this one. It named
-- `preparation_due_at` among the fields frozen from birth, so stamping
-- it at close was impossible; and it had no rule for a row arriving in
-- the world unfunded.
--
-- WHAT IS ADDED: `AWAITING_FUNDING -> AWAITING_PREPARATION`, permitted
-- only while the due date is still NULL and only if nothing else on the
-- row moves with it. WHAT IS UNCHANGED: every other transition, the
-- delete refusal, and the freeze on a due date once written.
CREATE OR REPLACE FUNCTION public.prevent_order_allocation_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_allocations: rows cannot be deleted (id=%)', OLD."id";
  END IF;

  -- THE DUE DATE IS FROZEN ONCE IT IS SET, NOT FROM BIRTH.
  --
  -- It used to be listed here unconditionally, which was right while it
  -- was stamped at payment. It is not known then any more: the clock
  -- starts when the offer reaches its target, and until that moment the
  -- column is NULL and means "not yet permitted". Filling a NULL is the
  -- one write allowed; changing a filled one is refused exactly as
  -- before, so a date somebody has been working against can never move.
  IF NEW."master_order_id" IS DISTINCT FROM OLD."master_order_id"
     OR NEW."checkout_location_allocation_id" IS DISTINCT FROM OLD."checkout_location_allocation_id"
     OR NEW."expected_preparation_days" IS DISTINCT FROM OLD."expected_preparation_days"
     OR (OLD."preparation_due_at" IS NOT NULL
         AND NEW."preparation_due_at" IS DISTINCT FROM OLD."preparation_due_at")
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'order_allocations: frozen fields cannot be modified (id=%)', OLD."id";
  END IF;

  -- FUNDING CLOSED: the target came in, and this is the only moment the
  -- due date may be written.
  --
  -- «إذا اكتمل الهدف يتم إرسال الطلبات للمورد… ويبدأ التجهيز من بداية
  --  إقفال العرض.» Nothing else on the row may move with it — not a
  -- preparation start, not a shipment, not a payout — so this cannot be
  -- used to skip a step.
  IF OLD."status" = 'AWAITING_FUNDING' AND NEW."status" = 'AWAITING_PREPARATION'
     AND OLD."preparation_due_at" IS NULL AND NEW."preparation_due_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at"
     AND NEW."dispute_window_closes_at" IS NOT DISTINCT FROM OLD."dispute_window_closes_at"
     AND NEW."payout_settled_at" IS NOT DISTINCT FROM OLD."payout_settled_at" THEN
    RETURN NEW;
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
$function$

