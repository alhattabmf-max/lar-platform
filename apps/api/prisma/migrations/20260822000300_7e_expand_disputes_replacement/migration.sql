-- -------------------------------------------------------------------
-- disputes — ONE per OrderAllocation, for its entire lifetime.
-- -------------------------------------------------------------------
CREATE TYPE "DisputeReasonCode" AS ENUM ('ITEM_NOT_RECEIVED', 'ITEM_DAMAGED', 'ITEM_INCORRECT', 'QUANTITY_SHORTAGE', 'QUALITY_ISSUE', 'OTHER');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'SUPPLIER_RESPONDED', 'AWAITING_REPLACEMENT', 'RESOLVED_ACCEPTED', 'RESOLVED_PARTIAL', 'RESOLVED_REJECTED', 'RESOLVED_REPLACED');

CREATE TABLE "disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_allocation_id" UUID NOT NULL,
    "opened_by_user_id" UUID NOT NULL,
    "reason_code" "DisputeReasonCode" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "supplier_response_due_at" TIMESTAMPTZ(3) NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "disputes_order_allocation_id_key" ON "disputes"("order_allocation_id");
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_allocation_id_fkey"
  FOREIGN KEY ("order_allocation_id") REFERENCES "order_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_description_non_empty" CHECK (length(btrim("description")) > 0);

CREATE OR REPLACE FUNCTION prevent_dispute_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'disputes: rows cannot be deleted (id=%)', OLD."id";
  END IF;
  IF NEW."order_allocation_id" IS DISTINCT FROM OLD."order_allocation_id"
     OR NEW."opened_by_user_id" IS DISTINCT FROM OLD."opened_by_user_id"
     OR NEW."reason_code" IS DISTINCT FROM OLD."reason_code"
     OR NEW."description" IS DISTINCT FROM OLD."description"
     OR NEW."supplier_response_due_at" IS DISTINCT FROM OLD."supplier_response_due_at"
     OR NEW."opened_at" IS DISTINCT FROM OLD."opened_at" THEN
    RAISE EXCEPTION 'disputes: frozen fields cannot be modified (id=%)', OLD."id";
  END IF;

  IF (OLD."status" = 'OPEN' AND NEW."status" IN ('SUPPLIER_RESPONDED', 'RESOLVED_ACCEPTED', 'RESOLVED_PARTIAL', 'RESOLVED_REJECTED', 'AWAITING_REPLACEMENT'))
     OR (OLD."status" = 'SUPPLIER_RESPONDED' AND NEW."status" IN ('RESOLVED_ACCEPTED', 'RESOLVED_PARTIAL', 'RESOLVED_REJECTED', 'AWAITING_REPLACEMENT'))
     OR (OLD."status" = 'AWAITING_REPLACEMENT' AND NEW."status" IN ('RESOLVED_REPLACED', 'RESOLVED_ACCEPTED', 'RESOLVED_PARTIAL')) THEN
    RETURN NEW;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'disputes: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
  END IF;
  RAISE EXCEPTION 'disputes: no-op update rejected (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_dispute_mutation
  BEFORE UPDATE OR DELETE ON "disputes"
  FOR EACH ROW EXECUTE FUNCTION prevent_dispute_mutation();

-- -------------------------------------------------------------------
-- dispute_evidence — append-only
-- -------------------------------------------------------------------
CREATE TABLE "dispute_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispute_id" UUID NOT NULL,
    "storage_object_key" TEXT NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dispute_evidence_dispute_id_idx" ON "dispute_evidence"("dispute_id");
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_fkey"
  FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_storage_key_non_empty" CHECK (length(btrim("storage_object_key")) > 0);

CREATE OR REPLACE FUNCTION prevent_dispute_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'dispute_evidence: rows are append-only and cannot be modified or deleted (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_dispute_evidence_mutation
  BEFORE UPDATE OR DELETE ON "dispute_evidence"
  FOR EACH ROW EXECUTE FUNCTION prevent_dispute_evidence_mutation();

-- -------------------------------------------------------------------
-- dispute_supplier_responses — ONE final response per dispute.
-- -------------------------------------------------------------------
CREATE TYPE "DisputeSupplierResponseType" AS ENUM ('ACCEPT', 'REJECT', 'PARTIAL_ACCEPT', 'REPLACEMENT_OFFER');

CREATE TABLE "dispute_supplier_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispute_id" UUID NOT NULL,
    "response_type" "DisputeSupplierResponseType" NOT NULL,
    "description" TEXT NOT NULL,
    "responded_by_user_id" UUID NOT NULL,
    "responded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_supplier_responses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dispute_supplier_responses_dispute_id_key" ON "dispute_supplier_responses"("dispute_id");
