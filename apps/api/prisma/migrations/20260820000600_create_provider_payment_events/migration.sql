CREATE TYPE "ProviderEventType" AS ENUM ('SUCCESS', 'FAILURE');
CREATE TYPE "ProviderEventOutcome" AS ENUM ('ORDER_CREATED', 'REFUND_REQUIRED', 'PAYMENT_FAILED', 'IGNORED_OUT_OF_ORDER', 'DUPLICATE');

CREATE TABLE "provider_payment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "payment_attempt_id" UUID NOT NULL,
    "event_type" "ProviderEventType" NOT NULL,
    "provider_captured_at" TIMESTAMPTZ(3),
    "provider_captured_amount" DECIMAL(14,2),
    "provider_fee_amount" DECIMAL(14,2),
    "processing_outcome" "ProviderEventOutcome" NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "payload_metadata_redacted" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_payment_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_payment_events_payment_attempt_id_idx" ON "provider_payment_events"("payment_attempt_id");
CREATE UNIQUE INDEX "provider_payment_events_provider_provider_event_id_key" ON "provider_payment_events"("provider", "provider_event_id");

ALTER TABLE "provider_payment_events" ADD CONSTRAINT "provider_payment_events_success_captured_at_required"
  CHECK (("event_type" = 'SUCCESS') = ("provider_captured_at" IS NOT NULL));
ALTER TABLE "provider_payment_events" ADD CONSTRAINT "provider_payment_events_provider_fee_non_negative"
  CHECK ("provider_fee_amount" IS NULL OR "provider_fee_amount" >= 0);

ALTER TABLE "provider_payment_events" ADD CONSTRAINT "provider_payment_events_payment_attempt_id_fkey"
  FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_provider_payment_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider_payment_events: rows are append-only and cannot be deleted (id=%)', OLD."id";
  END IF;
  RAISE EXCEPTION 'provider_payment_events: rows are append-only and cannot be modified (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_provider_payment_event_mutation
  BEFORE UPDATE OR DELETE ON "provider_payment_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_provider_payment_event_mutation();
