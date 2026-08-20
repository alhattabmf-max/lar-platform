/**
 * Phase 7E Verification Gate — run AFTER the Backfill Command and
 * BEFORE Release B (Contract migration). Exits non-zero if ANY of the
 * following holds:
 *
 *  1. An OrderAllocation exists with no OrderAllocationFinancialSnapshot.
 *  2. Any MasterOrder's snapshots sum to something other than its own
 *     frozen commission/commissionTax/supplierPayable totals, to the
 *     cent.
 *  3. A DELIVERED OrderAllocation exists with dispute_window_closes_at
 *     still NULL.
 *  4. A MasterOrder has a PARTIAL snapshot state (some but not all of
 *     its allocations have a snapshot).
 *
 * This script is read-only — it never writes anything.
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";

interface GateFailure {
  check: string;
  details: string;
}

export async function runVerificationGate(prisma: PrismaClient): Promise<GateFailure[]> {
  const failures: GateFailure[] = [];

  // Check 1 + 4 combined: any allocation without a snapshot, and
  // whether that allocation's MasterOrder has ANY sibling that DOES
  // have one (partial) vs none at all (simply not yet backfilled).
  const missing = await prisma.$queryRaw<{ master_order_id: string; order_allocation_id: string; siblings_with_snapshot: bigint }[]>`
    SELECT oa."master_order_id", oa."id" AS order_allocation_id,
      (SELECT COUNT(*) FROM order_allocations oa2
        JOIN order_allocation_financial_snapshots oafs2 ON oafs2.order_allocation_id = oa2.id
        WHERE oa2.master_order_id = oa.master_order_id) AS siblings_with_snapshot
    FROM order_allocations oa
    LEFT JOIN order_allocation_financial_snapshots oafs ON oafs.order_allocation_id = oa.id
    WHERE oafs.id IS NULL
    ORDER BY oa."master_order_id", oa."id"
  `;
  for (const row of missing) {
    if (Number(row.siblings_with_snapshot) > 0) {
      failures.push({
        check: "PARTIAL_SNAPSHOT_STATE",
        details: `masterOrderId=${row.master_order_id} orderAllocationId=${row.order_allocation_id} has ${row.siblings_with_snapshot} sibling(s) with a snapshot but this one is missing`,
      });
    } else {
      failures.push({
        check: "MISSING_SNAPSHOT",
        details: `masterOrderId=${row.master_order_id} orderAllocationId=${row.order_allocation_id} has no financial snapshot`,
      });
    }
  }

  // Check 2: sum-matches-source, to the cent, for every MasterOrder
  // that DOES have complete snapshots (incomplete ones are already
  // reported above and would only produce noise here).
  const sumMismatches = await prisma.$queryRaw<
    { master_order_id: string; commission_sum: string; commission_amount: string; commission_tax_sum: string; commission_tax_amount: string; supplier_payable_sum: string; supplier_payable_amount: string; shipping_sum: string }[]
  >`
    SELECT mo."id" AS master_order_id,
      SUM(oafs."commission_share_amount")::text AS commission_sum, mo."commission_amount"::text AS commission_amount,
      SUM(oafs."commission_share_tax_amount")::text AS commission_tax_sum, mo."commission_tax_amount"::text AS commission_tax_amount,
      SUM(oafs."supplier_payable_share_amount")::text AS supplier_payable_sum, mo."supplier_payable_amount"::text AS supplier_payable_amount,
      SUM(oafs."shipping_fee_amount")::text AS shipping_sum
    FROM master_orders mo
    JOIN order_allocations oa ON oa."master_order_id" = mo."id"
    JOIN order_allocation_financial_snapshots oafs ON oafs."order_allocation_id" = oa."id"
    GROUP BY mo."id", mo."commission_amount", mo."commission_tax_amount", mo."supplier_payable_amount"
    HAVING SUM(oafs."commission_share_amount") != mo."commission_amount"
        OR SUM(oafs."commission_share_tax_amount") != mo."commission_tax_amount"
        OR SUM(oafs."supplier_payable_share_amount") != (mo."supplier_payable_amount" - SUM(oafs."shipping_fee_amount"))
  `;
  for (const row of sumMismatches) {
    failures.push({
      check: "SUM_MISMATCH",
      details: `masterOrderId=${row.master_order_id} commission ${row.commission_sum}!=${row.commission_amount} OR commissionTax ${row.commission_tax_sum}!=${row.commission_tax_amount} OR supplierPayable(excl. shipping ${row.shipping_sum}) ${row.supplier_payable_sum}!=${Number(row.supplier_payable_amount) - Number(row.shipping_sum)}`,
    });
  }

  // Check 3: DELIVERED without dispute_window_closes_at.
  const deliveredWithoutWindow = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM order_allocations WHERE "status" = 'DELIVERED' AND "dispute_window_closes_at" IS NULL
  `;
  for (const row of deliveredWithoutWindow) {
    failures.push({ check: "DELIVERED_WITHOUT_DISPUTE_WINDOW", details: `orderAllocationId=${row.id}` });
  }

  return failures;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    console.log("Phase 7E Verification Gate starting...");
    const failures = await runVerificationGate(prisma);

    console.log(`\n=== Verification Gate Report ===`);
    console.log(`Failures: ${failures.length}`);
    if (failures.length > 0) {
      console.log("\nDetails:");
      for (const f of failures) {
        console.log(`  [${f.check}] ${f.details}`);
      }
      process.exitCode = 1;
    } else {
      console.log("PASSED — safe to apply the Contract migration.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Verification Gate crashed:", err);
    process.exitCode = 1;
  });
}
