CREATE TABLE "shipment_tracking" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_allocation_id" UUID NOT NULL,
    "carrier_code" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "shipped_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_tracking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shipment_tracking_order_allocation_id_key" ON "shipment_tracking"("order_allocation_id");
CREATE UNIQUE INDEX "shipment_tracking_carrier_code_tracking_number_key" ON "shipment_tracking"("carrier_code", "tracking_number");

ALTER TABLE "shipment_tracking" ADD CONSTRAINT "shipment_tracking_tracking_number_length"
  CHECK (length("tracking_number") BETWEEN 4 AND 64);

ALTER TABLE "shipment_tracking" ADD CONSTRAINT "shipment_tracking_order_allocation_id_fkey"
  FOREIGN KEY ("order_allocation_id") REFERENCES "order_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_shipment_tracking_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'shipment_tracking: rows are append-only and cannot be modified or deleted (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_shipment_tracking_mutation
  BEFORE UPDATE OR DELETE ON "shipment_tracking"
  FOR EACH ROW EXECUTE FUNCTION prevent_shipment_tracking_mutation();
