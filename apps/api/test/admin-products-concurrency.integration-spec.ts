import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { AdminProductsService } from "../src/admin/products/admin-products.service";
import { ProductsService } from "../src/products/products.service";
import { AuditService } from "../src/audit/audit.service";

const prisma = new PrismaClient() as unknown as PrismaService;

async function seedApprovedProductWithOpportunities(fundedQuantity = 0) {
  const admin1 = crypto.randomUUID();
  const admin2 = crypto.randomUUID();
  const company = await prisma.company.create({
    data: {
      crNumber: `CR-7A-CONC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      legalName: "7A Concurrency Co",
      accountType: "SUPPLIER",
      verificationStatus: "VERIFIED",
    },
  });
  const node = await prisma.taxonomyNode.create({ data: { nameAr: "a", nameEn: "a" } });
  const product = await prisma.product.create({
    data: {
      companyId: company.id,
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
    data: {
      productId: product.id,
      approvalSource: "AUTO",
      approvedByAdminId: null,
      snapshot: { salesUnitNameAr: "a", salesUnitNameEn: "a" },
    },
  });
  const region = await prisma.region.create({ data: { nameAr: "r", nameEn: "r" } });
  const city = await prisma.city.create({ data: { regionId: region.id, nameAr: "c", nameEn: "c" } });
  const location = await prisma.companyLocation.create({
    data: {
      companyId: company.id,
      regionId: region.id,
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

  const activeOpp = await prisma.opportunity.create({
    data: {
      companyId: company.id,
      productId: product.id,
      fulfillmentLocationId: location.id,
      fulfillmentCityId: city.id,
      fulfillmentCityNameAr: "c",
      fulfillmentCityNameEn: "c",
      fulfillmentRegionId: region.id,
      fulfillmentRegionNameAr: "r",
      fulfillmentRegionNameEn: "r",
      productApprovalSnapshotId: snapshot.id,
      targetQuantity: 40,
      fundedQuantity,
      unitPriceAmount: 10,
      startAt: new Date(Date.now() - 3 * 3600_000),
      endAt: new Date(Date.now() + 5 * 24 * 3600_000),
      expectedPreparationDays: 3,
      status: "ACTIVE",
      firstActivatedAt: new Date(Date.now() - 3 * 3600_000),
      taxRatePercent: 15,
      unitPriceExclTaxAmount: 8.7,
      unitTaxAmount: 1.3,
      taxCalculationRuleCode: "DEFAULT",
      taxCalculationRuleVersion: "v1",
      totalValueInclTaxAmount: 400,
      shareTierPolicyVersionId: policyV1.id,
      shareTierIndex: 0,
      shareBasisPoints: 1000,
      shareQuantity: 4,
      salesUnitNameAr: "a",
      salesUnitNameEn: "a",
      commissionPolicyVersionId: commissionV1.id,
      commissionRateBasisPoints: commissionV1.rateBasisPoints,
    },
  });

  return { productId: product.id, activeOppId: activeOpp.id, admin1, admin2 };
}

describe("AdminProductsService — concurrent admin decisions (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("two concurrent suspend() calls on the same APPROVED product: exactly one wins, no duplicate cascade or audit/outbox", async () => {
    const { productId, activeOppId, admin1, admin2 } = await seedApprovedProductWithOpportunities();
    const audit = new AuditService(prisma);
    const service = new AdminProductsService(prisma, audit, new ProductsService(prisma, audit));
    const ctx = { requestId: "req-conc-1" };

    const results = await Promise.allSettled([
      service.suspend(productId, "reason A", admin1, ctx),
      service.suspend(productId, "reason B", admin2, ctx),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.approvalStatus).toBe("SUSPENDED");

    const productAuditCount = await prisma.auditLog.count({
      where: { entityId: productId, action: "PRODUCT_SUSPENDED" },
    });
    expect(productAuditCount).toBe(1);

    const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeOppId } });
    expect(opp.status).toBe("PAUSED");

    const cascadeAuditCount = await prisma.auditLog.count({
      where: { entityId: activeOppId, action: "OPPORTUNITY_PAUSED_PRODUCT_CASCADE" },
    });
    expect(cascadeAuditCount).toBe(1);

    const outboxEvents = await prisma.outboxEvent.findMany({ where: { eventType: "PRODUCT_SUSPENDED" } });
    const outboxCount = outboxEvents.filter((e) => (e.payload as Record<string, unknown>).productId === productId).length;
    expect(outboxCount).toBe(1);
  }, 30_000);

  it("a concurrent suspend() and close(): close() legitimately accepts SUSPENDED as a starting point, so both may succeed sequentially — the product ends CLOSED, with no duplicate cascade/audit for either transition", async () => {
    const { productId, activeOppId, admin1, admin2 } = await seedApprovedProductWithOpportunities();
    const audit = new AuditService(prisma);
    const service = new AdminProductsService(prisma, audit, new ProductsService(prisma, audit));
    const ctx = { requestId: "req-conc-2" };

    // Unlike suspend()xsuspend() (both require the SAME starting
    // status, so only one can ever win), close() deliberately accepts
    // BOTH APPROVED and SUSPENDED as legal starting points — closing
    // an already-suspended product is a normal, intended path. So
    // both calls succeeding here, in sequence, is CORRECT behavior,
    // not a race condition to reject. What must still never happen:
    // duplicate audit/outbox for the SAME opportunity transition.
    await Promise.allSettled([
      service.suspend(productId, "report", admin1, ctx),
      service.close(productId, "violation", admin2, ctx),
    ]);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product.approvalStatus).toBe("CLOSED"); // close() always wins eventually — it accepts SUSPENDED too

    const productSuspendedAudits = await prisma.auditLog.count({
      where: { entityId: productId, action: "PRODUCT_SUSPENDED" },
    });
    const productClosedAudits = await prisma.auditLog.count({
      where: { entityId: productId, action: "PRODUCT_CLOSED" },
    });
    expect(productSuspendedAudits).toBeLessThanOrEqual(1);
    expect(productClosedAudits).toBe(1);

    // The opportunity itself: whichever cascade(s) actually applied,
    // each individual transition-type must never be double-audited.
    const pausedCount = await prisma.auditLog.count({
      where: { entityId: activeOppId, action: "OPPORTUNITY_PAUSED_PRODUCT_CASCADE" },
    });
    const cancelledCount = await prisma.auditLog.count({
      where: { entityId: activeOppId, action: "OPPORTUNITY_CANCELLED_PRODUCT_CASCADE" },
    });
    expect(pausedCount).toBeLessThanOrEqual(1);
    expect(cancelledCount).toBeLessThanOrEqual(1);

    // Final opportunity state is a legal outcome of the sequence that
    // actually occurred — CANCELLED if suspend() never got a chance to
    // apply first, or CANCELLED still (close() cascades ACTIVE/PAUSED
    // -> CANCELLED regardless), matching the product's final CLOSED state.
    const opp = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeOppId } });
    expect(opp.status).toBe("CANCELLED");
  }, 30_000);

  it("suspend() cascade leaves a non-zero fundedQuantity on the ACTIVE->PAUSED opportunity completely unchanged", async () => {
    const { productId, activeOppId, admin1 } = await seedApprovedProductWithOpportunities(17);
    const audit = new AuditService(prisma);
    const service = new AdminProductsService(prisma, audit, new ProductsService(prisma, audit));

    const before = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeOppId } });
    expect(before.fundedQuantity).toBe(17);

    await service.suspend(productId, "report confirmed", admin1, { requestId: "req-funded-suspend" });

    const after = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeOppId } });
    expect(after.status).toBe("PAUSED");
    expect(after.fundedQuantity).toBe(17);
  }, 30_000);

  it("close() cascade leaves a non-zero fundedQuantity on the ACTIVE->CANCELLED opportunity completely unchanged", async () => {
    const { productId, activeOppId, admin1 } = await seedApprovedProductWithOpportunities(23);
    const audit = new AuditService(prisma);
    const service = new AdminProductsService(prisma, audit, new ProductsService(prisma, audit));

    const before = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeOppId } });
    expect(before.fundedQuantity).toBe(23);

    await service.close(productId, "safety violation", admin1, { requestId: "req-funded-close" });

    const after = await prisma.opportunity.findUniqueOrThrow({ where: { id: activeOppId } });
    expect(after.status).toBe("CANCELLED");
    expect(after.fundedQuantity).toBe(23);
  }, 30_000);
});