ALTER TABLE "dispute_supplier_responses" ADD CONSTRAINT "dispute_supplier_responses_dispute_id_fkey"
  FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_supplier_responses" ADD CONSTRAINT "dsr_description_non_empty" CHECK (length(btrim("description")) > 0);

CREATE OR REPLACE FUNCTION prevent_dispute_supplier_response_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'dispute_supplier_responses: rows are immutable (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_dsr_mutation
  BEFORE UPDATE OR DELETE ON "dispute_supplier_responses"
  FOR EACH ROW EXECUTE FUNCTION prevent_dispute_supplier_response_mutation();

-- -------------------------------------------------------------------
-- dispute_decisions — sequenceNumber IN (1,2)
-- -------------------------------------------------------------------
CREATE TYPE "DisputeDecisionType" AS ENUM ('FULL_REFUND', 'PARTIAL_REFUND', 'REJECTED', 'REPLACEMENT');

CREATE TABLE "dispute_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispute_id" UUID NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "decision_type" "DisputeDecisionType" NOT NULL,
    "product_refund_amount_incl_tax" DECIMAL(14,2),
    "shipping_refund_amount" DECIMAL(14,2),
    "reason_note" TEXT NOT NULL,
    "decided_by_admin_user_id" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_decisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dispute_decisions_dispute_id_sequence_number_key" ON "dispute_decisions"("dispute_id", "sequence_number");
ALTER TABLE "dispute_decisions" ADD CONSTRAINT "dispute_decisions_dispute_id_fkey"
  FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dispute_decisions" ADD CONSTRAINT "dispute_decisions_reason_note_non_empty" CHECK (length(btrim("reason_note")) > 0);
ALTER TABLE "dispute_decisions" ADD CONSTRAINT "dispute_decisions_sequence_number_bounds" CHECK ("sequence_number" IN (1, 2));

CREATE OR REPLACE FUNCTION prevent_dispute_decision_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'dispute_decisions: rows are immutable (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_dispute_decision_mutation
  BEFORE UPDATE OR DELETE ON "dispute_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_dispute_decision_mutation();

-- -------------------------------------------------------------------
-- replacement_obligations — real operational entity, own shipment
-- lifecycle tables, never touching 7D's originals.
-- -------------------------------------------------------------------
CREATE TYPE "ReplacementObligationStatus" AS ENUM ('AWAITING_PREPARATION', 'PREPARING', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'FAILED');

CREATE TABLE "replacement_obligations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispute_decision_id" UUID NOT NULL,
    "original_order_allocation_id" UUID NOT NULL,
    "replacement_quantity" INTEGER NOT NULL,
    "status" "ReplacementObligationStatus" NOT NULL DEFAULT 'AWAITING_PREPARATION',
    "preparation_started_at" TIMESTAMPTZ(3),
    "ready_to_ship_at" TIMESTAMPTZ(3),
    "shipped_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replacement_obligations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "replacement_obligations_dispute_decision_id_key" ON "replacement_obligations"("dispute_decision_id");
ALTER TABLE "replacement_obligations" ADD CONSTRAINT "replacement_obligations_dispute_decision_id_fkey"
  FOREIGN KEY ("dispute_decision_id") REFERENCES "dispute_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "replacement_obligations" ADD CONSTRAINT "replacement_obligations_original_order_allocation_id_fkey"
  FOREIGN KEY ("original_order_allocation_id") REFERENCES "order_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "replacement_obligations" ADD CONSTRAINT "replacement_obligations_quantity_positive" CHECK ("replacement_quantity" > 0);

