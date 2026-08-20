import { PrismaClient } from "@prisma/client";
import { Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import type { Logger } from "pino";
import { PAYMENT_PENDING_EXPIRY_QUEUE_NAME, PAYMENT_PENDING_EXPIRY_JOB_NAME } from "./payment-pending-expiry-scheduler";
import { processPaymentPendingExpiryJob } from "./payment-pending-expiry-processor";

export function createPaymentPendingExpiryWorker(
  prisma: PrismaClient,
  connection: Redis,
  logger: Logger,
  options?: { processorOverride?: (job: Job) => Promise<unknown> }
): Worker {
  const processor =
    options?.processorOverride ??
    (async (job: Job) => {
      if (job.name !== PAYMENT_PENDING_EXPIRY_JOB_NAME) return;
      await processPaymentPendingExpiryJob(prisma, logger);
    });

  const worker = new Worker(PAYMENT_PENDING_EXPIRY_QUEUE_NAME, processor, { connection, concurrency: 1 });

  worker.on("failed", (job, err) => {
    logger.error(
      { event: "payment_pending_expiry_job_failed", jobId: job?.id, attemptsMade: job?.attemptsMade, error: err.message },
      "payment pending expiry job failed"
    );
  });

  return worker;
}
