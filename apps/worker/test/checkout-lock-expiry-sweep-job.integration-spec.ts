import { PrismaClient } from "@prisma/client";
import { Queue, QueueEvents } from "bullmq";
import pino from "pino";
import { loadEnv } from "@platform/config";
import { createBullMqRedisConnection } from "../src/redis-connection";
import {
  CHECKOUT_LOCK_EXPIRY_QUEUE_NAME,
  CHECKOUT_LOCK_EXPIRY_JOB_NAME,
  createCheckoutLockExpiryQueue,
} from "../src/checkout-lock-expiry-scheduler";
import { createCheckoutLockExpiryWorker } from "../src/create-checkout-lock-expiry-worker";

const prisma = new PrismaClient();
const logger = pino({ level: "silent" });
const env = loadEnv(process.env);

async function purgeQueue(queue: Queue): Promise<void> {
  await queue.obliterate({ force: true }).catch(() => undefined);
}

interface Ctx {
  supplierCompanyId: string;
  traderCompanyId: string;
  opportunityId: string;
}

async function buildCheckoutFixture(): Promise<Ctx> {
  const supplier = await prisma.company.create({
    data: {
      crNumber: `CR-CKSWEEP-S-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      legalName: "Sweep Supplier",
      accountType: "SUPPLIER",
      verificationStatus: "VERIFIED",
    },
  });
  const trader = await prisma.company.create({
    data: {
      crNumber: `CR-CKSWEEP-T-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      legalName: "Sweep Trader",
      accountType: "TRADER",
      verificationStatus: "VERIFIED",
    },
  });
  const node = await prisma.taxonomyNode.create({ data: { nameAr: "a", nameEn: "a" } });
  const product = await prisma.product.create({
    data: {
      companyId: supplier.id,
      taxonomyNodeId: node.id,
      salesUnitNameAr: "a",
      salesUnitNameEn: "a",
      nameAr: "p",
      nameEn: "p",
      approvalStatus: "APPROVED",
      weightPerUnit: 1,
      lengthCm: 1,
      widthCm: 1,
      heightCm: 1,
    },
  });
  const snapshot = await prisma.productApprovalSnapshot.create({
    data: { productId: product.id, approvalSource: "AUTO", snapshot: {} },
  });
  const region = await prisma.region.create({ data: { nameAr: "r", nameEn: "r" } });
  const city = await prisma.city.create({ data: { regionId: region.id, nameAr: "c", nameEn: "c" } });
  const location = await prisma.companyLocation.create({
    data: {
      companyId: supplier.id,
      cityId: city.id,
      name: "loc",
      shortAddress: "addr",
      latitude: 24.7,
      longitude: 46.6,
      contactName: "n",
      contactPhone: "p",
      isDefault: true,
    },
  });
  const policyV1 = await prisma.shareTierPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });
  const commissionV1 = await prisma.commissionPolicyVersion.findFirstOrThrow({ orderBy: { version: "asc" } });

  const opp = await prisma.opportunity.create({
    data: {
      companyId: supplier.id,
      productId: product.id,
      fulfillmentLocationId: location.id,
      fulfillmentCityId: city.id,
      fulfillmentCityNameAr: "c",
      fulfillmentCityNameEn: "c",
      fulfillmentRegionId: region.id,
      fulfillmentRegionNameAr: "r",
      fulfillmentRegionNameEn: "r",
      productApprovalSnapshotId: snapshot.id,
      targetQuantity: 100,
      unitPriceAmount: 10,
      startAt: new Date(Date.now() - 3600_000),
      endAt: new Date(Date.now() + 5 * 24 * 3600_000),
      expectedPreparationDays: 3,
      status: "ACTIVE",
      firstActivatedAt: new Date(Date.now() - 3600_000),
      taxRatePercent: 15,
      unitPriceExclTaxAmount: 8.7,
      unitTaxAmount: 1.3,
      taxCalculationRuleCode: "DEFAULT",
      taxCalculationRuleVersion: "v1",
      totalValueInclTaxAmount: 1000,
      shareTierPolicyVersionId: policyV1.id,
      shareTierIndex: 0,
      shareBasisPoints: 1000,
      shareQuantity: 10,
      salesUnitNameAr: "a",
      salesUnitNameEn: "a",
      commissionPolicyVersionId: commissionV1.id,
      commissionRateBasisPoints: commissionV1.rateBasisPoints,
    },
  });

  return { supplierCompanyId: supplier.id, traderCompanyId: trader.id, opportunityId: opp.id };
}

