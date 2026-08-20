CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'SUPERSEDED');

CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkout_session_id" UUID NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "provider_code" TEXT NOT NULL,
    "provider_reference" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "provider_captured_at" TIMESTAMPTZ(3),
    "provider_captured_amount" DECIMAL(14,2),
    "provider_fee_amount" DECIMAL(14,2),
    "policy_acceptance_id" UUID,
    "accepted_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_attempts_checkout_session_id_idx" ON "payment_attempts"("checkout_session_id");

CREATE UNIQUE INDEX "payment_attempts_one_active_per_checkout"
  ON "payment_attempts"("checkout_session_id")
  WHERE "status" IN ('CREATED', 'PENDING');

CREATE UNIQUE INDEX "payment_attempts_provider_reference_unique"
  ON "payment_attempts"("provider_code", "provider_reference")
  WHERE "provider_reference" IS NOT NULL;

ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_provider_fee_non_negative"
  CHECK ("provider_fee_amount" IS NULL OR "provider_fee_amount" >= 0);
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_captured_at_amount_consistency"
  CHECK (("provider_captured_at" IS NULL) = ("provider_captured_amount" IS NULL));

ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_checkout_session_id_fkey"
  FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_policy_acceptance_id_fkey"
  FOREIGN KEY ("policy_acceptance_id") REFERENCES "policy_acceptances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_accepted_by_user_id_fkey"
  FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
