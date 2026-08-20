import { PrismaClient } from "@prisma/client";
import pino from "pino";
import { loadEnv } from "@platform/config";
import { createBullMqRedisConnection } from "../src/redis-connection";
import { OPPORTUNITY_SWEEP_JOB_NAME, createOpportunitySweepQueue } from "../src/sweep-scheduler";
import { createSweepWorker } from "../src/create-sweep-worker";
import { CHECKOUT_LOCK_EXPIRY_JOB_NAME, createCheckoutLockExpiryQueue } from "../src/checkout-lock-expiry-scheduler";
import { createCheckoutLockExpiryWorker } from "../src/create-checkout-lock-expiry-worker";
import { createShutdownHandler } from "../src/shutdown";

const env = loadEnv(process.env);
const logger = pino({ level: "silent" });

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("Worker graceful shutdown — waits for the in-flight job, idempotent on double-call (integration, real Redis + Postgres)", () => {
  it("shutdown invoked mid-job waits for that job to finish, then closes worker/queue/connections/prisma; a concurrent second call is a safe no-op", async () => {
    const prisma = new PrismaClient();
    await prisma.$connect();

    const queueConnection = createBullMqRedisConnection(env);
    const workerConnection = createBullMqRedisConnection(env);
    await queueConnection.connect();
    await workerConnection.connect();

    const queue = createOpportunitySweepQueue(queueConnection);
    await queue.obliterate({ force: true }).catch(() => undefined);

    let jobStarted = false;
    let jobFinished = false;
    let jobWasAbortedEarly = false;

    const worker = createSweepWorker(prisma, workerConnection, logger, {
      processorOverride: async () => {
        jobStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        jobFinished = true;
      },
    });

    const onExit = jest.fn();
    const shutdown = createShutdownHandler({
      workers: [worker],
      queues: [queue],
      workerConnections: [workerConnection],
      queueConnections: [queueConnection],
      prisma,
      logger,
      onExit,
    });

    await queue.add(OPPORTUNITY_SWEEP_JOB_NAME, {});
    await waitUntil(() => jobStarted, 5000);

    if (jobFinished) jobWasAbortedEarly = true;
    const shutdownCall1 = shutdown("SIGTERM");
    const shutdownCall2 = shutdown("SIGTERM");

    await Promise.all([shutdownCall1, shutdownCall2]);

    expect(jobWasAbortedEarly).toBe(false);
    expect(jobFinished).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);

    expect(["end", "close"]).toContain(workerConnection.status);
    expect(["end", "close"]).toContain(queueConnection.status);

    await expect(shutdown("SIGINT")).resolves.toBeUndefined();
    expect(onExit).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("a single shutdown handler closes BOTH independent workers (opportunity sweep + checkout lock expiry) together, each waiting for its own in-flight job", async () => {
    const prisma = new PrismaClient();
    await prisma.$connect();

    const oppQueueConnection = createBullMqRedisConnection(env);
    const oppWorkerConnection = createBullMqRedisConnection(env);
    const checkoutQueueConnection = createBullMqRedisConnection(env);
    const checkoutWorkerConnection = createBullMqRedisConnection(env);
    await Promise.all([
      oppQueueConnection.connect(),
      oppWorkerConnection.connect(),
      checkoutQueueConnection.connect(),
      checkoutWorkerConnection.connect(),
    ]);

    const oppQueue = createOpportunitySweepQueue(oppQueueConnection);
    const checkoutQueue = createCheckoutLockExpiryQueue(checkoutQueueConnection);
    await oppQueue.obliterate({ force: true }).catch(() => undefined);
    await checkoutQueue.obliterate({ force: true }).catch(() => undefined);

    let oppJobFinished = false;
    let checkoutJobFinished = false;

    const oppWorker = createSweepWorker(prisma, oppWorkerConnection, logger, {
      processorOverride: async () => {
        await new Promise((r) => setTimeout(r, 800));
        oppJobFinished = true;
      },
    });
    const checkoutWorker = createCheckoutLockExpiryWorker(prisma, checkoutWorkerConnection, logger, {
      processorOverride: async () => {
        await new Promise((r) => setTimeout(r, 800));
        checkoutJobFinished = true;
      },
    });

    const onExit = jest.fn();
    const shutdown = createShutdownHandler({
      workers: [oppWorker, checkoutWorker],
      queues: [oppQueue, checkoutQueue],
      workerConnections: [oppWorkerConnection, checkoutWorkerConnection],
      queueConnections: [oppQueueConnection, checkoutQueueConnection],
      prisma,
      logger,
      onExit,
    });

    await oppQueue.add(OPPORTUNITY_SWEEP_JOB_NAME, {});
    await checkoutQueue.add(CHECKOUT_LOCK_EXPIRY_JOB_NAME, {});
    await new Promise((r) => setTimeout(r, 100)); // let both jobs actually start

    await shutdown("SIGTERM");

    expect(oppJobFinished).toBe(true);
    expect(checkoutJobFinished).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(["end", "close"]).toContain(oppWorkerConnection.status);
    expect(["end", "close"]).toContain(checkoutWorkerConnection.status);
  }, 20_000);
});
