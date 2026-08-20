-- Gap found during 7C/7D regression testing on the fully-migrated
-- test DB: the amount-mismatch refund path (PAYMENT_EXCEPTION,
-- reason CAPTURE_AMOUNT_MISMATCH) legitimately refunds the ACTUAL
-- amount the provider captured, which can be GREATER than the
-- PaymentAttempt's originally-expected amount (that's the whole point
-- of the mismatch). The cap must therefore compare against
-- COALESCE(provider_captured_amount, amount) — the real captured
-- figure once known, falling back to the originally-expected amount
-- only when no capture has been recorded yet.
CREATE OR REPLACE FUNCTION check_refund_obligation_payment_attempt_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_payment_attempt_id UUID;
  v_captured_amount DECIMAL(14,2);
  v_refunded_sum DECIMAL(14,2);
BEGIN
  v_payment_attempt_id := NEW."payment_attempt_id";
  SELECT COALESCE("provider_captured_amount", "amount") INTO v_captured_amount
    FROM "payment_attempts" WHERE "id" = v_payment_attempt_id;
  SELECT COALESCE(SUM("amount"), 0) INTO v_refunded_sum
    FROM "refund_obligations"
    WHERE "payment_attempt_id" = v_payment_attempt_id
      AND "status" IN ('PENDING_EXECUTION', 'SENT', 'COMPLETED');
  IF v_refunded_sum > v_captured_amount THEN
    RAISE EXCEPTION 'refund_obligations: sum of active refunds (%) exceeds actual captured payment_attempt amount (%) for payment_attempt_id=%', v_refunded_sum, v_captured_amount, v_payment_attempt_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
