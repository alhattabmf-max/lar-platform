import { PrismaClient } from "@prisma/client";
import pino from "pino";
import { assertEmailDeliveryConfigured, loadEnv } from "@platform/config";
import { MockEmailProvider } from "@platform/email";
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
import {
  OUTBOX_RELAY_QUEUE_NAME,
  OUTBOX_RELAY_JOB_NAME,
  createOutboxRelayQueue,
  scheduleOutboxRelayJob,
} from "./outbox-relay-scheduler";
import { createOutboxRelayWorker } from "./create-outbox-relay-worker";
import { createShutdownHandler } from "./shutdown";

/**
 * How long in-flight provider calls get to finish on SIGTERM before
 * they are aborted. Comfortably above PROVIDER_TIMEOUT_MS (20s) so an
 * ordinary send completes, and well below any orchestrator's own kill
 * timeout.
 */
const SHUTDOWN_GRACE_MS = 25_000;

async function main(): Promise<void> {
  const env = loadEnv(process.env);

  // Runs BEFORE the logger, Prisma or Redis: this process will host the
  // email relay, so a misconfigured provider must stop it here rather
  // than after it has connected and started claiming work. The API
  // performs the identical check in configureApp.
  assertEmailDeliveryConfigured(env);

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
  const relayQueueConnection = createBullMqRedisConnection(env);
  const relayWorkerConnection = createBullMqRedisConnection(env);
  await Promise.all([
    opportunityQueueConnection.connect(),
    opportunityWorkerConnection.connect(),
    checkoutQueueConnection.connect(),
    checkoutWorkerConnection.connect(),
    paymentQueueConnection.connect(),
    paymentWorkerConnection.connect(),
    relayQueueConnection.connect(),
    relayWorkerConnection.connect(),
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

  const relayQueue = createOutboxRelayQueue(relayQueueConnection);
  await scheduleOutboxRelayJob(relayQueue);
  logger.info(
    { queue: OUTBOX_RELAY_QUEUE_NAME, job: OUTBOX_RELAY_JOB_NAME, providerMode: env.EMAIL_PROVIDER_MODE },
    "Outbox email relay scheduled (every minute)"
  );

  const opportunityWorker = createSweepWorker(prisma, opportunityWorkerConnection, logger);
  const checkoutWorker = createCheckoutLockExpiryWorker(prisma, checkoutWorkerConnection, logger);
  const paymentWorker = createPaymentPendingExpiryWorker(prisma, paymentWorkerConnection, logger);

  // The provider comes from the SHARED package, identical to the one the
  // API binds into Nest. Its sink emits a closed four-key record — no
  // address, no subject, no body.
  const emailProvider = new MockEmailProvider((record) =>
    logger.info({ event: "email_provider_send", ...record }, "email provider invoked")
  );
  const relay = createOutboxRelayWorker(prisma, emailProvider, relayWorkerConnection, logger);

  const shutdown = createShutdownHandler({
    workers: [opportunityWorker, checkoutWorker, paymentWorker, relay.worker],
    queues: [opportunityQueue, checkoutQueue, paymentQueue, relayQueue],
    workerConnections: [
      opportunityWorkerConnection,
      checkoutWorkerConnection,
      paymentWorkerConnection,
      relayWorkerConnection,
    ],
    queueConnections: [
      opportunityQueueConnection,
      checkoutQueueConnection,
      paymentQueueConnection,
      relayQueueConnection,
    ],
    prisma,
    logger,
    // Stop leasing new rows before draining, then abort any provider
    // call still outstanding when the grace period runs out.
    onShutdownStart: () => relay.stopClaiming(),
    gracePeriodMs: SHUTDOWN_GRACE_MS,
    onGraceExpired: () => relay.abortInFlight(),
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error starting worker:", err);
  process.exit(1);
});
