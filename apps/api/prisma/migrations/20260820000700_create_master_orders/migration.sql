CREATE TYPE "MasterOrderStatus" AS ENUM ('IN_FULFILLMENT');

CREATE TABLE "master_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checkout_session_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "trader_company_id" UUID NOT NULL,
    "supplier_company_id" UUID NOT NULL,
    "payment_attempt_id" UUID NOT NULL,
    "supplier_bank_account_id" UUID NOT NULL,
    "status" "MasterOrderStatus" NOT NULL DEFAULT 'IN_FULFILLMENT',
    "total_amount" DECIMAL(14,2) NOT NULL,
    "commission_base" DECIMAL(14,2) NOT NULL,
    "commission_rate_basis_points" INTEGER NOT NULL,
    "commission_amount" DECIMAL(14,2) NOT NULL,
    "commission_tax_rate" DECIMAL(5,2) NOT NULL,
    "commission_tax_rule_code" TEXT NOT NULL,
    "commission_tax_rule_version" TEXT NOT NULL,
    "commission_tax_amount" DECIMAL(14,2) NOT NULL,
    "supplier_payable_amount" DECIMAL(14,2) NOT NULL,
    "supplier_legal_name_snapshot" TEXT NOT NULL,
    "supplier_cr_number_snapshot" TEXT NOT NULL,
    "supplier_tax_profile_snapshot" JSONB NOT NULL,
    "supplier_invoicing_profile_snapshot" JSONB NOT NULL,
    "policy_acceptance_id" UUID,
    "accepted_by_user_id" UUID,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "master_orders_checkout_session_id_key" ON "master_orders"("checkout_session_id");
CREATE UNIQUE INDEX "master_orders_payment_attempt_id_key" ON "master_orders"("payment_attempt_id");
CREATE INDEX "master_orders_opportunity_id_idx" ON "master_orders"("opportunity_id");
CREATE INDEX "master_orders_trader_company_id_idx" ON "master_orders"("trader_company_id");
CREATE INDEX "master_orders_supplier_company_id_idx" ON "master_orders"("supplier_company_id");

ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_commission_rate_range"
  CHECK ("commission_rate_basis_points" >= 0 AND "commission_rate_basis_points" <= 10000);
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_commission_tax_rate_range"
  CHECK ("commission_tax_rate" >= 0 AND "commission_tax_rate" <= 100);
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_supplier_payable_equation"
  CHECK ("supplier_payable_amount" = "total_amount" - "commission_amount" - "commission_tax_amount");

ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_checkout_session_id_fkey"
  FOREIGN KEY ("checkout_session_id") REFERENCES "checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_payment_attempt_id_fkey"
  FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "master_orders" ADD CONSTRAINT "master_orders_supplier_bank_account_id_fkey"
  FOREIGN KEY ("supplier_bank_account_id") REFERENCES "supplier_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_master_order_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'master_orders: rows cannot be deleted (id=%)', OLD."id";
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'master_orders: core fields are frozen after creation (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_master_order_mutation
  BEFORE UPDATE OR DELETE ON "master_orders"
  FOR EACH ROW EXECUTE FUNCTION prevent_master_order_mutation();
