import { Queue } from "bullmq";
import type Redis from "ioredis";

/**
 * A SEPARATE queue and job from the three lifecycle sweeps.
 *
 * The relay is its own domain concern with its own structural
 * table-isolation contract (`outbox_events` read/write, `users` read),
 * its own shutdown behaviour, and its own failure semantics. It is
 * never merged into another sweep's queue.
 */
export const OUTBOX_RELAY_QUEUE_NAME = "outbox-relay-queue";
export const OUTBOX_RELAY_JOB_NAME = "outbox-relay";

/**
 * Registers the repeatable pass — every minute, wall-clock aligned.
 *
 * Safe to call on every startup and from every worker process: BullMQ
 * derives a deterministic repeat key from (job name + repeat options),
 * so re-registering across restarts or across replicas never produces a
 * second schedule. `jobId` is pinned for the same reason, so the
 * identity is explicit rather than inferred.
 *
 * `attempts: 1` is deliberate and differs from the lifecycle sweeps.
 * BullMQ-level retries would start a SECOND pass while the first may
 * still hold leases, and the relay already has its own retry policy in
 * the database — `next_attempt_at` with backoff, bounded by
 * MAX_ATTEMPTS. Retrying the job as well would layer a second,
 * uncoordinated retry loop on top of it.
 */
export async function scheduleOutboxRelayJob(queue: Queue): Promise<void> {
  await queue.add(
    OUTBOX_RELAY_JOB_NAME,
    {},
    {
      jobId: OUTBOX_RELAY_JOB_NAME,
      repeat: { pattern: "* * * * *" },
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
    }
  );
}

export function createOutboxRelayQueue(connection: Redis): Queue {
  return new Queue(OUTBOX_RELAY_QUEUE_NAME, { connection });
}
