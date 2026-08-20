-- Fixes a real design gap discovered before Phase 7B's checkout
-- idempotency logic was tested: idempotency_keys.key was globally
-- UNIQUE on its own, with `scope` present only as a descriptive
-- column, never part of any actual uniqueness guarantee. Two
-- DIFFERENT trader companies submitting the identical key string
-- (e.g. both using the same client-side UUID generator seed, or any
-- coincidental match) would have collided on this global constraint —
-- the second company would have been treated as "replaying" the
-- first company's request, risking exposure of the first company's
-- checkout session to the second. No code in the platform relied on
-- the old global-uniqueness behavior (grep-confirmed before this
-- migration was written), so this is safe to correct now.

DROP INDEX "idempotency_keys_key_key";
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");
