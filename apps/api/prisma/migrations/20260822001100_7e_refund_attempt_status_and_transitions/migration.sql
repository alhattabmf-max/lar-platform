-- -------------------------------------------------------------------
-- RefundAttemptStatus: replace the enum wholesale (no production data
-- exists yet — the feature is unused). Old: CREATED/SENT/COMPLETED/
-- FAILED. New: CREATED/PENDING/SUCCEEDED/DEFINITIVE_FAILED — no
-- generic FAILED that conflates confirmed failure with an unknown
-- outcome.
-- -------------------------------------------------------------------
ALTER TYPE "RefundAttemptStatus" RENAME TO "RefundAttemptStatus_old";
CREATE TYPE "RefundAttemptStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'DEFINITIVE_FAILED');

ALTER TABLE "refund_attempts" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "refund_attempts" ALTER COLUMN "status" TYPE "RefundAttemptStatus" USING (
  CASE "status"::text
    WHEN 'CREATED' THEN 'CREATED'
    WHEN 'SENT' THEN 'PENDING'
    WHEN 'COMPLETED' THEN 'SUCCEEDED'
    WHEN 'FAILED' THEN 'DEFINITIVE_FAILED'
  END
)::"RefundAttemptStatus";
ALTER TABLE "refund_attempts" ALTER COLUMN "status" SET DEFAULT 'CREATED';
DROP TYPE "RefundAttemptStatus_old";

-- Guarded transitions: CREATED -> PENDING (provider call sent, async
-- outcome pending), CREATED -> SUCCEEDED / DEFINITIVE_FAILED (a
-- synchronous provider response), PENDING -> SUCCEEDED /
-- DEFINITIVE_FAILED (an async webhook resolves it later). No
-- transition ever reaches RETRYABLE_UNKNOWN — that is a transient
-- call outcome, never a persisted status; the row simply stays
-- CREATED/PENDING and the same attempt is reused.
CREATE OR REPLACE FUNCTION prevent_refund_attempt_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refund_attempts: rows cannot be deleted (id=%)', OLD."id";
  END IF;
  IF NEW."refund_obligation_id" IS DISTINCT FROM OLD."refund_obligation_id"
     OR NEW."provider_code" IS DISTINCT FROM OLD."provider_code"
     OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'refund_attempts: frozen fields cannot be modified (id=%)', OLD."id";
  END IF;
  IF (OLD."status" = 'CREATED' AND NEW."status" IN ('PENDING', 'SUCCEEDED', 'DEFINITIVE_FAILED'))
     OR (OLD."status" = 'PENDING' AND NEW."status" IN ('SUCCEEDED', 'DEFINITIVE_FAILED')) THEN
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'refund_attempts: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
  END IF;
  RETURN NEW; -- allows provider_reference/failure_reason to be filled alongside a status change above
END;
$$ LANGUAGE plpgsql;

-- One active attempt per RefundObligation — a new attempt can only be
-- created once no CREATED/PENDING attempt exists for that obligation
-- anymore (i.e. after a confirmed DEFINITIVE_FAILED).
CREATE UNIQUE INDEX "refund_attempts_one_active_per_obligation" ON "refund_attempts"("refund_obligation_id") WHERE "status" IN ('CREATED', 'PENDING');

-- -------------------------------------------------------------------
-- RefundObligation: replace 7C's blanket-immutable trigger wholesale
-- to allow the governed status transitions execution needs, while
-- every OTHER field remains permanently frozen exactly as 7C
-- intended.
--   PENDING_EXECUTION -> SENT -> COMPLETED
--   PENDING_EXECUTION / SENT -> FAILED
--   FAILED -> SENT   (only when a brand new attempt is created after
--                      a confirmed DEFINITIVE_FAILED)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_refund_obligation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refund_obligations: rows cannot be deleted (id=%)', OLD."id";
  END IF;
  IF NEW."payment_attempt_id" IS DISTINCT FROM OLD."payment_attempt_id"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."dispute_decision_id" IS DISTINCT FROM OLD."dispute_decision_id"
     OR NEW."reason_code" IS DISTINCT FROM OLD."reason_code"
     OR NEW."product_refund_amount_incl_tax" IS DISTINCT FROM OLD."product_refund_amount_incl_tax"
     OR NEW."shipping_refund_amount" IS DISTINCT FROM OLD."shipping_refund_amount"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'refund_obligations: frozen fields cannot be modified (id=%)', OLD."id";
  END IF;

  IF (OLD."status" = 'PENDING_EXECUTION' AND NEW."status" IN ('SENT', 'FAILED'))
     OR (OLD."status" = 'SENT' AND NEW."status" IN ('COMPLETED', 'FAILED'))
     OR (OLD."status" = 'FAILED' AND NEW."status" = 'SENT') THEN
    RETURN NEW;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'refund_obligations: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
  END IF;
  RAISE EXCEPTION 'refund_obligations: no-op update rejected (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
