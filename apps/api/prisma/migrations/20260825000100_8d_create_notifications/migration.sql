-- Phase 8D — notifications.
--
-- Two new tables and one enum. Nothing existing is altered: no column
-- is added to an existing table, no row is read or written, and no
-- constraint is placed on anything that already exists.
--
-- TWO TABLES, not one. Read state is a property of the (notification,
-- user) PAIR — a single read_at on the notification would let one
-- colleague's read clear everyone else's unread badge.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'ORDER_CREATED',
  'ALLOCATION_PREPARATION_STARTED',
  'ALLOCATION_READY',
  'ALLOCATION_SHIPPED',
  'ALLOCATION_DELIVERED',
  'MASTER_ORDER_FULFILLED',
  'DISPUTE_OPENED',
  'DISPUTE_SUPPLIER_RESPONDED',
  'DISPUTE_DECIDED',
  'REFUND_INITIATED',
  'REFUND_FAILED',
  'REPLACEMENT_REQUIRED',
  'REPLACEMENT_SHIPPED',
  'REPLACEMENT_DELIVERED',
  'REPLACEMENT_FAILED',
  'SETTLEMENT_EXECUTED'
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "params" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_recipients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3),

    CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id")
);

-- Deduplication, enforced by the DATABASE.
--
-- This is the load-bearing constraint of the whole notifications
-- design. Two transactions reprocessing the same business event collide
-- here and the loser no-ops; an application-level "does it already
-- exist?" check would have a window between the read and the write that
-- concurrency walks straight through.
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- The company feed, newest first.
CREATE INDEX "notifications_company_id_created_at_idx"
  ON "notifications"("company_id", "created_at");

-- One row per (notification, user). Also what makes recipient
-- expansion safely re-runnable: a second attempt collides instead of
-- duplicating a person's copy.
CREATE UNIQUE INDEX "notification_recipients_notification_id_user_id_key"
  ON "notification_recipients"("notification_id", "user_id");

-- Serves the unread badge, which is read on nearly every page load and
-- must not scan a user's whole history to count zero.
CREATE INDEX "notification_recipients_user_id_read_at_idx"
  ON "notification_recipients"("user_id", "read_at");

-- AddForeignKey
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notification_recipients"
  ADD CONSTRAINT "notification_recipients_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notification_recipients"
  ADD CONSTRAINT "notification_recipients_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
