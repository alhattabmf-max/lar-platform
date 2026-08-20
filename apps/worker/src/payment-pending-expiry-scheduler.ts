import { Queue } from "bullmq";
import type Redis from "ioredis";

/**
 * A THIRD, entirely separate queue/job — PAYMENT_PENDING expiry
 * (Phase 7C) is its own domain concern with its own worker, own
 * graceful shutdown, never merged into either the opportunity sweep
 * or the checkout-LOCKED-expiry sweep's queue/job/scheduler.
 */
export const PAYMENT_PENDING_EXPIRY_QUEUE_NAME = "payment-pending-expiry-sweep-queue";
export const PAYMENT_PENDING_EXPIRY_JOB_NAME = "payment-pending-expiry-sweep";

export async function schedulePaymentPendingExpiryJob(queue: Queue): Promise<void> {
  await queue.add(
    PAYMENT_PENDING_EXPIRY_JOB_NAME,
    {},
    {
      repeat: { pattern: "* * * * *" },
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  );
}

export function createPaymentPendingExpiryQueue(connection: Redis): Queue {
  return new Queue(PAYMENT_PENDING_EXPIRY_QUEUE_NAME, { connection });
}
