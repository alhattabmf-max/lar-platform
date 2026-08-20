-- -------------------------------------------------------------------
-- refund_reconciliation_incidents.journal_entry_id — the reconciliation
-- journal entry (DEBIT REFUND_RECONCILIATION_RECEIVABLE, CREDIT
-- CASH_CLEARING) that documents this incident's excess cash outflow.
-- Filled at INSERT time (the journal is always created first, within
-- the same transaction) — never updated afterward, since the table's
-- existing immutability trigger already forbids any UPDATE.
-- -------------------------------------------------------------------
ALTER TABLE "refund_reconciliation_incidents" ADD COLUMN "journal_entry_id" UUID;
CREATE UNIQUE INDEX "refund_reconciliation_incidents_journal_entry_id_key" ON "refund_reconciliation_incidents"("journal_entry_id");
ALTER TABLE "refund_reconciliation_incidents" ADD CONSTRAINT "refund_reconciliation_incidents_journal_entry_id_fkey"
  FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill-safety: since this is a brand-new column on a table with
-- no legacy rows possible yet (the feature only shipped this same
-- 7E cycle), enforce NOT NULL directly — every incident from this
-- point forward must carry its journal reference at creation time.
ALTER TABLE "refund_reconciliation_incidents" ALTER COLUMN "journal_entry_id" SET NOT NULL;

-- -------------------------------------------------------------------
-- Deferred check: every SUCCEEDED RefundAttempt beyond the FIRST one
-- for a given RefundObligation must have a matching
-- refund_reconciliation_incidents row. (The first SUCCEEDED attempt
-- is the one that legitimately completed the obligation via the
-- normal REFUND_EXECUTED journal — it needs no incident.)
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_extra_succeeded_attempts_have_incidents()
RETURNS TRIGGER AS $$
DECLARE
  v_refund_obligation_id UUID;
  v_succeeded_count INT;
  v_incident_count INT;
BEGIN
  SELECT "refund_obligation_id" INTO v_refund_obligation_id FROM "refund_attempts" WHERE "id" = NEW."id";

  SELECT COUNT(*) INTO v_succeeded_count FROM "refund_attempts"
    WHERE "refund_obligation_id" = v_refund_obligation_id AND "status" = 'SUCCEEDED';
  SELECT COUNT(*) INTO v_incident_count FROM "refund_reconciliation_incidents"
    WHERE "refund_obligation_id" = v_refund_obligation_id;

  IF v_succeeded_count > 1 AND v_incident_count != (v_succeeded_count - 1) THEN
    RAISE EXCEPTION 'refund_attempts: % SUCCEEDED attempts exist for refund_obligation_id=% but only % reconciliation incidents — every attempt beyond the first must have one', v_succeeded_count, v_refund_obligation_id, v_incident_count;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_extra_succeeded_attempts_have_incidents
  AFTER INSERT OR UPDATE ON "refund_attempts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_extra_succeeded_attempts_have_incidents();
