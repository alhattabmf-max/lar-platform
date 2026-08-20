import { PrismaClient } from "@prisma/client";
import pino from "pino";
import { loadEnv } from "@platform/config";
import { createBullMqRedisConnection } from "./redis-connection";
import {
  OPPORTUNITY_SWEEP_QUEUE_NAME,
  OPPORTUNITY_SWEEP_JOB_NAME,
  createOpportunitySweepQueue,
  scheduleOpportunitySweepJob,
} from "./sweep-scheduler";
import { createSweepWorker } from "./create-sweep-worker";
import {
  CHECKOUT_LOCK_EXPIRY_QUEUE_NAME,
  CHECKOUT_LOCK_EXPIRY_JOB_NAME,
  createCheckoutLockExpiryQueue,
  scheduleCheckoutLockExpiryJob,
} from "./checkout-lock-expiry-scheduler";
import { createCheckoutLockExpiryWorker } from "./create-checkout-lock-expiry-worker";
import {
  PAYMENT_PENDING_EXPIRY_QUEUE_NAME,
  PAYMENT_PENDING_EXPIRY_JOB_NAME,
  createPaymentPendingExpiryQueue,
  schedulePaymentPendingExpiryJob,
} from "./payment-pending-expiry-scheduler";
import { createPaymentPendingExpiryWorker } from "./create-payment-pending-expiry-worker";
import { createShutdownHandler } from "./shutdown";

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const logger = pino({ level: env.LOG_LEVEL, name: "worker" });

  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info("Worker connected to PostgreSQL");

  const opportunityQueueConnection = createBullMqRedisConnection(env);
  const opportunityWorkerConnection = createBullMqRedisConnection(env);
  const checkoutQueueConnection = createBullMqRedisConnection(env);
  const checkoutWorkerConnection = createBullMqRedisConnection(env);
  const paymentQueueConnection = createBullMqRedisConnection(env);
  const paymentWorkerConnection = createBullMqRedisConnection(env);
  await Promise.all([
    opportunityQueueConnection.connect(),
    opportunityWorkerConnection.connect(),
    checkoutQueueConnection.connect(),
    checkoutWorkerConnection.connect(),
    paymentQueueConnection.connect(),
    paymentWorkerConnection.connect(),
  ]);
  logger.info("Worker connected to Redis");

  const opportunityQueue = createOpportunitySweepQueue(opportunityQueueConnection);
  await scheduleOpportunitySweepJob(opportunityQueue);
  logger.info(
    { queue: OPPORTUNITY_SWEEP_QUEUE_NAME, job: OPPORTUNITY_SWEEP_JOB_NAME },
    "Opportunity lifecycle sweep scheduled (every minute)"
  );

  const checkoutQueue = createCheckoutLockExpiryQueue(checkoutQueueConnection);
  await scheduleCheckoutLockExpiryJob(checkoutQueue);
  logger.info(
    { queue: CHECKOUT_LOCK_EXPIRY_QUEUE_NAME, job: CHECKOUT_LOCK_EXPIRY_JOB_NAME },
    "Checkout lock expiry sweep scheduled (every minute)"
  );

  const paymentQueue = createPaymentPendingExpiryQueue(paymentQueueConnection);
  await schedulePaymentPendingExpiryJob(paymentQueue);
  logger.info(
    { queue: PAYMENT_PENDING_EXPIRY_QUEUE_NAME, job: PAYMENT_PENDING_EXPIRY_JOB_NAME },
    "Payment pending expiry sweep scheduled (every minute)"
  );

  const opportunityWorker = createSweepWorker(prisma, opportunityWorkerConnection, logger);
  const checkoutWorker = createCheckoutLockExpiryWorker(prisma, checkoutWorkerConnection, logger);
  const paymentWorker = createPaymentPendingExpiryWorker(prisma, paymentWorkerConnection, logger);

  const shutdown = createShutdownHandler({
    workers: [opportunityWorker, checkoutWorker, paymentWorker],
    queues: [opportunityQueue, checkoutQueue, paymentQueue],
    workerConnections: [opportunityWorkerConnection, checkoutWorkerConnection, paymentWorkerConnection],
    queueConnections: [opportunityQueueConnection, checkoutQueueConnection, paymentQueueConnection],
    prisma,
    logger,
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error starting worker:", err);
  process.exit(1);
});
