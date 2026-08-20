CREATE TABLE "checkout_location_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkout_session_id" UUID NOT NULL,
    "company_location_id" UUID NOT NULL,
    "location_name_snapshot" TEXT NOT NULL,
    "city_name_ar_snapshot" TEXT NOT NULL,
    "city_name_en_snapshot" TEXT NOT NULL,
    "region_name_ar_snapshot" TEXT NOT NULL,
    "region_name_en_snapshot" TEXT NOT NULL,
    "address_snapshot" TEXT NOT NULL,
    "latitude_snapshot" DECIMAL(9,6),
    "longitude_snapshot" DECIMAL(9,6),
    "contact_name_snapshot" TEXT NOT NULL,
    "contact_phone_snapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "shipping_tier_code" "ShippingTierCode" NOT NULL,
    "shipping_fee_amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_location_allocations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "checkout_location_allocations" ADD CONSTRAINT "checkout_location_allocations_checkout_session_id_fkey"
  FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checkout_location_allocations" ADD CONSTRAINT "checkout_location_allocations_company_location_id_fkey"
  FOREIGN KEY ("company_location_id") REFERENCES "company_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "checkout_location_allocations" ADD CONSTRAINT "checkout_location_allocations_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "checkout_location_allocations" ADD CONSTRAINT "checkout_location_allocations_shipping_fee_non_negative"
  CHECK ("shipping_fee_amount" >= 0);

CREATE OR REPLACE FUNCTION prevent_checkout_location_allocation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'checkout_location_allocations: rows are append-only and cannot be deleted (id=%)', OLD."id";
  END IF;
  RAISE EXCEPTION 'checkout_location_allocations: rows are append-only and cannot be modified (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_checkout_location_allocation_mutation
  BEFORE UPDATE OR DELETE ON "checkout_location_allocations"
  FOR EACH ROW EXECUTE FUNCTION prevent_checkout_location_allocation_mutation();

CREATE OR REPLACE FUNCTION check_checkout_allocation_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_session_id UUID;
  v_quantity_sum INT;
  v_shipping_sum DECIMAL(12,2);
  v_locked_quantity INT;
  v_total_shipping DECIMAL(12,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_session_id := OLD.checkout_session_id;
  ELSE
    v_session_id := NEW.checkout_session_id;
  END IF;

  SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(shipping_fee_amount), 0)
    INTO v_quantity_sum, v_shipping_sum
    FROM checkout_location_allocations WHERE checkout_session_id = v_session_id;

  SELECT locked_quantity INTO v_locked_quantity FROM checkout_sessions WHERE id = v_session_id;
  IF v_locked_quantity IS NULL THEN
    RAISE EXCEPTION 'checkout_location_allocations: no checkout_sessions row found for %', v_session_id;
  END IF;

  IF v_quantity_sum != v_locked_quantity THEN
    RAISE EXCEPTION 'checkout_location_allocations: sum(quantity)=% does not match checkout_sessions.locked_quantity=% for session %',
      v_quantity_sum, v_locked_quantity, v_session_id;
  END IF;

  SELECT total_shipping_fee_amount INTO v_total_shipping FROM quote_snapshots WHERE checkout_session_id = v_session_id;
  IF v_total_shipping IS NULL THEN
    RAISE EXCEPTION 'checkout_location_allocations: no quote_snapshots row found for session %', v_session_id;
  END IF;

  IF v_shipping_sum != v_total_shipping THEN
    RAISE EXCEPTION 'checkout_location_allocations: sum(shipping_fee_amount)=% does not match quote_snapshots.total_shipping_fee_amount=% for session %',
      v_shipping_sum, v_total_shipping, v_session_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_checkout_allocation_totals
  AFTER INSERT OR UPDATE OR DELETE ON "checkout_location_allocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_checkout_allocation_totals();