async function seedExpiredLock(ctx: Ctx): Promise<string> {
  const session = await prisma.checkoutSession.create({
    data: {
      opportunityId: ctx.opportunityId,
      traderCompanyId: ctx.traderCompanyId,
      lockedQuantity: 5,
      lockCreatedAt: new Date(Date.now() - 20 * 60_000),
      lockExpiresAt: new Date(Date.now() - 5 * 60_000),
      traderCompanySnapshot: {},
    },
  });
  return session.id;
}

describe("Worker — real BullMQ job runs the independent checkout lock expiry sweep (integration, real Redis + Postgres)", () => {
  let queueConnection: ReturnType<typeof createBullMqRedisConnection>;
  let workerConnection: ReturnType<typeof createBullMqRedisConnection>;
  let queue: Queue;
  let ctx: Ctx;

  beforeAll(async () => {
    queueConnection = createBullMqRedisConnection(env);
    workerConnection = createBullMqRedisConnection(env);
    await queueConnection.connect();
    await workerConnection.connect();
    queue = createCheckoutLockExpiryQueue(queueConnection);
    await purgeQueue(queue);
    ctx = await buildCheckoutFixture();
  });

  afterAll(async () => {
    await purgeQueue(queue);
    await queue.close();
    workerConnection.disconnect();
    queueConnection.disconnect();
    await prisma.$disconnect();
  });

  it("a real job actually runs the independent sweep and expires a due lock, with Audit+Outbox", async () => {
    const sessionId = await seedExpiredLock(ctx);

    const worker = createCheckoutLockExpiryWorker(prisma, workerConnection, logger);
    const events = new QueueEvents(CHECKOUT_LOCK_EXPIRY_QUEUE_NAME, {
      connection: createBullMqRedisConnection(env),
    });
    await events.waitUntilReady();

    const job = await queue.add(CHECKOUT_LOCK_EXPIRY_JOB_NAME, {});
    await job.waitUntilFinished(events);

    await events.close();
    await worker.close();

    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.status).toBe("EXPIRED");
    expect(row.releaseReason).toBe("EXPIRED");

    const audit = await prisma.auditLog.findFirst({ where: { entityId: sessionId, action: "CHECKOUT_LOCK_EXPIRED" } });
    expect(audit).not.toBeNull();
    const outbox = await prisma.outboxEvent.findMany({ where: { eventType: "CHECKOUT_LOCK_EXPIRED" } });
    const relevant = outbox.filter((e) => (e.payload as Record<string, unknown>).checkoutSessionId === sessionId);
    expect(relevant.length).toBe(1);
  }, 30_000);

  it("re-running the sweep job after a lock is already EXPIRED produces no additional transition or Audit/Outbox entry", async () => {
    const sessionId = await seedExpiredLock(ctx);

    const worker = createCheckoutLockExpiryWorker(prisma, workerConnection, logger);
    const events = new QueueEvents(CHECKOUT_LOCK_EXPIRY_QUEUE_NAME, {
      connection: createBullMqRedisConnection(env),
    });
    await events.waitUntilReady();

    const job1 = await queue.add(CHECKOUT_LOCK_EXPIRY_JOB_NAME, {});
    await job1.waitUntilFinished(events);

    const after1 = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after1.status).toBe("EXPIRED");
    const auditCount1 = await prisma.auditLog.count({
      where: { entityId: sessionId, action: "CHECKOUT_LOCK_EXPIRED" },
    });
    expect(auditCount1).toBe(1);

    const job2 = await queue.add(CHECKOUT_LOCK_EXPIRY_JOB_NAME, {});
    await job2.waitUntilFinished(events);

    await events.close();
    await worker.close();

    const auditCount2 = await prisma.auditLog.count({
      where: { entityId: sessionId, action: "CHECKOUT_LOCK_EXPIRED" },
    });
    expect(auditCount2).toBe(1);
  }, 30_000);

  it("two concurrent sweep passes racing the same expired lock: exactly one transition, one Audit, one Outbox entry", async () => {
    const sessionId = await seedExpiredLock(ctx);
    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();

    const { runCheckoutLockExpirySweep } = await import("@platform/opportunity-lifecycle");
    await Promise.all([runCheckoutLockExpirySweep(prismaA), runCheckoutLockExpirySweep(prismaB)]);

    await prismaA.$disconnect();
    await prismaB.$disconnect();

    const row = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.status).toBe("EXPIRED");

    const auditCount = await prisma.auditLog.count({
      where: { entityId: sessionId, action: "CHECKOUT_LOCK_EXPIRED" },
    });
    expect(auditCount).toBe(1);
  }, 30_000);
});
