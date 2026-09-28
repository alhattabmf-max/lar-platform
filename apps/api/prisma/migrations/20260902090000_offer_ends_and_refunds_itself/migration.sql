-- AN OFFER THAT DOES NOT FILL GIVES THE MONEY BACK.
--
-- «في حالة لم يكتمل الهدف يتم الاسترداد تلقائي… فرصة لم تصل هدفها مئة
--  بالمئة بل وصلت ستين بالمئة، هنا يكون فيه مهلة تعطى للمورد مدة 24
--  ساعة… إذا لم ينفذ الخيارين تنتهي الفرصة وتسترد الأموال تلقائي.»
--
-- WHY THIS ARRIVES WITH THE SCHEDULER AND NOT LATER. Making fulfilment
-- wait for the target — the previous migration — left one case worse
-- than it found it: an offer that never fills used to ship anyway, and
-- now it would strand every buyer's share in `AWAITING_FUNDING` for
-- good, money captured and nothing owed back. The gate is right; this
-- is its other half, and half a decision is not one.
--
-- REFUNDS WERE ALREADY BUILT AND ONLY EVER FIRED TWICE. The obligation,
-- the double-entry posting, the provider attempt and the closing webhook
-- have existed since Phase 7C; the only two things that ever created an
-- obligation were a payment exception and a dispute decision. Nothing
-- could say "this offer did not fill". These two values are that
-- sentence.

-- 1 ── THE OFFER CAN NAME THE SOURCE
--
-- Its own value rather than reusing PAYMENT_EXCEPTION: nothing went
-- wrong with the payment. The money was taken correctly and is being
-- returned because a condition the buyer bought under did not happen,
-- and an operator reading the refunds list has to be able to tell those
-- two apart.
ALTER TYPE "RefundObligationSource" ADD VALUE IF NOT EXISTS 'OPPORTUNITY_UNFUNDED';

-- 2 ── AND THE REASON, IN THE BUYER'S TERMS
ALTER TYPE "RefundObligationReasonCode" ADD VALUE IF NOT EXISTS 'TARGET_NOT_REACHED';

-- 3 ── THE SUPPLIER'S 24 HOURS, HELD AS A DATE AND NOT A STATUS
--
-- «إذا قرر أن تقفل الصفقة ويعتمدها أوك، وإذا أراد أن تكتمل مئة بالمئة
--  فعنده خيار التمديد.»
--
-- A DATE, DELIBERATELY. `EXPIRED` is terminal in the transition table
-- and an extension has to be able to return the offer to ACTIVE — so
-- marking the window with a status would mean loosening the state
-- machine that keeps every other path honest. A column says the same
-- thing and changes nothing else.
--
-- NULL MEANS TWO DIFFERENT THINGS AND BOTH ARE SAFE: the window has not
-- opened, or it has been resolved. Neither is "the window is running",
-- which is the only state the scheduler acts on.
ALTER TABLE "opportunities"
  ADD COLUMN IF NOT EXISTS "decision_window_closes_at" TIMESTAMPTZ(3);

-- The scheduler asks one question every minute: which offers are past
-- their window? Both halves of it are indexed together so that question
-- never becomes a scan.
CREATE INDEX IF NOT EXISTS "opportunities_decision_window_closes_at_idx"
  ON "opportunities" ("decision_window_closes_at")
  WHERE "decision_window_closes_at" IS NOT NULL;
