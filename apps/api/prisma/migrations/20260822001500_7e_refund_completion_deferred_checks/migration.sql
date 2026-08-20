-- RefundObligation.COMPLETED requires at least one SUCCEEDED
-- RefundAttempt to exist for it.
CREATE OR REPLACE FUNCTION check_refund_obligation_completed_has_succeeded_attempt()
RETURNS TRIGGER AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW."status" = 'COMPLETED' THEN
    SELECT COUNT(*) INTO v_count FROM "refund_attempts" WHERE "refund_obligation_id" = NEW."id" AND "status" = 'SUCCEEDED';
    IF v_count = 0 THEN
      RAISE EXCEPTION 'refund_obligations: COMPLETED status requires at least one SUCCEEDED refund_attempts row, found % (id=%)', v_count, NEW."id";
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_refund_obligation_completed_has_succeeded_attempt
  AFTER INSERT OR UPDATE ON "refund_obligations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_refund_obligation_completed_has_succeeded_attempt();

-- A COMPLETED obligation must have exactly one REFUND_EXECUTED
-- journal entry, and that entry's postings must be balanced (the
-- generic journal-balance trigger already enforces the balance
-- itself; this trigger enforces the EXISTENCE and UNIQUENESS of the
-- REFUND_EXECUTED entry specifically, tying completion to its
-- accounting record).
CREATE OR REPLACE FUNCTION check_refund_obligation_completed_has_executed_journal()
RETURNS TRIGGER AS $$
DECLARE
  v_count INT;
BEGIN
  IF NEW."status" = 'COMPLETED' THEN
    SELECT COUNT(*) INTO v_count FROM "journal_entries"
      WHERE "reference_type" = 'refund_obligation' AND "reference_id" = NEW."id" AND "event_type" = 'REFUND_EXECUTED';
    IF v_count != 1 THEN
      RAISE EXCEPTION 'refund_obligations: COMPLETED status requires exactly one REFUND_EXECUTED journal entry, found % (id=%)', v_count, NEW."id";
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_refund_obligation_completed_has_executed_journal
  AFTER INSERT OR UPDATE ON "refund_obligations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_refund_obligation_completed_has_executed_journal();
