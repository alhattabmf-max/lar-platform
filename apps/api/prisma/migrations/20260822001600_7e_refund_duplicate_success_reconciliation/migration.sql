-- -------------------------------------------------------------------
-- refund_provider_events: add a real processingOutcome enum column
-- (replacing the ad-hoc eventType string concatenation).
-- -------------------------------------------------------------------
CREATE TYPE "RefundProviderEventOutcome" AS ENUM ('RECORDED', 'SUCCEEDED', 'DEFINITIVE_FAILED', 'IGNORED_OUT_OF_ORDER', 'DUPLICATE_SUCCESS_REQUIRES_RECONCILIATION');

ALTER TABLE "refund_provider_events" ADD COLUMN "processing_outcome" "RefundProviderEventOutcome" NOT NULL DEFAULT 'RECORDED';
ALTER TABLE "refund_provider_events" ALTER COLUMN "processing_outcome" DROP DEFAULT;

-- -------------------------------------------------------------------
-- refund_attempts: providerReference guard — NULL -> value exactly
-- once, never changed thereafter (idempotent re-sends of the SAME
-- value are harmless no-ops from the trigger's point of view since
-- IS NOT DISTINCT FROM catches that), and unique per provider once set.
-- -------------------------------------------------------------------
CREATE UNIQUE INDEX "refund_attempts_provider_code_provider_reference_key"
  ON "refund_attempts"("provider_code", "provider_reference")
  WHERE "provider_reference" IS NOT NULL;

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
  IF OLD."provider_reference" IS NOT NULL AND NEW."provider_reference" IS DISTINCT FROM OLD."provider_reference" THEN
    RAISE EXCEPTION 'refund_attempts: provider_reference is frozen once set (id=%)', OLD."id";
  END IF;
  IF (OLD."status" = 'CREATED' AND NEW."status" IN ('PENDING', 'SUCCEEDED', 'DEFINITIVE_FAILED'))
     OR (OLD."status" = 'PENDING' AND NEW."status" IN ('SUCCEEDED', 'DEFINITIVE_FAILED'))
     OR (OLD."status" = 'DEFINITIVE_FAILED' AND NEW."status" = 'SUCCEEDED') THEN
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'refund_attempts: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -------------------------------------------------------------------
-- refund_reconciliation_incidents — Immutable, one per attempt.
-- -------------------------------------------------------------------
CREATE TYPE "RefundReconciliationIncidentReasonCode" AS ENUM ('DUPLICATE_PROVIDER_REFUND');
CREATE TYPE "RefundReconciliationIncidentStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "refund_reconciliation_incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "refund_obligation_id" UUID NOT NULL,
    "refund_attempt_id" UUID NOT NULL,
    "excess_amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "reason_code" "RefundReconciliationIncidentReasonCode" NOT NULL,
    "status" "RefundReconciliationIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_reconciliation_incidents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "refund_reconciliation_incidents_refund_attempt_id_key" ON "refund_reconciliation_incidents"("refund_attempt_id");
CREATE INDEX "refund_reconciliation_incidents_refund_obligation_id_idx" ON "refund_reconciliation_incidents"("refund_obligation_id");
ALTER TABLE "refund_reconciliation_incidents" ADD CONSTRAINT "refund_reconciliation_incidents_refund_obligation_id_fkey"
  FOREIGN KEY ("refund_obligation_id") REFERENCES "refund_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_reconciliation_incidents" ADD CONSTRAINT "refund_reconciliation_incidents_refund_attempt_id_fkey"
  FOREIGN KEY ("refund_attempt_id") REFERENCES "refund_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_refund_reconciliation_incident_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'refund_reconciliation_incidents: rows are immutable (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_rri_mutation
  BEFORE UPDATE OR DELETE ON "refund_reconciliation_incidents"
  FOR EACH ROW EXECUTE FUNCTION prevent_refund_reconciliation_incident_mutation();
