ALTER TABLE "checkout_sessions" DROP CONSTRAINT "checkout_sessions_status_release_consistency";

ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_status_release_consistency"
  CHECK (
    ("status" = 'LOCKED' AND "lock_released_at" IS NULL AND "release_reason" IS NULL AND "captured_at" IS NULL)
    OR
    ("status" = 'PAYMENT_PENDING' AND "lock_released_at" IS NULL AND "release_reason" IS NULL AND "captured_at" IS NULL)
    OR
    ("status" = 'EXPIRED' AND "lock_released_at" IS NOT NULL AND "release_reason" IS NOT NULL AND "release_reason" = 'EXPIRED' AND "captured_at" IS NULL)
    OR
    ("status" = 'ABANDONED' AND "lock_released_at" IS NOT NULL AND "release_reason" IS NOT NULL AND "release_reason" IN ('TRADER_ABANDONED', 'OPPORTUNITY_CANCELLED', 'ADMIN_ABANDONED') AND "captured_at" IS NULL)
    OR
    ("status" = 'PAID' AND "lock_released_at" IS NOT NULL AND "release_reason" IS NULL AND "captured_at" IS NOT NULL)
  );

ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_payment_deadline_consistency"
  CHECK (
    ("status" != 'LOCKED' OR "payment_deadline_at" IS NULL)
    AND
    ("status" != 'PAYMENT_PENDING' OR "payment_deadline_at" IS NOT NULL)
    AND
    ("status" != 'PAID' OR "payment_deadline_at" IS NOT NULL)
  );
