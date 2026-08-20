ALTER TABLE "order_allocations" ADD COLUMN "preparation_started_at" TIMESTAMPTZ(3);
ALTER TABLE "order_allocations" ADD COLUMN "ready_to_ship_at" TIMESTAMPTZ(3);
ALTER TABLE "order_allocations" ADD COLUMN "shipped_at" TIMESTAMPTZ(3);
ALTER TABLE "order_allocations" ADD COLUMN "delivered_at" TIMESTAMPTZ(3);
