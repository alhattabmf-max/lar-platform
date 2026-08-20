CREATE TYPE "CarrierEventType" AS ENUM ('PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'EXCEPTION');
CREATE TYPE "CarrierEventOutcome" AS ENUM ('RECORDED', 'DELIVERED', 'IGNORED_ALREADY_DELIVERED', 'IGNORED_OUT_OF_ORDER');

CREATE TABLE "carrier_tracking_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shipment_tracking_id" UUID NOT NULL,
    "carrier_code" TEXT NOT NULL,
    "carrier_event_id" TEXT NOT NULL,
    "event_type" "CarrierEventType" NOT NULL,
    "event_occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "processing_outcome" "CarrierEventOutcome" NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "payload_metadata_redacted" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_tracking_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "carrier_tracking_events_shipment_tracking_id_idx" ON "carrier_tracking_events"("shipment_tracking_id");
CREATE UNIQUE INDEX "carrier_tracking_events_carrier_code_carrier_event_id_key" ON "carrier_tracking_events"("carrier_code", "carrier_event_id");

ALTER TABLE "carrier_tracking_events" ADD CONSTRAINT "carrier_tracking_events_shipment_tracking_id_fkey"
  FOREIGN KEY ("shipment_tracking_id") REFERENCES "shipment_tracking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_carrier_tracking_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'carrier_tracking_events: rows are append-only and cannot be modified or deleted (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_carrier_tracking_event_mutation
  BEFORE UPDATE OR DELETE ON "carrier_tracking_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_carrier_tracking_event_mutation();
