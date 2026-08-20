ALTER TABLE "checkout_sessions" ADD COLUMN "payment_deadline_at" TIMESTAMPTZ(3);
ALTER TABLE "checkout_sessions" ADD COLUMN "captured_at" TIMESTAMPTZ(3);
