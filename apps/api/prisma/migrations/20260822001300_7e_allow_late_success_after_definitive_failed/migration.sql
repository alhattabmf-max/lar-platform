CREATE OR REPLACE FUNCTION prevent_refund_attempt_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refund_attempts: rows cannot be deleted (id=%)', OLD."id";
  END IF;
  IF NEW."refund_obligation_id" IS DISTINCT FROM OLD."refund_obligation_id"
     OR NEW."provider_code" IS DISTINCT FROM OLD."provider_code"
     OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'refund_attempts: frozen fields cannot be modified (id=%)', OLD."id";
  END IF;
  -- A late SUCCESS for an attempt already DEFINITIVE_FAILED is
  -- accepted as financial truth (Section 5 of the approved design) —
  -- this is the ONE exception to "DEFINITIVE_FAILED is terminal".
  IF (OLD."status" = 'CREATED' AND NEW."status" IN ('PENDING', 'SUCCEEDED', 'DEFINITIVE_FAILED'))
     OR (OLD."status" = 'PENDING' AND NEW."status" IN ('SUCCEEDED', 'DEFINITIVE_FAILED'))
     OR (OLD."status" = 'DEFINITIVE_FAILED' AND NEW."status" = 'SUCCEEDED') THEN
    RETURN NEW;
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RAISE EXCEPTION 'refund_attempts: invalid or disallowed transition (id=%, old_status=%, new_status=%)', OLD."id", OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
