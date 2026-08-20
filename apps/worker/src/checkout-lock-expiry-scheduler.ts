import { Queue } from "bullmq";
import type Redis from "ioredis";

/**
 * Deliberately a SEPARATE queue/job from OPPORTUNITY_SWEEP_QUEUE_NAME —
 * Checkout lock expiry (Phase 7B) is its own domain concern with its
 * own worker, own graceful shutdown, and its own structural
 * table-isolation contract (checkout_sessions/audit_logs/outbox_events
 * only). It is never merged into the opportunity sweep's queue/job/
 * scheduler.
 */
export const CHECKOUT_LOCK_EXPIRY_QUEUE_NAME = "checkout-lock-expiry-sweep-queue";
export const CHECKOUT_LOCK_EXPIRY_JOB_NAME = "checkout-lock-expiry-sweep";

/**
 * Registers the repeatable sweep job — every minute, wall-clock
 * aligned (cron "* * * * *"). Safe to call on every worker startup:
 * BullMQ computes a deterministic key from (job name + repeat
 * options), so repeated registration across restarts or multiple
 * worker processes never creates a duplicate.
 */
export async function scheduleCheckoutLockExpiryJob(queue: Queue): Promise<void> {
  await queue.add(
    CHECKOUT_LOCK_EXPIRY_JOB_NAME,
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

export function createCheckoutLockExpiryQueue(connection: Redis): Queue {
  return new Queue(CHECKOUT_LOCK_EXPIRY_QUEUE_NAME, { connection });
}
