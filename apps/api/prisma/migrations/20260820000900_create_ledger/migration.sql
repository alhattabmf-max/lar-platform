CREATE TYPE "LedgerAccount" AS ENUM ('CASH_CLEARING', 'SUPPLIER_PAYABLE', 'PLATFORM_COMMISSION_REVENUE', 'COMMISSION_TAX_PAYABLE', 'SHIPPING_LIABILITY', 'CUSTOMER_REFUND_PAYABLE', 'PAYMENT_PROCESSING_FEE_EXPENSE');
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_type" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "journal_entries_idempotency_key_key" ON "journal_entries"("idempotency_key");

CREATE TABLE "ledger_postings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "journal_entry_id" UUID NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ledger_postings_journal_entry_id_idx" ON "ledger_postings"("journal_entry_id");

ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_currency_sar" CHECK ("currency" = 'SAR');

ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_journal_entry_id_fkey"
  FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_journal_entry_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'journal_entries: rows are append-only and cannot be modified or deleted (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_journal_entry_mutation
  BEFORE UPDATE OR DELETE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION prevent_journal_entry_mutation();

CREATE OR REPLACE FUNCTION prevent_ledger_posting_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ledger_postings: rows are append-only and cannot be modified or deleted (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_ledger_posting_mutation
  BEFORE UPDATE OR DELETE ON "ledger_postings"
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_posting_mutation();

CREATE OR REPLACE FUNCTION check_journal_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_entry_id UUID;
  v_debit_sum DECIMAL(14,2);
  v_credit_sum DECIMAL(14,2);
  v_posting_count INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_journal_entry_id := OLD.journal_entry_id;
  ELSE
    v_journal_entry_id := NEW.journal_entry_id;
  END IF;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0),
    COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0),
    COUNT(*)
  INTO v_debit_sum, v_credit_sum, v_posting_count
  FROM ledger_postings WHERE journal_entry_id = v_journal_entry_id;

  IF v_posting_count < 2 THEN
    RAISE EXCEPTION 'journal_entries: entry % must have at least 2 postings, has %', v_journal_entry_id, v_posting_count;
  END IF;

  IF v_debit_sum != v_credit_sum THEN
    RAISE EXCEPTION 'journal_entries: entry % is unbalanced — debit=%, credit=%', v_journal_entry_id, v_debit_sum, v_credit_sum;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_journal_entry_balance
  AFTER INSERT OR UPDATE OR DELETE ON "ledger_postings"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_entry_balance();
