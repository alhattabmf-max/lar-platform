import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { AdminOpportunitiesService } from "../src/admin/opportunities/admin-opportunities.service";

const prisma = new PrismaClient() as unknown as PrismaService;

async function seedActiveOpportunity(): Promise<string> {
  const company = await prisma.company.create({
    data: {
      crNumber: `CR-ADMINOPP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      legalName: "Admin Opp Co",
      accountType: "SUPPLIER",
      verificationStatus: "VERIFIED",
    },
  });
  const node = await prisma.taxonomyNode.create({ data: { nameAr: "a", nameEn: "a" } });
  const unit = await prisma.salesUnit.create({ data: { nameAr: "a", nameEn: "a" } });
  const product = await prisma.product.create({
    data: {
      companyId: company.id,
      taxonomyNodeId: node.id,
      salesUnitNameAr: "a",
      salesUnitNameEn: "a",
      nameAr: "p",
      nameEn: "p",
      weightPerUnit: 1,
      lengthCm: 1,
      widthCm: 1,
      heightCm: 1,
    },
  });
  const snapshot = await prisma.productApprovalSnapshot.create({
    data: {
      productId: product.id,
      approvalSource: "ADMIN",
      snapshot: { salesUnitId: unit.id },
      approvedByAdminId: crypto.randomUUID(),
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

  const opp = await prisma.opportunity.create({
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
      targetQuantity: 100,
      unitPriceAmount: 11.5,
      startAt: new Date(Date.now() - 3600_000),
      endAt: new Date(Date.now() + 5 * 24 * 3600_000),
      expectedPreparationDays: 3,
      status: "ACTIVE",
      firstActivatedAt: new Date(Date.now() - 3600_000),
      taxRatePercent: 15,
      unitPriceExclTaxAmount: 10,
      unitTaxAmount: 1.5,
      taxCalculationRuleCode: "DEFAULT",
      taxCalculationRuleVersion: "v1",
      totalValueInclTaxAmount: 1150,
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

  return opp.id;
}

describe("AdminOpportunitiesService — concurrent pause (integration, real DB)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("only one of two concurrent pause attempts on the same ACTIVE opportunity succeeds", async () => {
    const id = await seedActiveOpportunity();
    const service = new AdminOpportunitiesService(prisma, {} as never);
    const ctx = { actorId: crypto.randomUUID(), requestId: "req-concurrent" };

    const results = await Promise.allSettled([
      service.pause(id, "reason A", ctx),
      service.pause(id, "reason B", ctx),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const final = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    expect(final.status).toBe("PAUSED");

    const auditCount = await prisma.auditLog.count({
      where: { entityId: id, action: "OPPORTUNITY_PAUSED" },
    });
    expect(auditCount).toBe(1);

    const outboxCount = await prisma.outboxEvent.count({
      where: { eventType: "OPPORTUNITY_PAUSED" },
    });
    expect(outboxCount).toBeGreaterThanOrEqual(1);
  });
});
