import { PrismaClient } from "@prisma/client";
import { Queue, QueueEvents } from "bullmq";
import pino from "pino";
import { loadEnv } from "@platform/config";
import { createBullMqRedisConnection } from "../src/redis-connection";
import {
  OPPORTUNITY_SWEEP_QUEUE_NAME,
  OPPORTUNITY_SWEEP_JOB_NAME,
  createOpportunitySweepQueue,
} from "../src/sweep-scheduler";
import { createSweepWorker } from "../src/create-sweep-worker";
import { buildSharedContext, seedOpportunity, makeEligibleForActivation, type SharedContext } from "./fixtures";

const prisma = new PrismaClient();
const logger = pino({ level: "silent" });
const env = loadEnv(process.env);

async function purgeQueue(queue: Queue): Promise<void> {
  await queue.obliterate({ force: true }).catch(() => undefined);
}

describe("Worker — real BullMQ job runs the shared sweep (integration, real Redis + Postgres)", () => {
  let queueConnection: ReturnType<typeof createBullMqRedisConnection>;
  let workerConnection: ReturnType<typeof createBullMqRedisConnection>;
  let queue: Queue;
  let ctx: SharedContext;

  beforeAll(async () => {
    queueConnection = createBullMqRedisConnection(env);
    workerConnection = createBullMqRedisConnection(env);
    await queueConnection.connect();
    await workerConnection.connect();
    queue = createOpportunitySweepQueue(queueConnection);
    await purgeQueue(queue);
    ctx = await buildSharedContext(prisma);
    await makeEligibleForActivation(prisma, ctx);
  });

  afterAll(async () => {
    await purgeQueue(queue);
    await queue.close();
    workerConnection.disconnect();
    queueConnection.disconnect();
    await prisma.$disconnect();
  });

  it("a real one-off job (same name/queue as the repeatable job) actually runs the shared sweep and transitions eligible rows", async () => {
    const scheduledId = await seedOpportunity(prisma, ctx, {
      status: "SCHEDULED",
      targetQuantity: 40,
      fundedQuantity: 0,
      startAt: new Date(Date.now() - 60_000), // due
      endAt: new Date(Date.now() + 5 * 24 * 3600_000),
      firstActivatedAt: null,
    });

    const worker = createSweepWorker(prisma, workerConnection, logger);
    const events = new QueueEvents(OPPORTUNITY_SWEEP_QUEUE_NAME, { connection: createBullMqRedisConnection(env) });
    await events.waitUntilReady();

    const job = await queue.add(OPPORTUNITY_SWEEP_JOB_NAME, {});
    await job.waitUntilFinished(events);

    await events.close();
    await worker.close();

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id: scheduledId } });
    expect(row.status).toBe("ACTIVE");
    expect(row.firstActivatedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { entityId: scheduledId } });
    expect(audit).not.toBeNull();
    const outbox = await prisma.outboxEvent.findMany({});
    const relevant = outbox.filter((e) => (e.payload as Record<string, unknown>).opportunityId === scheduledId);
    expect(relevant.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("re-running the sweep after a row is already processed produces no additional transition or Audit/Outbox entry for it", async () => {
    const activeId = await seedOpportunity(prisma, ctx, {
      status: "ACTIVE",
      targetQuantity: 40,
      fundedQuantity: 40,
      startAt: new Date(Date.now() - 3 * 3600_000),
      endAt: new Date(Date.now() + 5 * 24 * 3600_000),
    });

    const worker = createSweepWorker(prisma, workerConnection, logger);
    const events = new QueueEvents(OPPORTUNITY_SWEEP_QUEUE_NAME, { connection: createBullMqRedisConnection(env) });
    await events.waitUntilReady();

    const job1 = await queue.add(OPPORTUNITY_SWEEP_JOB_NAME, {});
    await job1.waitUntilFinished(events);

    const afterFirst = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeId } });
    expect(afterFirst.status).toBe("FUNDED");
    const auditCountAfterFirst = await prisma.auditLog.count({ where: { entityId: activeId } });
    const outboxCountAfterFirst = (await prisma.outboxEvent.findMany({})).filter(
      (e) => (e.payload as Record<string, unknown>).opportunityId === activeId
    ).length;
    expect(auditCountAfterFirst).toBe(1);
    expect(outboxCountAfterFirst).toBe(1);

    // Run the SAME job type again — the row is now FUNDED, no longer
    // matching any batch's WHERE clause, so it must not be touched again.
    const job2 = await queue.add(OPPORTUNITY_SWEEP_JOB_NAME, {});
    await job2.waitUntilFinished(events);

    await events.close();
    await worker.close();

    const afterSecond = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeId } });
    expect(afterSecond.status).toBe("FUNDED");
    expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt);
    const auditCountAfterSecond = await prisma.auditLog.count({ where: { entityId: activeId } });
    const outboxCountAfterSecond = (await prisma.outboxEvent.findMany({})).filter(
      (e) => (e.payload as Record<string, unknown>).opportunityId === activeId
    ).length;
    expect(auditCountAfterSecond).toBe(1);
    expect(outboxCountAfterSecond).toBe(1);
  }, 30_000);

  it("a SCHEDULED opportunity missing financial readiness goes to ACTION_REQUIRED with the correct closed reason code", async () => {
    const otherCtx = await buildSharedContext(prisma);
    await prisma.product.update({ where: { id: otherCtx.productId }, data: { approvalStatus: "APPROVED" } });
    // Deliberately no bank account / tax profile / invoicing profile.

    const id = await seedOpportunity(prisma, otherCtx, {
      status: "SCHEDULED",
      targetQuantity: 40,
      fundedQuantity: 0,
      startAt: new Date(Date.now() - 60_000),
      endAt: new Date(Date.now() + 5 * 24 * 3600_000),
      firstActivatedAt: null,
    });

    const worker = createSweepWorker(prisma, workerConnection, logger);
    const events = new QueueEvents(OPPORTUNITY_SWEEP_QUEUE_NAME, { connection: createBullMqRedisConnection(env) });
    await events.waitUntilReady();

    const job = await queue.add(OPPORTUNITY_SWEEP_JOB_NAME, {});
    await job.waitUntilFinished(events);

    await events.close();
    await worker.close();

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("ACTION_REQUIRED");
    expect(row.reasonCode).toBe("SUPPLIER_NOT_FINANCIALLY_READY");
    expect(row.blockedAt).not.toBeNull();
  }, 30_000);

  it("EXPIRED never touches fundedQuantity, and no order/payment table exists for the sweep to touch", async () => {
    const id = await seedOpportunity(prisma, ctx, {
      status: "ACTIVE",
      targetQuantity: 100,
      fundedQuantity: 37,
      startAt: new Date(Date.now() - 3 * 3600_000),
      endAt: new Date(Date.now() - 1000),
    });

    const worker = createSweepWorker(prisma, workerConnection, logger);
    const events = new QueueEvents(OPPORTUNITY_SWEEP_QUEUE_NAME, { connection: createBullMqRedisConnection(env) });
    await events.waitUntilReady();

    const job = await queue.add(OPPORTUNITY_SWEEP_JOB_NAME, {});
    await job.waitUntilFinished(events);

    await events.close();
    await worker.close();

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("EXPIRED");
    expect(row.fundedQuantity).toBe(37);

    // Structural: Prisma's own generated client only exposes models
    // that exist in the schema — there is no order/payment/refund
    // model for the worker (or anything else) to even reference yet.
    expect((prisma as unknown as Record<string, unknown>).order).toBeUndefined();
    expect((prisma as unknown as Record<string, unknown>).payment).toBeUndefined();
    expect((prisma as unknown as Record<string, unknown>).refund).toBeUndefined();
  }, 30_000);
});
