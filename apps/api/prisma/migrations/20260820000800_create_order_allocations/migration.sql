CREATE TYPE "OrderAllocationStatus" AS ENUM ('AWAITING_PREPARATION');

CREATE TABLE "order_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "master_order_id" UUID NOT NULL,
    "checkout_location_allocation_id" UUID NOT NULL,
    "status" "OrderAllocationStatus" NOT NULL DEFAULT 'AWAITING_PREPARATION',
    "expected_preparation_days" INTEGER NOT NULL,
    "preparation_due_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_allocations_checkout_location_allocation_id_key" ON "order_allocations"("checkout_location_allocation_id");
CREATE INDEX "order_allocations_master_order_id_idx" ON "order_allocations"("master_order_id");

ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_expected_preparation_days_positive"
  CHECK ("expected_preparation_days" > 0);

ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_master_order_id_fkey"
  FOREIGN KEY ("master_order_id") REFERENCES "master_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_checkout_location_allocation_id_fkey"
  FOREIGN KEY ("checkout_location_allocation_id") REFERENCES "checkout_location_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_order_allocation_core_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_allocations: rows cannot be deleted (id=%)', OLD."id";
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order_allocations: core fields are frozen after creation (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_order_allocation_core_mutation
  BEFORE UPDATE OR DELETE ON "order_allocations"
  FOR EACH ROW EXECUTE FUNCTION prevent_order_allocation_core_mutation();
