/**
 * Phase 7E Backfill — computes OrderAllocationFinancialSnapshot (and
 * fills dispute_window_closes_at for already-DELIVERED rows) for every
 * pre-7E MasterOrder. Standalone script, NOT run via `prisma migrate
 * deploy` — must be invoked manually between Release A (Expand) and
 * Release B (Contract).
 *
 * Usage:
 *   node dist/cli/backfill-financial-snapshots.js [--dry-run] [--batch-size=50]
 *
 * Guarantees:
 *  - Re-runnable safely: a MasterOrder whose allocations ALL already
 *    have a snapshot is skipped (never re-computed, never touched).
 *  - Atomic per MasterOrder: either every allocation in that order
 *    gets its snapshot in one transaction, or none do — an order is
 *    never left half-distributed.
 *  - The MasterOrder row is locked (SELECT ... FOR UPDATE) for the
 *    full duration of computing + inserting all its allocations'
 *    snapshots.
 *  - Deterministic ordering: both which MasterOrders are picked up
 *    per batch, and which branch absorbs each component's rounding
 *    remainder, follow (createdAt ASC, id ASC).
 *  - Fail-loud: any MasterOrder that cannot be computed (missing
 *    QuoteSnapshot, inconsistent data, or a PARTIAL pre-existing
 *    snapshot state) is reported by id and reason, never guessed.
 *  - Never modifies an existing OrderAllocationFinancialSnapshot row.
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { computeOrderAllocationFinancialSnapshots } from "@platform/domain";

const DEFAULT_BATCH_SIZE = 50;
const DISPUTE_WINDOW_DAYS = 7;

interface FailureRecord {
  masterOrderId: string;
  reason: string;
}

interface BackfillReport {
  processedMasterOrderIds: string[];
  skippedAlreadyCompleteMasterOrderIds: string[];
  failures: FailureRecord[];
  dryRun: boolean;
}

function parseArgs(argv: string[]): { dryRun: boolean; batchSize: number } {
  const dryRun = argv.includes("--dry-run");
  const batchArg = argv.find((a) => a.startsWith("--batch-size="));
  const batchSize = batchArg ? Number(batchArg.split("=")[1]) : DEFAULT_BATCH_SIZE;
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error(`Invalid --batch-size: ${batchArg}`);
  }
  return { dryRun, batchSize };
}

async function fetchNextBatchMasterOrderIds(prisma: PrismaClient, batchSize: number): Promise<string[]> {
  // MasterOrders that have at least one OrderAllocation without a
  // financial snapshot yet. Ordered deterministically.
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT mo."id", mo."created_at"
    FROM "master_orders" mo
    INNER JOIN "order_allocations" oa ON oa."master_order_id" = mo."id"
    LEFT JOIN "order_allocation_financial_snapshots" oafs ON oafs."order_allocation_id" = oa."id"
    WHERE oafs."id" IS NULL
    ORDER BY mo."created_at" ASC, mo."id" ASC
    LIMIT ${batchSize}
  `;
  return rows.map((r) => r.id);
}

async function processOneMasterOrder(prisma: PrismaClient, masterOrderId: string, dryRun: boolean): Promise<{ outcome: "processed" | "skipped" | "failed"; reason?: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const orderRows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM master_orders WHERE id = ${masterOrderId}::uuid FOR UPDATE`;
      if (orderRows.length === 0) {
        return { outcome: "failed" as const, reason: "MASTER_ORDER_NOT_FOUND" };
      }

      const masterOrder = await tx.masterOrder.findUniqueOrThrow({
        where: { id: masterOrderId },
        select: { checkoutSessionId: true, commissionAmount: true, commissionTaxAmount: true },
      });

      const allocations = await tx.orderAllocation.findMany({
        where: { masterOrderId },
        include: { checkoutLocationAllocation: true, financialSnapshot: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

      if (allocations.length === 0) {
        return { outcome: "failed" as const, reason: "NO_ALLOCATIONS_FOUND" };
      }

      const withSnapshot = allocations.filter((a) => a.financialSnapshot !== null);
      if (withSnapshot.length === allocations.length) {
        return { outcome: "skipped" as const };
      }
      if (withSnapshot.length > 0) {
        // Partial state — never fill the gap, never guess. Requires
        // manual investigation before this MasterOrder can proceed.
        return { outcome: "failed" as const, reason: `PARTIAL_SNAPSHOT_STATE (${withSnapshot.length}/${allocations.length} allocations already have a snapshot)` };
      }

      const quoteSnapshot = await tx.quoteSnapshot.findUnique({ where: { checkoutSessionId: masterOrder.checkoutSessionId } });
      if (!quoteSnapshot) {
        return { outcome: "failed" as const, reason: "MISSING_QUOTE_SNAPSHOT" };
      }

      const totalQuantity = allocations.reduce((sum, a) => sum + a.checkoutLocationAllocation.quantity, 0);
      if (totalQuantity <= 0) {
        return { outcome: "failed" as const, reason: "INVALID_TOTAL_QUANTITY" };
      }

      const computed = computeOrderAllocationFinancialSnapshots({
        masterOrderTotalQuantity: totalQuantity,
        branches: allocations.map((a) => ({
          checkoutLocationAllocationId: a.checkoutLocationAllocationId,
          createdAt: a.checkoutLocationAllocation.createdAt,
          quantity: a.checkoutLocationAllocation.quantity,
          unitPriceExclTaxAmount: Number(quoteSnapshot.unitPriceExclTaxAmount),
          unitTaxAmount: Number(quoteSnapshot.unitTaxAmount),
          shippingFeeAmount: Number(a.checkoutLocationAllocation.shippingFeeAmount),
        })),
        masterOrderCommissionAmount: Number(masterOrder.commissionAmount),
        masterOrderCommissionTaxAmount: Number(masterOrder.commissionTaxAmount),
      });

      if (dryRun) {
        return { outcome: "processed" as const };
      }

      for (const allocation of allocations) {
        const c = computed.find((x: (typeof computed)[number]) => x.checkoutLocationAllocationId === allocation.checkoutLocationAllocationId)!;
        await tx.orderAllocationFinancialSnapshot.create({
          data: {
            orderAllocationId: allocation.id,
            productAmountExclTax: c.productAmountExclTax,
            productTaxAmount: c.productTaxAmount,
            productAmountInclTax: c.productAmountInclTax,
            allocationShareBasisPoints: c.allocationShareBasisPoints,
            commissionShareAmount: c.commissionShareAmount,
            commissionShareTaxAmount: c.commissionShareTaxAmount,
            supplierPayableShareAmount: c.supplierPayableShareAmount,
            shippingFeeAmount: c.shippingFeeAmount,
            productAmountRoundingRemainder: c.productAmountRoundingRemainder,
            commissionShareRoundingRemainder: c.commissionShareRoundingRemainder,
            commissionShareTaxRoundingRemainder: c.commissionShareTaxRoundingRemainder,
            supplierPayableShareRoundingRemainder: c.supplierPayableShareRoundingRemainder,
          },
        });

        if (allocation.status === "DELIVERED" && allocation.disputeWindowClosesAt === null && allocation.deliveredAt) {
          const disputeWindowClosesAt = new Date(allocation.deliveredAt.getTime() + DISPUTE_WINDOW_DAYS * 86_400_000);
          await tx.$executeRaw`UPDATE order_allocations SET dispute_window_closes_at = ${disputeWindowClosesAt} WHERE id = ${allocation.id}::uuid`;
        }
      }

      return { outcome: "processed" as const };
    });
  } catch (err) {
    return { outcome: "failed", reason: `EXCEPTION: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function runBackfill(prisma: PrismaClient, opts: { dryRun: boolean; batchSize: number }): Promise<BackfillReport> {
  const report: BackfillReport = { processedMasterOrderIds: [], skippedAlreadyCompleteMasterOrderIds: [], failures: [], dryRun: opts.dryRun };

  // Loop batches until a batch that touches nothing new is returned.
  // In dry-run mode NOTHING is actually written, so a "processed" id
  // would otherwise be picked up again forever — track every id this
  // run has already dispositioned (processed OR failed) and exclude
  // it from subsequent batches. In non-dry-run mode this is a no-op
  // safety net, since a real INSERT already makes the id disappear
  // from fetchNextBatchMasterOrderIds' result on its own.
  const seenIds = new Set<string>();
  for (;;) {
    const batchIds = await fetchNextBatchMasterOrderIds(prisma, opts.batchSize);
    const newIds = batchIds.filter((id) => !seenIds.has(id));
    if (newIds.length === 0) break;

    for (const masterOrderId of newIds) {
      seenIds.add(masterOrderId);
      const result = await processOneMasterOrder(prisma, masterOrderId, opts.dryRun);
      if (result.outcome === "processed") {
        report.processedMasterOrderIds.push(masterOrderId);
      } else if (result.outcome === "skipped") {
        report.skippedAlreadyCompleteMasterOrderIds.push(masterOrderId);
      } else {
        report.failures.push({ masterOrderId, reason: result.reason ?? "UNKNOWN" });
      }
    }
  }

  return report;
}

async function main(): Promise<void> {
  const { dryRun, batchSize } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    console.log(`Phase 7E Backfill starting — dryRun=${dryRun}, batchSize=${batchSize}`);
    const report = await runBackfill(prisma, { dryRun, batchSize });

    console.log(`\n=== Backfill Report (dryRun=${report.dryRun}) ===`);
    console.log(`Processed: ${report.processedMasterOrderIds.length}`);
    console.log(`Skipped (already complete): ${report.skippedAlreadyCompleteMasterOrderIds.length}`);
    console.log(`Failed: ${report.failures.length}`);
    if (report.failures.length > 0) {
      console.log("\nFailures (masterOrderId -> reason):");
      for (const f of report.failures) {
        console.log(`  ${f.masterOrderId} -> ${f.reason}`);
      }
    }

    if (report.failures.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Backfill crashed:", err);
    process.exitCode = 1;
  });
}