CREATE OR REPLACE FUNCTION prevent_replacement_obligation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'replacement_obligations: rows cannot be deleted (id=%)', OLD."id";
  END IF;
  IF NEW."dispute_decision_id" IS DISTINCT FROM OLD."dispute_decision_id"
     OR NEW."original_order_allocation_id" IS DISTINCT FROM OLD."original_order_allocation_id"
     OR NEW."replacement_quantity" IS DISTINCT FROM OLD."replacement_quantity"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'replacement_obligations: frozen fields cannot be modified (id=%)', OLD."id";
  END IF;

  IF OLD."status" = 'AWAITING_PREPARATION' AND NEW."status" = 'PREPARING'
     AND OLD."preparation_started_at" IS NULL AND NEW."preparation_started_at" IS NOT NULL
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at"
     AND NEW."failed_at" IS NOT DISTINCT FROM OLD."failed_at" THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'PREPARING' AND NEW."status" = 'READY_TO_SHIP'
     AND OLD."ready_to_ship_at" IS NULL AND NEW."ready_to_ship_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at"
     AND NEW."failed_at" IS NOT DISTINCT FROM OLD."failed_at" THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'READY_TO_SHIP' AND NEW."status" = 'SHIPPED'
     AND OLD."shipped_at" IS NULL AND NEW."shipped_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at"
     AND NEW."failed_at" IS NOT DISTINCT FROM OLD."failed_at" THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'SHIPPED' AND NEW."status" = 'DELIVERED'
     AND OLD."delivered_at" IS NULL AND NEW."delivered_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."failed_at" IS NOT DISTINCT FROM OLD."failed_at" THEN
    RETURN NEW;
  END IF;
  IF OLD."status" IN ('AWAITING_PREPARATION', 'PREPARING', 'READY_TO_SHIP', 'SHIPPED') AND NEW."status" = 'FAILED'
     AND OLD."failed_at" IS NULL AND NEW."failed_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'replacement_obligations: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_replacement_obligation_mutation
  BEFORE UPDATE OR DELETE ON "replacement_obligations"
  FOR EACH ROW EXECUTE FUNCTION prevent_replacement_obligation_mutation();

-- -------------------------------------------------------------------
-- replacement_shipment_tracking / replacement_carrier_tracking_events /
-- replacement_delivery_confirmations
-- -------------------------------------------------------------------
CREATE TABLE "replacement_shipment_tracking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "replacement_obligation_id" UUID NOT NULL,
    "carrier_code" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "shipped_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replacement_shipment_tracking_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "replacement_shipment_tracking_replacement_obligation_id_key" ON "replacement_shipment_tracking"("replacement_obligation_id");
CREATE UNIQUE INDEX "replacement_shipment_tracking_carrier_code_tracking_number_key" ON "replacement_shipment_tracking"("carrier_code", "tracking_number");
ALTER TABLE "replacement_shipment_tracking" ADD CONSTRAINT "rst_tracking_number_length" CHECK (length("tracking_number") BETWEEN 4 AND 64);
ALTER TABLE "replacement_shipment_tracking" ADD CONSTRAINT "rst_carrier_code_non_empty" CHECK (length(btrim("carrier_code")) > 0);
ALTER TABLE "replacement_shipment_tracking" ADD CONSTRAINT "replacement_shipment_tracking_replacement_obligation_id_fkey"
  FOREIGN KEY ("replacement_obligation_id") REFERENCES "replacement_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_replacement_shipment_tracking_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'replacement_shipment_tracking: rows are append-only (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_prevent_rst_mutation
  BEFORE UPDATE OR DELETE ON "replacement_shipment_tracking"
  FOR EACH ROW EXECUTE FUNCTION prevent_replacement_shipment_tracking_mutation();

CREATE TABLE "replacement_carrier_tracking_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "replacement_shipment_tracking_id" UUID NOT NULL,
    "carrier_code" TEXT NOT NULL,
    "carrier_event_id" TEXT NOT NULL,
    "event_type" "CarrierEventType" NOT NULL,
    "event_occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "processing_outcome" "CarrierEventOutcome" NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "payload_metadata_redacted" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replacement_carrier_tracking_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "replacement_carrier_tracking_events_replacement_shipment_tr_idx" ON "replacement_carrier_tracking_events"("replacement_shipment_tracking_id");
CREATE UNIQUE INDEX "replacement_carrier_tracking_events_carrier_code_carrier_ev_key" ON "replacement_carrier_tracking_events"("carrier_code", "carrier_event_id");
ALTER TABLE "replacement_carrier_tracking_events" ADD CONSTRAINT "rcte_carrier_code_non_empty" CHECK (length(btrim("carrier_code")) > 0);
ALTER TABLE "replacement_carrier_tracking_events" ADD CONSTRAINT "rcte_carrier_event_id_non_empty" CHECK (length(btrim("carrier_event_id")) > 0);
ALTER TABLE "replacement_carrier_tracking_events" ADD CONSTRAINT "replacement_carrier_tracking_events_replacement_shipment_t_fkey"
  FOREIGN KEY ("replacement_shipment_tracking_id") REFERENCES "replacement_shipment_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_replacement_carrier_tracking_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'replacement_carrier_tracking_events: rows are append-only (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_prevent_rcte_mutation
  BEFORE UPDATE OR DELETE ON "replacement_carrier_tracking_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_replacement_carrier_tracking_event_mutation();

