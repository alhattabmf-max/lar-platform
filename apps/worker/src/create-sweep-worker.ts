import { PrismaClient } from "@prisma/client";
import { Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import type { Logger } from "pino";
import { OPPORTUNITY_SWEEP_QUEUE_NAME, OPPORTUNITY_SWEEP_JOB_NAME } from "./sweep-scheduler";
import { processSweepJob } from "./sweep-processor";

/**
 * concurrency: 1 — this worker PROCESS never runs two sweep passes at
 * once. Cross-process safety between multiple worker instances
 * remains the job of FOR UPDATE SKIP LOCKED inside
 * runOpportunityLifecycleSweep itself — deliberately not
 * re-implemented here with a Redis-based distributed lock.
 *
 * processorOverride exists solely for tests (e.g. an artificially
 * slow processor to exercise graceful shutdown) — production code
 * never passes it, so the real path always runs processSweepJob.
 */
export function createSweepWorker(
  prisma: PrismaClient,
  connection: Redis,
  logger: Logger,
  options?: { processorOverride?: (job: Job) => Promise<unknown> }
): Worker {
  const processor =
    options?.processorOverride ??
    (async (job: Job) => {
      if (job.name !== OPPORTUNITY_SWEEP_JOB_NAME) return;
      await processSweepJob(prisma, logger);
    });

  const worker = new Worker(OPPORTUNITY_SWEEP_QUEUE_NAME, processor, { connection, concurrency: 1 });

  worker.on("failed", (job, err) => {
    logger.error(
      { event: "opportunity_sweep_job_failed", jobId: job?.id, attemptsMade: job?.attemptsMade, error: err.message },
      "sweep job failed"
    );
  });

  return worker;
}
