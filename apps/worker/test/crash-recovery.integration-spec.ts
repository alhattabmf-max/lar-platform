import { PrismaClient, Prisma } from "@prisma/client";
import { runOpportunityLifecycleSweep } from "@platform/opportunity-lifecycle";
import { buildSharedContext, type SharedContext } from "./fixtures";

const BATCH_SIZE = 200;
const TOTAL_ROWS = 205; // just over one batch, so a second batch is genuinely attempted

/**
 * Wraps a real PrismaClient so its $transaction throws on the Nth
 * call — simulating an operational crash (e.g. a dropped DB
 * connection) partway through a multi-batch sweep run, without
 * touching sweep.ts itself.
 */
function wrapToFailOnNthTransaction(real: PrismaClient, failOnCallNumber: number): PrismaClient {
  let callCount = 0;
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return async (fn: (tx: unknown) => unknown) => {
          callCount += 1;
          if (callCount === failOnCallNumber) {
            throw new Error("Simulated operational crash mid-batch");
          }
          return (Reflect.get(target, prop, receiver) as typeof target.$transaction).call(target, fn as never);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaClient;
}

async function seedManyExpiryCandidates(prisma: PrismaClient, ctx: SharedContext, count: number): Promise<string[]> {
  const rows = Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    companyId: ctx.companyId,
    productId: ctx.productId,
    fulfillmentLocationId: ctx.fulfillmentLocationId,
    fulfillmentCityId: ctx.cityId,
    fulfillmentCityNameAr: "c",
    fulfillmentCityNameEn: "c",
    fulfillmentRegionId: ctx.regionId,
    fulfillmentRegionNameAr: "r",
    fulfillmentRegionNameEn: "r",
    productApprovalSnapshotId: ctx.snapshotId,
    targetQuantity: 40,
    fundedQuantity: 10,
    unitPriceAmount: new Prisma.Decimal(10),
    startAt: new Date(Date.now() - 3 * 3600_000),
    endAt: new Date(Date.now() - 1000),
    expectedPreparationDays: 3,
    status: "ACTIVE" as const,
    firstActivatedAt: new Date(Date.now() - 3 * 3600_000),
    taxRatePercent: new Prisma.Decimal(15),
    unitPriceExclTaxAmount: new Prisma.Decimal(8.7),
    unitTaxAmount: new Prisma.Decimal(1.3),
    taxCalculationRuleCode: "DEFAULT",
    taxCalculationRuleVersion: "v1",
    totalValueInclTaxAmount: new Prisma.Decimal(400),
    shareTierPolicyVersionId: ctx.policyVersionId,
    shareTierIndex: 0,
    shareBasisPoints: 1000,
    shareQuantity: 4,
    salesUnitNameAr: "a",
    salesUnitNameEn: "a",
    commissionPolicyVersionId: ctx.commissionPolicyVersionId,
    commissionRateBasisPoints: ctx.commissionRateBasisPoints,
  }));

  await prisma.opportunity.createMany({ data: rows });
  return rows.map((r) => r.id);
}

describe("Crash mid-batch then retry — safe rollback, no loss, no duplication (integration, real DB)", () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("a failure on the second batch's transaction leaves the first batch committed and the rest untouched, then a clean retry finishes it with no duplicate Audit/Outbox", async () => {
    const ctx = await buildSharedContext(prisma);
    const ids = await seedManyExpiryCandidates(prisma, ctx, TOTAL_ROWS);

    const failingPrisma = wrapToFailOnNthTransaction(prisma, 3);
    // Call #1: runScheduledFinalizationBatches's single $transaction
    // (0 SCHEDULED candidates here, but it still calls $transaction
    // once regardless). Call #2: the first ACTIVE-expiry batch (200
    // rows, must commit). Call #3: the second batch (remaining 5) —
    // simulated crash lands here, before it can commit anything.

    await expect(runOpportunityLifecycleSweep(failingPrisma)).rejects.toThrow("Simulated operational crash");

    const afterCrash = await prisma.opportunity.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, fundedQuantity: true },
    });
    const expiredAfterCrash = afterCrash.filter((r) => r.status === "EXPIRED");
    const stillActiveAfterCrash = afterCrash.filter((r) => r.status === "ACTIVE");

    // The first batch (up to BATCH_SIZE) committed cleanly — the
    // second batch's failed transaction never partially wrote
    // anything (Postgres transactions are all-or-nothing), so the
    // remaining rows are untouched, not half-updated.
    expect(expiredAfterCrash.length).toBe(BATCH_SIZE);
    expect(stillActiveAfterCrash.length).toBe(TOTAL_ROWS - BATCH_SIZE);
    for (const row of afterCrash) {
      expect(row.fundedQuantity).toBe(10);
    }

    const auditCountAfterCrash = await prisma.auditLog.count({
      where: { entityId: { in: ids }, action: "OPPORTUNITY_EXPIRED" },
    });
    expect(auditCountAfterCrash).toBe(BATCH_SIZE);

    // Retry with a REAL (unwrapped) client — this is exactly what the
    // BullMQ job's own attempts/backoff would do on the next attempt.
    await runOpportunityLifecycleSweep(prisma);

    const afterRetry = await prisma.opportunity.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, fundedQuantity: true },
    });
    expect(afterRetry.every((r) => r.status === "EXPIRED")).toBe(true);
    for (const row of afterRetry) {
      expect(row.fundedQuantity).toBe(10);
    }

    // Exactly one Audit and one Outbox entry per row, total —
    // the retry must not have re-processed (and re-audited) the
    // 200 rows the first, crashed attempt already committed.
    const finalAuditCount = await prisma.auditLog.count({
      where: { entityId: { in: ids }, action: "OPPORTUNITY_EXPIRED" },
    });
    expect(finalAuditCount).toBe(TOTAL_ROWS);

    const allOutbox = await prisma.outboxEvent.findMany({ where: { eventType: "OPPORTUNITY_EXPIRED" } });
    const idSet = new Set(ids);
    const relevantOutbox = allOutbox.filter((e) => idSet.has((e.payload as Record<string, unknown>).opportunityId as string));
    expect(relevantOutbox.length).toBe(TOTAL_ROWS);

    // Per-row: never more than one Audit entry each.
    for (const id of ids) {
      const count = await prisma.auditLog.count({ where: { entityId: id, action: "OPPORTUNITY_EXPIRED" } });
      expect(count).toBe(1);
    }
  }, 60_000);
});