CREATE TYPE "ReplacementDeliveryConfirmationSource" AS ENUM ('CARRIER_WEBHOOK', 'TRADER_CONFIRMATION', 'ADMIN_DECISION');

CREATE TABLE "replacement_delivery_confirmations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "replacement_obligation_id" UUID NOT NULL,
    "confirmed_by_source" "ReplacementDeliveryConfirmationSource" NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_by_user_id" UUID,
    "replacement_carrier_tracking_event_id" UUID,
    "admin_reason_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replacement_delivery_confirmations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "replacement_delivery_confirmations_replacement_obligation_i_key" ON "replacement_delivery_confirmations"("replacement_obligation_id");
CREATE UNIQUE INDEX "replacement_delivery_confirmations_replacement_carrier_trac_key" ON "replacement_delivery_confirmations"("replacement_carrier_tracking_event_id");
ALTER TABLE "replacement_delivery_confirmations" ADD CONSTRAINT "rdc_source_fields_consistency"
  CHECK (
    ("confirmed_by_source" = 'CARRIER_WEBHOOK' AND "replacement_carrier_tracking_event_id" IS NOT NULL AND "confirmed_by_user_id" IS NULL AND "admin_reason_note" IS NULL)
    OR ("confirmed_by_source" = 'TRADER_CONFIRMATION' AND "confirmed_by_user_id" IS NOT NULL AND "replacement_carrier_tracking_event_id" IS NULL AND "admin_reason_note" IS NULL)
    OR ("confirmed_by_source" = 'ADMIN_DECISION' AND "confirmed_by_user_id" IS NOT NULL AND "admin_reason_note" IS NOT NULL AND "replacement_carrier_tracking_event_id" IS NULL)
  );
ALTER TABLE "replacement_delivery_confirmations" ADD CONSTRAINT "replacement_delivery_confirmations_replacement_obligation__fkey"
  FOREIGN KEY ("replacement_obligation_id") REFERENCES "replacement_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "replacement_delivery_confirmations" ADD CONSTRAINT "replacement_delivery_confirmations_replacement_carrier_tra_fkey"
  FOREIGN KEY ("replacement_carrier_tracking_event_id") REFERENCES "replacement_carrier_tracking_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_replacement_delivery_confirmation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'replacement_delivery_confirmations: rows are append-only (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_prevent_rdc_mutation
  BEFORE UPDATE OR DELETE ON "replacement_delivery_confirmations"
  FOR EACH ROW EXECUTE FUNCTION prevent_replacement_delivery_confirmation_mutation();

CREATE OR REPLACE FUNCTION check_replacement_shipped_has_tracking()
RETURNS TRIGGER AS $$
DECLARE
  v_id UUID; v_status "ReplacementObligationStatus"; v_count INT;
BEGIN
  v_id := NEW."id";
  SELECT "status" INTO v_status FROM "replacement_obligations" WHERE "id" = v_id;
  IF v_status IN ('SHIPPED', 'DELIVERED') THEN
    SELECT COUNT(*) INTO v_count FROM "replacement_shipment_tracking" WHERE "replacement_obligation_id" = v_id;
    IF v_count != 1 THEN
      RAISE EXCEPTION 'replacement_obligations: % status requires exactly one replacement_shipment_tracking row, found % (id=%)', v_status, v_count, v_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_replacement_shipped_has_tracking
  AFTER INSERT OR UPDATE ON "replacement_obligations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_replacement_shipped_has_tracking();

CREATE OR REPLACE FUNCTION check_replacement_delivered_has_confirmation()
RETURNS TRIGGER AS $$
DECLARE
  v_id UUID; v_status "ReplacementObligationStatus"; v_count INT;
BEGIN
  v_id := NEW."id";
  SELECT "status" INTO v_status FROM "replacement_obligations" WHERE "id" = v_id;
  IF v_status = 'DELIVERED' THEN
    SELECT COUNT(*) INTO v_count FROM "replacement_delivery_confirmations" WHERE "replacement_obligation_id" = v_id;
    IF v_count != 1 THEN
      RAISE EXCEPTION 'replacement_obligations: DELIVERED status requires exactly one replacement_delivery_confirmations row, found % (id=%)', v_count, v_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_replacement_delivered_has_confirmation
  AFTER INSERT OR UPDATE ON "replacement_obligations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_replacement_delivered_has_confirmation();

-- Now that dispute_decisions exists, wire refund_obligations.dispute_decision_id's FK.
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_dispute_decision_id_fkey"
  FOREIGN KEY ("dispute_decision_id") REFERENCES "dispute_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
