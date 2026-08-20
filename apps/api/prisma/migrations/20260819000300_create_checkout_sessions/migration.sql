CREATE TABLE "checkout_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "trader_company_id" UUID NOT NULL,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'LOCKED',
    "locked_quantity" INTEGER NOT NULL,
    "lock_created_at" TIMESTAMPTZ(3) NOT NULL,
    "lock_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "lock_released_at" TIMESTAMPTZ(3),
    "release_reason" "CheckoutLockReleaseReason",
    "trader_company_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "checkout_sessions_opportunity_id_idx" ON "checkout_sessions"("opportunity_id");
CREATE INDEX "checkout_sessions_trader_company_id_idx" ON "checkout_sessions"("trader_company_id");

ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_opportunity_id_fkey"
  FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_trader_company_id_fkey"
  FOREIGN KEY ("trader_company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_locked_quantity_positive"
  CHECK ("locked_quantity" > 0);
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_lock_expires_after_created"
  CHECK ("lock_expires_at" > "lock_created_at");

CREATE UNIQUE INDEX "checkout_sessions_one_active_lock_per_trader_opportunity"
  ON "checkout_sessions"("opportunity_id", "trader_company_id")
  WHERE "lock_released_at" IS NULL;

ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_status_release_consistency"
  CHECK (
    ("status" = 'LOCKED' AND "lock_released_at" IS NULL AND "release_reason" IS NULL)
    OR
    ("status" = 'EXPIRED' AND "lock_released_at" IS NOT NULL AND "release_reason" = 'EXPIRED')
    OR
    ("status" = 'ABANDONED' AND "lock_released_at" IS NOT NULL AND "release_reason" IN ('TRADER_ABANDONED', 'OPPORTUNITY_CANCELLED', 'ADMIN_ABANDONED'))
  );
