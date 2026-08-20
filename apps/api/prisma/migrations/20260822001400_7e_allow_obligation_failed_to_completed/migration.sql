CREATE OR REPLACE FUNCTION prevent_refund_obligation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refund_obligations: rows cannot be deleted (id=%)', OLD."id";
  END IF;
  IF NEW."payment_attempt_id" IS DISTINCT FROM OLD."payment_attempt_id"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."dispute_decision_id" IS DISTINCT FROM OLD."dispute_decision_id"
     OR NEW."reason_code" IS DISTINCT FROM OLD."reason_code"
     OR NEW."product_refund_amount_incl_tax" IS DISTINCT FROM OLD."product_refund_amount_incl_tax"
     OR NEW."shipping_refund_amount" IS DISTINCT FROM OLD."shipping_refund_amount"
     OR NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'refund_obligations: frozen fields cannot be modified (id=%)', OLD."id";
  END IF;

  -- A late SUCCESS webhook for an attempt whose obligation had
  -- already moved to FAILED (via that same attempt's own confirmed
  -- DEFINITIVE_FAILED) is accepted as financial truth — the
  -- obligation-level counterpart to refund_attempts'
  -- DEFINITIVE_FAILED -> SUCCEEDED transition (Section 5).
  IF (OLD."status" = 'PENDING_EXECUTION' AND NEW."status" IN ('SENT', 'FAILED', 'COMPLETED'))
     OR (OLD."status" = 'SENT' AND NEW."status" IN ('COMPLETED', 'FAILED'))
     OR (OLD."status" = 'FAILED' AND NEW."status" IN ('SENT', 'COMPLETED')) THEN
    RETURN NEW;
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'refund_obligations: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
  END IF;
  RAISE EXCEPTION 'refund_obligations: no-op update rejected (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
