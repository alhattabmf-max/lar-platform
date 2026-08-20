CREATE OR REPLACE FUNCTION check_replacement_quantity_within_original()
RETURNS TRIGGER AS $$
DECLARE
  v_original_quantity INT;
BEGIN
  SELECT cla."quantity" INTO v_original_quantity
    FROM "order_allocations" oa
    JOIN "checkout_location_allocations" cla ON cla."id" = oa."checkout_location_allocation_id"
    WHERE oa."id" = NEW."original_order_allocation_id";

  IF NEW."replacement_quantity" > v_original_quantity THEN
    RAISE EXCEPTION 'replacement_obligations: replacement_quantity (%) exceeds the original allocation quantity (%) for id=%', NEW."replacement_quantity", v_original_quantity, NEW."id";
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_replacement_quantity_within_original
  AFTER INSERT ON "replacement_obligations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_replacement_quantity_within_original();
