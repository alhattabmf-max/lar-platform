ALTER TABLE "delivery_confirmations" DROP CONSTRAINT "delivery_confirmations_source_fields_consistency";
ALTER TABLE "delivery_confirmations" ADD CONSTRAINT "delivery_confirmations_source_fields_consistency"
  CHECK (
    ("confirmed_by_source" = 'CARRIER_WEBHOOK' AND "carrier_tracking_event_id" IS NOT NULL AND "confirmed_by_user_id" IS NULL AND "admin_reason_note" IS NULL)
    OR ("confirmed_by_source" = 'TRADER_CONFIRMATION' AND "confirmed_by_user_id" IS NOT NULL AND "carrier_tracking_event_id" IS NULL AND "admin_reason_note" IS NULL)
    OR ("confirmed_by_source" = 'ADMIN_DECISION' AND "confirmed_by_user_id" IS NOT NULL AND "admin_reason_note" IS NOT NULL AND "carrier_tracking_event_id" IS NULL)
  );

CREATE OR REPLACE FUNCTION prevent_master_order_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'master_orders: rows cannot be deleted (id=%)', OLD."id";
  END IF;
  IF OLD."status" = 'IN_FULFILLMENT' AND NEW."status" = 'FULFILLED' THEN
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'master_orders: only IN_FULFILLMENT -> FULFILLED is a legal status transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
  END IF;
  RAISE EXCEPTION 'master_orders: core fields are frozen after creation (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "shipment_tracking" ADD CONSTRAINT "shipment_tracking_carrier_code_non_empty"
  CHECK (length(btrim("carrier_code")) > 0);

ALTER TABLE "carrier_tracking_events" ADD CONSTRAINT "carrier_tracking_events_carrier_code_non_empty"
  CHECK (length(btrim("carrier_code")) > 0);
ALTER TABLE "carrier_tracking_events" ADD CONSTRAINT "carrier_tracking_events_carrier_event_id_non_empty"
  CHECK (length(btrim("carrier_event_id")) > 0);
