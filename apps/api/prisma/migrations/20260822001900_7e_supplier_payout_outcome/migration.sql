CREATE TYPE "SupplierPayoutOutcome" AS ENUM ('EXECUTED', 'ZERO_BALANCE');

ALTER TABLE "supplier_payouts" ALTER COLUMN "external_transfer_reference" DROP NOT NULL;
ALTER TABLE "supplier_payouts" ADD COLUMN "outcome" "SupplierPayoutOutcome" NOT NULL DEFAULT 'EXECUTED';
ALTER TABLE "supplier_payouts" ALTER COLUMN "outcome" DROP DEFAULT;

-- Row-level shape: EXECUTED requires a positive amount and a
-- reference; ZERO_BALANCE requires exactly zero and no invented
-- reference. Never both, never neither.
ALTER TABLE "supplier_payouts" ADD CONSTRAINT "supplier_payouts_outcome_shape"
  CHECK (
    ("outcome" = 'EXECUTED' AND "net_amount" > 0 AND "external_transfer_reference" IS NOT NULL)
    OR ("outcome" = 'ZERO_BALANCE' AND "net_amount" = 0 AND "external_transfer_reference" IS NULL)
  );

-- -------------------------------------------------------------------
-- Deferred: EXECUTED requires exactly one balanced SUPPLIER_SETTLEMENT
-- journal entry whose CASH_CLEARING credit equals netAmount; ZERO_BALANCE
-- requires NONE.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_supplier_payout_journal_consistency()
RETURNS TRIGGER AS $$
DECLARE
  v_journal_count INT;
  v_journal_id UUID;
  v_credit_sum DECIMAL(14,2);
BEGIN
  SELECT COUNT(*) INTO v_journal_count FROM "journal_entries"
    WHERE "reference_type" = 'supplier_payout' AND "reference_id" = NEW."id" AND "event_type" = 'SUPPLIER_SETTLEMENT';

  IF NEW."outcome" = 'ZERO_BALANCE' THEN
    IF v_journal_count != 0 THEN
      RAISE EXCEPTION 'supplier_payouts: ZERO_BALANCE outcome must have NO settlement journal entry, found % (id=%)', v_journal_count, NEW."id";
    END IF;
    RETURN NULL;
  END IF;

  -- EXECUTED
  IF v_journal_count != 1 THEN
    RAISE EXCEPTION 'supplier_payouts: EXECUTED outcome requires exactly one settlement journal entry, found % (id=%)', v_journal_count, NEW."id";
  END IF;

  SELECT "id" INTO v_journal_id FROM "journal_entries"
    WHERE "reference_type" = 'supplier_payout' AND "reference_id" = NEW."id" AND "event_type" = 'SUPPLIER_SETTLEMENT';
  SELECT COALESCE(SUM("amount"), 0) INTO v_credit_sum FROM "ledger_postings"
    WHERE "journal_entry_id" = v_journal_id AND "account" = 'CASH_CLEARING' AND "direction" = 'CREDIT';

  IF v_credit_sum != NEW."net_amount" THEN
    RAISE EXCEPTION 'supplier_payouts: settlement journal CASH_CLEARING credit (%) does not match net_amount (%) for id=%', v_credit_sum, NEW."net_amount", NEW."id";
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_supplier_payout_journal_consistency
  AFTER INSERT ON "supplier_payouts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_supplier_payout_journal_consistency();

-- -------------------------------------------------------------------
-- Deferred: supplierBankAccountId must match the FROZEN
-- MasterOrder.supplierBankAccountId (via order_allocation), never
-- Company.activeBankAccountId — even if the company's active account
-- changed after payment.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_supplier_payout_bank_account_frozen()
RETURNS TRIGGER AS $$
DECLARE
  v_frozen_bank_account_id UUID;
BEGIN
  SELECT mo."supplier_bank_account_id" INTO v_frozen_bank_account_id
    FROM "order_allocations" oa JOIN "master_orders" mo ON mo."id" = oa."master_order_id"
    WHERE oa."id" = NEW."order_allocation_id";

  IF NEW."supplier_bank_account_id" != v_frozen_bank_account_id THEN
    RAISE EXCEPTION 'supplier_payouts: supplier_bank_account_id (%) does not match the frozen master_orders.supplier_bank_account_id (%) for id=%', NEW."supplier_bank_account_id", v_frozen_bank_account_id, NEW."id";
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_supplier_payout_bank_account_frozen
  AFTER INSERT ON "supplier_payouts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_supplier_payout_bank_account_frozen();
