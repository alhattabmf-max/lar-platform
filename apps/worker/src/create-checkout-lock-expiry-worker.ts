import { PrismaClient } from "@prisma/client";
import { Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import type { Logger } from "pino";
import { CHECKOUT_LOCK_EXPIRY_QUEUE_NAME, CHECKOUT_LOCK_EXPIRY_JOB_NAME } from "./checkout-lock-expiry-scheduler";
import { processCheckoutLockExpiryJob } from "./checkout-lock-expiry-processor";

export function createCheckoutLockExpiryWorker(
  prisma: PrismaClient,
  connection: Redis,
  logger: Logger,
  options?: { processorOverride?: (job: Job) => Promise<unknown> }
): Worker {
  const processor =
    options?.processorOverride ??
    (async (job: Job) => {
      if (job.name !== CHECKOUT_LOCK_EXPIRY_JOB_NAME) return;
      await processCheckoutLockExpiryJob(prisma, logger);
    });

  const worker = new Worker(CHECKOUT_LOCK_EXPIRY_QUEUE_NAME, processor, { connection, concurrency: 1 });

  worker.on("failed", (job, err) => {
    logger.error(
      {
        event: "checkout_lock_expiry_job_failed",
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        error: err.message,
      },
      "checkout lock expiry job failed"
    );
  });

  return worker;
}
