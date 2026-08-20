import { Queue } from "bullmq";
import type Redis from "ioredis";

/** Fixed names — never derived from environment or runtime state, so every worker instance and every restart resolves to the exact same repeatable job registration (BullMQ deduplicates by these). */
export const OPPORTUNITY_SWEEP_QUEUE_NAME = "opportunity-lifecycle-sweep-queue";
export const OPPORTUNITY_SWEEP_JOB_NAME = "opportunity-lifecycle-sweep";

/**
 * Registers the repeatable sweep job — every minute, on the wall-clock
 * minute boundary (cron "* * * * *"), never interval-from-now-based.
 * Safe to call on every worker startup: BullMQ computes a deterministic
 * key from (job name + repeat options), so calling this from multiple
 * worker processes, or repeatedly across restarts, never creates
 * duplicate repeatable registrations.
 *
 * attempts/backoff cover operational failures (a dropped DB
 * connection mid-run, etc.) — never a reason to re-run a COMPLETED
 * transition: runOpportunityLifecycleSweep's own batch queries always
 * re-select only rows still matching their WHERE condition right now,
 * so a retried attempt naturally skips every row an earlier attempt
 * already committed, and therefore never produces a duplicate Audit
 * or Outbox entry for it.
 */
export async function scheduleOpportunitySweepJob(queue: Queue): Promise<void> {
  await queue.add(
    OPPORTUNITY_SWEEP_JOB_NAME,
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

export function createOpportunitySweepQueue(connection: Redis): Queue {
  return new Queue(OPPORTUNITY_SWEEP_QUEUE_NAME, { connection });
}
