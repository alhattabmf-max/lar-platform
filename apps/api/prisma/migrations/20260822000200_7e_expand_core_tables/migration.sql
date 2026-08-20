-- -------------------------------------------------------------------
-- refund_obligations: new columns for 7E (source, per-component
-- amounts, dispute_decision_id FK — dispute_decisions table created
-- further below in this same file, referenced later via ALTER TABLE
-- once it exists).
-- -------------------------------------------------------------------
ALTER TABLE "refund_obligations" ADD COLUMN "source" "RefundObligationSource" NOT NULL DEFAULT 'PAYMENT_EXCEPTION';
ALTER TABLE "refund_obligations" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "refund_obligations" ADD COLUMN "dispute_decision_id" UUID;
ALTER TABLE "refund_obligations" ADD COLUMN "product_refund_amount_incl_tax" DECIMAL(14,2);
ALTER TABLE "refund_obligations" ADD COLUMN "shipping_refund_amount" DECIMAL(14,2);

CREATE UNIQUE INDEX "refund_obligations_dispute_decision_id_key" ON "refund_obligations"("dispute_decision_id");

-- Source-consistency CHECK: DISPUTE rows always carry both component
-- amounts and their sum equals the total; PAYMENT_EXCEPTION rows carry
-- neither.
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_source_amounts_consistency"
  CHECK (
    ("source" = 'DISPUTE' AND "product_refund_amount_incl_tax" IS NOT NULL AND "shipping_refund_amount" IS NOT NULL
      AND "amount" = "product_refund_amount_incl_tax" + "shipping_refund_amount")
    OR ("source" = 'PAYMENT_EXCEPTION' AND "product_refund_amount_incl_tax" IS NULL AND "shipping_refund_amount" IS NULL)
  );

-- -------------------------------------------------------------------
-- refund_attempts
-- -------------------------------------------------------------------
CREATE TYPE "RefundAttemptStatus" AS ENUM ('CREATED', 'SENT', 'COMPLETED', 'FAILED');

CREATE TABLE "refund_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "refund_obligation_id" UUID NOT NULL,
    "provider_code" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "RefundAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "provider_reference" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refund_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "refund_attempts_idempotency_key_key" ON "refund_attempts"("idempotency_key");
CREATE INDEX "refund_attempts_refund_obligation_id_idx" ON "refund_attempts"("refund_obligation_id");
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_refund_obligation_id_fkey"
  FOREIGN KEY ("refund_obligation_id") REFERENCES "refund_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guarded transition trigger: CREATED->SENT->COMPLETED, CREATED->FAILED, SENT->FAILED. No reversal, no skip.
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
  IF (OLD."status" = 'CREATED' AND NEW."status" IN ('SENT', 'FAILED'))
     OR (OLD."status" = 'SENT' AND NEW."status" IN ('COMPLETED', 'FAILED')) THEN
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'refund_attempts: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
  END IF;
  RETURN NEW; -- allows provider_reference/failure_reason to be set alongside the status change above; a no-status-change update (e.g. updated_at only via app layer) is otherwise blocked by ORM discipline, not by this trigger
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_refund_attempt_mutation
  BEFORE UPDATE OR DELETE ON "refund_attempts"
  FOR EACH ROW EXECUTE FUNCTION prevent_refund_attempt_mutation();

-- -------------------------------------------------------------------
-- refund_provider_events — append-only
-- -------------------------------------------------------------------
CREATE TABLE "refund_provider_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "refund_attempt_id" UUID NOT NULL,
    "provider_code" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_provider_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "refund_provider_events_provider_code_provider_event_id_key" ON "refund_provider_events"("provider_code", "provider_event_id");
CREATE INDEX "refund_provider_events_refund_attempt_id_idx" ON "refund_provider_events"("refund_attempt_id");
ALTER TABLE "refund_provider_events" ADD CONSTRAINT "refund_provider_events_refund_attempt_id_fkey"
  FOREIGN KEY ("refund_attempt_id") REFERENCES "refund_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_refund_provider_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'refund_provider_events: rows are append-only and cannot be modified or deleted (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_refund_provider_event_mutation
  BEFORE UPDATE OR DELETE ON "refund_provider_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_refund_provider_event_mutation();

-- -------------------------------------------------------------------
-- order_allocations: new nullable columns for 7E (Expand phase — no
-- assume-complete CHECK yet; that comes in the Contract migration
-- after Backfill + Verification Gate).
-- -------------------------------------------------------------------
ALTER TABLE "order_allocations" ADD COLUMN "dispute_window_closes_at" TIMESTAMPTZ(3);
ALTER TABLE "order_allocations" ADD COLUMN "payout_settled_at" TIMESTAMPTZ(3);

-- -------------------------------------------------------------------
-- order_allocation_financial_snapshots — immutable, sole source of
-- truth for financial math from this point forward.
-- -------------------------------------------------------------------
CREATE TABLE "order_allocation_financial_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_allocation_id" UUID NOT NULL,
    "product_amount_excl_tax" DECIMAL(14,2) NOT NULL,
    "product_tax_amount" DECIMAL(14,2) NOT NULL,
    "product_amount_incl_tax" DECIMAL(14,2) NOT NULL,
    "allocation_share_basis_points" INTEGER NOT NULL,
    "commission_share_amount" DECIMAL(14,2) NOT NULL,
    "commission_share_tax_amount" DECIMAL(14,2) NOT NULL,
    "supplier_payable_share_amount" DECIMAL(14,2) NOT NULL,
    "shipping_fee_amount" DECIMAL(12,2) NOT NULL,
    "product_amount_rounding_remainder" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commission_share_rounding_remainder" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commission_share_tax_rounding_remainder" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "supplier_payable_share_rounding_remainder" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_allocation_financial_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "order_allocation_financial_snapshots_order_allocation_id_key" ON "order_allocation_financial_snapshots"("order_allocation_id");
ALTER TABLE "order_allocation_financial_snapshots" ADD CONSTRAINT "order_allocation_financial_snapshots_order_allocation_id_fkey"
  FOREIGN KEY ("order_allocation_id") REFERENCES "order_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Internal consistency: incl = excl + tax
ALTER TABLE "order_allocation_financial_snapshots" ADD CONSTRAINT "oafs_product_amount_equation"
  CHECK ("product_amount_incl_tax" = "product_amount_excl_tax" + "product_tax_amount");

CREATE OR REPLACE FUNCTION prevent_order_allocation_financial_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'order_allocation_financial_snapshots: rows are immutable (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_oafs_mutation
  BEFORE UPDATE OR DELETE ON "order_allocation_financial_snapshots"
  FOR EACH ROW EXECUTE FUNCTION prevent_order_allocation_financial_snapshot_mutation();
