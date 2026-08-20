-- Fixes a real gap discovered by direct constraint-breaking tests:
-- Postgres CHECK constraints only REJECT a row when the expression
-- evaluates to FALSE — an expression that evaluates to NULL is
-- treated as PASSING. The original constraint's ABANDONED branch was
-- `release_reason IN ('TRADER_ABANDONED', ...)`, which evaluates to
-- NULL (not FALSE) when release_reason IS NULL — so a row with
-- status='ABANDONED', lock_released_at=<set>, release_reason=NULL
-- was silently ACCEPTED instead of rejected. Same latent risk existed
-- in principle for the EXPIRED branch's release_reason = 'EXPIRED'
-- comparison. Adding an explicit IS NOT NULL check to both closes the
-- gap unconditionally.

ALTER TABLE "checkout_sessions" DROP CONSTRAINT "checkout_sessions_status_release_consistency";

ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_status_release_consistency"
  CHECK (
    ("status" = 'LOCKED' AND "lock_released_at" IS NULL AND "release_reason" IS NULL)
    OR
    ("status" = 'EXPIRED' AND "lock_released_at" IS NOT NULL AND "release_reason" IS NOT NULL AND "release_reason" = 'EXPIRED')
    OR
    ("status" = 'ABANDONED' AND "lock_released_at" IS NOT NULL AND "release_reason" IS NOT NULL AND "release_reason" IN ('TRADER_ABANDONED', 'OPPORTUNITY_CANCELLED', 'ADMIN_ABANDONED'))
  );
