-- Phase 6 — optional idempotency key on outbox_events. Nullable
-- (most events rely on the WHERE-guarded atomic UPDATE that produced
-- them for uniqueness); a partial unique index enforces true
-- one-time-only semantics for the events that need it explicitly
-- (e.g. OPPORTUNITY_ACTIVATED, which can only legitimately happen
-- once per opportunity).

ALTER TABLE "outbox_events" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "outbox_events_idempotency_key_unique"
  ON "outbox_events" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
