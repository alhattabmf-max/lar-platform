import type { PrismaClient } from "@prisma/client";
import { Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import type { Logger } from "pino";
import type { EmailProvider } from "@platform/email";
import { OUTBOX_RELAY_QUEUE_NAME, OUTBOX_RELAY_JOB_NAME } from "./outbox-relay-scheduler";
import { runOutboxRelayPass } from "./outbox/outbox-relay-processor";

/**
 * `concurrency: 1` — this PROCESS never runs two relay passes at once.
 *
 * Safety BETWEEN processes stays where it already is for every other
 * sweep: `FOR UPDATE SKIP LOCKED` inside the claim itself. No
 * Redis-based distributed lock is introduced, deliberately — the
 * database already serialises the only thing that needs serialising,
 * and a second mechanism would be a second thing to get wrong.
 *
 * The abort controller is the shutdown path. `stopClaiming()` prevents
 * a new pass from starting, and `abortInFlight()` cancels provider
 * calls that are still outstanding when the grace period expires. Rows
 * left mid-flight stay PROCESSING and are recovered by lease expiry —
 * a bounded delay, never a lost event.
 */
export interface OutboxRelayWorkerHandle {
  worker: Worker;
  /** Refuse to begin another pass. Already-running work continues. */
  stopClaiming(): void;
  /** Cancel provider calls still outstanding. */
  abortInFlight(): void;
}

export function createOutboxRelayWorker(
  prisma: PrismaClient,
  provider: EmailProvider,
  connection: Redis,
  logger: Logger,
  options?: { workerId?: string; processorOverride?: (job: Job) => Promise<unknown> }
): OutboxRelayWorkerHandle {
  // Identifies the claiming process in `locked_by`. Observability only —
  // never a correctness guard, because the same id can re-claim a row
  // after its lease expires.
  const workerId = options?.workerId ?? `relay-${process.pid}`;

  const controller = new AbortController();
  let claiming = true;

  const processor =
    options?.processorOverride ??
    (async (job: Job) => {
      if (job.name !== OUTBOX_RELAY_JOB_NAME) return;
      // Checked at the START of the pass: a job that BullMQ delivered
      // just as shutdown began must not claim new rows and lease them
      // to a process that is about to exit.
      if (!claiming) {
        logger.info({ event: "outbox_relay_pass_skipped" }, "shutting down; not claiming");
        return;
      }
      await runOutboxRelayPass(
        { prisma, provider, logger },
        { lockedBy: workerId, signal: controller.signal }
      );
    });

  const worker = new Worker(OUTBOX_RELAY_QUEUE_NAME, processor, { connection, concurrency: 1 });

  // `_err` is received and deliberately DISCARDED. A provider exception
  // routinely echoes the recipient address, so its message must not
  // reach a log line; the underscore states that the omission is
  // intentional rather than an oversight.
  worker.on("failed", (job, _err) => {
    // Only the job identity and BullMQ's own attempt counter are safe.
    logger.error(
      { event: "outbox_relay_job_failed", jobId: job?.id, attemptsMade: job?.attemptsMade },
      "outbox relay job failed"
    );
  });

  return {
    worker,
    stopClaiming: () => {
      claiming = false;
    },
    abortInFlight: () => controller.abort(),
  };
}
