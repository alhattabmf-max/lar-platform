CREATE TYPE "RefundObligationReasonCode" AS ENUM ('LATE_CAPTURE_AFTER_CANCEL', 'LATE_CAPTURE_AFTER_DEADLINE', 'COMMISSION_TAX_NOT_CONFIGURED', 'BANK_ACCOUNT_NOT_VERIFIED', 'DUPLICATE_SUCCESSFUL_CAPTURE', 'CAPTURE_AMOUNT_MISMATCH');
CREATE TYPE "RefundObligationStatus" AS ENUM ('PENDING_EXECUTION');

CREATE TABLE "refund_obligations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_attempt_id" UUID NOT NULL,
    "reason_code" "RefundObligationReasonCode" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "status" "RefundObligationStatus" NOT NULL DEFAULT 'PENDING_EXECUTION',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_obligations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refund_obligations_payment_attempt_id_key" ON "refund_obligations"("payment_attempt_id");

ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_payment_attempt_id_fkey"
  FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_refund_obligation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'refund_obligations: rows are append-only and cannot be modified or deleted (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_refund_obligation_mutation
  BEFORE UPDATE OR DELETE ON "refund_obligations"
  FOR EACH ROW EXECUTE FUNCTION prevent_refund_obligation_mutation();
