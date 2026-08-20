DROP TRIGGER IF EXISTS trg_prevent_order_allocation_core_mutation ON "order_allocations";
DROP FUNCTION IF EXISTS prevent_order_allocation_core_mutation();

CREATE OR REPLACE FUNCTION prevent_order_allocation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'order_allocations: rows cannot be deleted (id=%)', OLD."id";
  END IF;

  IF NEW."master_order_id" IS DISTINCT FROM OLD."master_order_id"
     OR NEW."checkout_location_allocation_id" IS DISTINCT FROM OLD."checkout_location_allocation_id"
     OR NEW."expected_preparation_days" IS DISTINCT FROM OLD."expected_preparation_days"
     OR NEW."preparation_due_at" IS DISTINCT FROM OLD."preparation_due_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'order_allocations: frozen fields cannot be modified (id=%)', OLD."id";
  END IF;

  IF OLD."status" = 'AWAITING_PREPARATION' AND NEW."status" = 'PREPARING'
     AND OLD."preparation_started_at" IS NULL AND NEW."preparation_started_at" IS NOT NULL
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PREPARING' AND NEW."status" = 'READY_TO_SHIP'
     AND OLD."ready_to_ship_at" IS NULL AND NEW."ready_to_ship_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'READY_TO_SHIP' AND NEW."status" = 'SHIPPED'
     AND OLD."shipped_at" IS NULL AND NEW."shipped_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."delivered_at" IS NOT DISTINCT FROM OLD."delivered_at" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'SHIPPED' AND NEW."status" = 'DELIVERED'
     AND OLD."delivered_at" IS NULL AND NEW."delivered_at" IS NOT NULL
     AND NEW."preparation_started_at" IS NOT DISTINCT FROM OLD."preparation_started_at"
     AND NEW."ready_to_ship_at" IS NOT DISTINCT FROM OLD."ready_to_ship_at"
     AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at" THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'order_allocations: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_order_allocation_mutation
  BEFORE UPDATE OR DELETE ON "order_allocations"
  FOR EACH ROW EXECUTE FUNCTION prevent_order_allocation_mutation();

ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_status_timestamp_consistency"
  CHECK (
    ("status" = 'AWAITING_PREPARATION' AND "preparation_started_at" IS NULL AND "ready_to_ship_at" IS NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
    OR ("status" = 'PREPARING' AND "preparation_started_at" IS NOT NULL AND "ready_to_ship_at" IS NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
    OR ("status" = 'READY_TO_SHIP' AND "preparation_started_at" IS NOT NULL AND "ready_to_ship_at" IS NOT NULL AND "shipped_at" IS NULL AND "delivered_at" IS NULL)
    OR ("status" = 'SHIPPED' AND "preparation_started_at" IS NOT NULL AND "ready_to_ship_at" IS NOT NULL AND "shipped_at" IS NOT NULL AND "delivered_at" IS NULL)
    OR ("status" = 'DELIVERED' AND "preparation_started_at" IS NOT NULL AND "ready_to_ship_at" IS NOT NULL AND "shipped_at" IS NOT NULL AND "delivered_at" IS NOT NULL)
  );

ALTER TABLE "order_allocations" ADD CONSTRAINT "order_allocations_timestamps_ordered"
  CHECK (
    ("ready_to_ship_at" IS NULL OR "preparation_started_at" <= "ready_to_ship_at")
    AND ("shipped_at" IS NULL OR "ready_to_ship_at" <= "shipped_at")
    AND ("delivered_at" IS NULL OR "shipped_at" <= "delivered_at")
  );
