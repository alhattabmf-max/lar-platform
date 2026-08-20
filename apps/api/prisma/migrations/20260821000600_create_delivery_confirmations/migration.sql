CREATE TYPE "DeliveryConfirmationSource" AS ENUM ('CARRIER_WEBHOOK', 'TRADER_CONFIRMATION', 'ADMIN_DECISION');

CREATE TABLE "delivery_confirmations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_allocation_id" UUID NOT NULL,
    "confirmed_by_source" "DeliveryConfirmationSource" NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_by_user_id" UUID,
    "carrier_tracking_event_id" UUID,
    "admin_reason_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_confirmations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_confirmations_order_allocation_id_key" ON "delivery_confirmations"("order_allocation_id");
CREATE UNIQUE INDEX "delivery_confirmations_carrier_tracking_event_id_key" ON "delivery_confirmations"("carrier_tracking_event_id");

ALTER TABLE "delivery_confirmations" ADD CONSTRAINT "delivery_confirmations_source_fields_consistency"
  CHECK (
    ("confirmed_by_source" = 'CARRIER_WEBHOOK' AND "carrier_tracking_event_id" IS NOT NULL AND "confirmed_by_user_id" IS NULL)
    OR ("confirmed_by_source" = 'TRADER_CONFIRMATION' AND "confirmed_by_user_id" IS NOT NULL AND "carrier_tracking_event_id" IS NULL)
    OR ("confirmed_by_source" = 'ADMIN_DECISION' AND "confirmed_by_user_id" IS NOT NULL AND "admin_reason_note" IS NOT NULL AND "carrier_tracking_event_id" IS NULL)
  );

ALTER TABLE "delivery_confirmations" ADD CONSTRAINT "delivery_confirmations_order_allocation_id_fkey"
  FOREIGN KEY ("order_allocation_id") REFERENCES "order_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_confirmations" ADD CONSTRAINT "delivery_confirmations_carrier_tracking_event_id_fkey"
  FOREIGN KEY ("carrier_tracking_event_id") REFERENCES "carrier_tracking_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_delivery_confirmation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'delivery_confirmations: rows are append-only and cannot be modified or deleted (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_delivery_confirmation_mutation
  BEFORE UPDATE OR DELETE ON "delivery_confirmations"
  FOR EACH ROW EXECUTE FUNCTION prevent_delivery_confirmation_mutation();

CREATE OR REPLACE FUNCTION check_shipped_has_tracking()
RETURNS TRIGGER AS $$
DECLARE
  v_id UUID;
  v_status "OrderAllocationStatus";
  v_count INT;
BEGIN
  v_id := NEW."id";
  SELECT "status" INTO v_status FROM "order_allocations" WHERE "id" = v_id;
  IF v_status IN ('SHIPPED', 'DELIVERED') THEN
    SELECT COUNT(*) INTO v_count FROM "shipment_tracking" WHERE "order_allocation_id" = v_id;
    IF v_count != 1 THEN
      RAISE EXCEPTION 'order_allocations: % status requires exactly one shipment_tracking row, found % (id=%)', v_status, v_count, v_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_shipped_has_tracking
  AFTER INSERT OR UPDATE ON "order_allocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_shipped_has_tracking();

CREATE OR REPLACE FUNCTION check_delivered_has_confirmation()
RETURNS TRIGGER AS $$
DECLARE
  v_id UUID;
  v_status "OrderAllocationStatus";
  v_count INT;
BEGIN
  v_id := NEW."id";
  SELECT "status" INTO v_status FROM "order_allocations" WHERE "id" = v_id;
  IF v_status = 'DELIVERED' THEN
    SELECT COUNT(*) INTO v_count FROM "delivery_confirmations" WHERE "order_allocation_id" = v_id;
    IF v_count != 1 THEN
      RAISE EXCEPTION 'order_allocations: DELIVERED status requires exactly one delivery_confirmations row, found % (id=%)', v_count, v_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_delivered_has_confirmation
  AFTER INSERT OR UPDATE ON "order_allocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_delivered_has_confirmation();
