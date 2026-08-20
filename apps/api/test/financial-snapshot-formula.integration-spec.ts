import { PrismaClient } from "@prisma/client";
import { seedFulfillmentFixture, fulfillmentFixturePrisma } from "./fixtures/fulfillment.fixture";
import { runBackfill } from "../src/cli/backfill-financial-snapshots";

const prisma = fulfillmentFixturePrisma;

describe("OrderAllocationFinancialSnapshot — corrected supplierPayableShareAmount formula (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("PaymentWebhookService creates snapshots with non-zero, DIFFERENT shipping fees per branch, and the row equations hold exactly", async () => {
    const fixture = await seedFulfillmentFixture("SNAPFORMULA");

    const allocations = await prisma.orderAllocation.findMany({
      where: { masterOrderId: fixture.masterOrderId },
      include: { financialSnapshot: true, checkoutLocationAllocation: true },
      orderBy: { createdAt: "asc" },
    });
    expect(allocations).toHaveLength(2);

    const shippingFees = allocations.map((a) => Number(a.checkoutLocationAllocation.shippingFeeAmount));
    expect(shippingFees[0]).not.toBe(shippingFees[1]);
    expect(shippingFees.every((f) => f > 0)).toBe(true);

    for (const allocation of allocations) {
      const snap = allocation.financialSnapshot!;
      expect(snap).not.toBeNull();

      expect(Number(snap.productAmountExclTax) + Number(snap.productTaxAmount)).toBeCloseTo(Number(snap.productAmountInclTax), 5);

      const rowSum = Number(snap.supplierPayableShareAmount) + Number(snap.commissionShareAmount) + Number(snap.commissionShareTaxAmount);
      expect(Math.round(rowSum * 100)).toBe(Math.round(Number(snap.productAmountInclTax) * 100));

      expect(Number(snap.shippingFeeAmount)).toBe(Number(allocation.checkoutLocationAllocation.shippingFeeAmount));
    }
  }, 30_000);

  it("the supplier's product-share never contains a single cent derived from shipping", async () => {
    const fixture = await seedFulfillmentFixture("SNAPNOFROMSHIP");
    const masterOrder = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    const checkoutSession = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: masterOrder.checkoutSessionId }, include: { quoteSnapshot: true } });
    const quote = checkoutSession.quoteSnapshot!;

    const snapshots = await prisma.orderAllocationFinancialSnapshot.findMany({
      where: { orderAllocation: { masterOrderId: fixture.masterOrderId } },
    });

    const supplierPayableSum = snapshots.reduce((sum, s) => sum + Number(s.supplierPayableShareAmount), 0);
    const expectedProductSupplierPayable = Number(masterOrder.supplierPayableAmount) - Number(quote.totalShippingFeeAmount);

    expect(Math.round(supplierPayableSum * 100)).toBe(Math.round(expectedProductSupplierPayable * 100));
    expect(supplierPayableSum).toBeLessThan(Number(masterOrder.supplierPayableAmount));
  }, 30_000);

  it("the five aggregate sums all match their frozen sources exactly, to the cent", async () => {
    const fixture = await seedFulfillmentFixture("SNAPFIVESUMS");
    const masterOrder = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    const checkoutSession = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: masterOrder.checkoutSessionId }, include: { quoteSnapshot: true } });
    const quote = checkoutSession.quoteSnapshot!;
    const snapshots = await prisma.orderAllocationFinancialSnapshot.findMany({ where: { orderAllocation: { masterOrderId: fixture.masterOrderId } } });

    const sum = (f: (s: (typeof snapshots)[number]) => number) => Math.round(snapshots.reduce((acc, s) => acc + f(s), 0) * 100);

    expect(sum((s) => Number(s.productAmountInclTax))).toBe(Math.round(Number(quote.productsSubtotalInclTaxAmount) * 100));
    expect(sum((s) => Number(s.shippingFeeAmount))).toBe(Math.round(Number(quote.totalShippingFeeAmount) * 100));
    expect(sum((s) => Number(s.commissionShareAmount))).toBe(Math.round(Number(masterOrder.commissionAmount) * 100));
    expect(sum((s) => Number(s.commissionShareTaxAmount))).toBe(Math.round(Number(masterOrder.commissionTaxAmount) * 100));
    expect(sum((s) => Number(s.supplierPayableShareAmount))).toBe(
      Math.round((Number(masterOrder.supplierPayableAmount) - Number(quote.totalShippingFeeAmount)) * 100)
    );
  }, 30_000);

  it("Backfill's dry run over already-live-snapshotted orders reports zero failures (proof the same domain function underlies both paths without conflict)", async () => {
    await seedFulfillmentFixture("SNAPBACKFILLMATCH");
    const report = await runBackfill(prisma as unknown as PrismaClient, { dryRun: true, batchSize: 10 });
    expect(report.failures).toHaveLength(0);
  }, 30_000);
});
