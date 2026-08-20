-- =========================================================================
-- Phase 7E — EXPAND migration. All new columns nullable / no
-- assume-complete constraints. Contract migration (after Backfill +
-- Verification Gate) adds the strict CHECKs.
-- =========================================================================

-- -------------------------------------------------------------------
-- RefundObligation rework
-- -------------------------------------------------------------------
DROP INDEX "refund_obligations_payment_attempt_id_key";
CREATE INDEX "refund_obligations_payment_attempt_id_idx" ON "refund_obligations"("payment_attempt_id");

CREATE TYPE "RefundObligationSource" AS ENUM ('PAYMENT_EXCEPTION', 'DISPUTE');

ALTER TYPE "RefundObligationReasonCode" ADD VALUE 'DISPUTE_FULL_REFUND';
ALTER TYPE "RefundObligationReasonCode" ADD VALUE 'DISPUTE_PARTIAL_REFUND';

ALTER TYPE "RefundObligationStatus" ADD VALUE 'SENT';
ALTER TYPE "RefundObligationStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "RefundObligationStatus" ADD VALUE 'FAILED';
