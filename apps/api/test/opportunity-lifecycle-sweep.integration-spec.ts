import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { runOpportunityLifecycleSweep } from "@platform/opportunity-lifecycle";

const prisma = new PrismaClient();

async function seedOpportunity(overrides: {
  status: "ACTIVE" | "PAUSED";
  targetQuantity: number;
  fundedQuantity: number;
  endAt: Date;
}): Promise<string> {
  const company = await prisma.company.create({
    data: {
      crNumber: `CR-SWEEP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      legalName: "Sweep Test Co",
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
    data: { productId: product.id, approvalSource: "ADMIN", snapshot: { salesUnitId: unit.id }, approvedByAdminId: crypto.randomUUID() },
  });
  const region = await prisma.region.create({ data: { nameAr: "r", nameEn: "r" } });
  const city = await prisma.city.create({ data: { regionId: region.id, nameAr: "c", nameEn: "c" } });
  const location = await prisma.companyLocation.create({
    data: {
      companyId: company.id,
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
      targetQuantity: overrides.targetQuantity,
      fundedQuantity: overrides.fundedQuantity,
      unitPriceAmount: 10,
      startAt: new Date(Date.now() - 3 * 3600_000),
      endAt: overrides.endAt,
      expectedPreparationDays: 3,
      status: overrides.status,
      firstActivatedAt: new Date(Date.now() - 3 * 3600_000),
      pausedAt: overrides.status === "PAUSED" ? new Date(Date.now() - 1800_000) : null,
      pauseReason: overrides.status === "PAUSED" ? "test hold" : null,
      taxRatePercent: 15,
      unitPriceExclTaxAmount: 8.7,
      unitTaxAmount: 1.3,
      taxCalculationRuleCode: "DEFAULT",
      taxCalculationRuleVersion: "v1",
      totalValueInclTaxAmount: overrides.targetQuantity * 10,
      shareTierPolicyVersionId: policyV1.id,
      shareTierIndex: 0,
      shareBasisPoints: 1000,
      shareQuantity: Math.floor((overrides.targetQuantity * 1000) / 10000) || 1,
      salesUnitNameAr: "a",
      salesUnitNameEn: "a",
      commissionPolicyVersionId: commissionV1.id,
      commissionRateBasisPoints: commissionV1.rateBasisPoints,
    },
  });

  return opp.id;
}

describe("runOpportunityLifecycleSweep — worker never touches fundedQuantity or orders (integration, real DB)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ACTIVE -> EXPIRED (window closed, partially sold) leaves fundedQuantity completely unchanged", async () => {
    const id = await seedOpportunity({
      status: "ACTIVE",
      targetQuantity: 100,
      fundedQuantity: 40,
      endAt: new Date(Date.now() - 1000),
    });

    await runOpportunityLifecycleSweep(prisma);

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("EXPIRED");
    expect(row.fundedQuantity).toBe(40);
  });

  it("PAUSED -> EXPIRED (window closed while paused, partially sold) leaves fundedQuantity completely unchanged", async () => {
    const id = await seedOpportunity({
      status: "PAUSED",
      targetQuantity: 100,
      fundedQuantity: 40,
      endAt: new Date(Date.now() - 1000),
    });

    await runOpportunityLifecycleSweep(prisma);

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("EXPIRED");
    expect(row.fundedQuantity).toBe(40);
  });

  it("ACTIVE -> FUNDED (supply cap fully sold) leaves fundedQuantity exactly as it was — no reset, no reversal", async () => {
    const id = await seedOpportunity({
      status: "ACTIVE",
      targetQuantity: 100,
      fundedQuantity: 100,
      endAt: new Date(Date.now() + 5 * 24 * 3600_000),
    });

    await runOpportunityLifecycleSweep(prisma);

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("FUNDED");
    expect(row.fundedQuantity).toBe(100);
  });

  it("a partially-sold ACTIVE opportunity still within its window is untouched by either path", async () => {
    const id = await seedOpportunity({
      status: "ACTIVE",
      targetQuantity: 100,
      fundedQuantity: 40,
      endAt: new Date(Date.now() + 5 * 24 * 3600_000),
    });

    await runOpportunityLifecycleSweep(prisma);

    const row = await prisma.opportunity.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("ACTIVE");
    expect(row.fundedQuantity).toBe(40);
  });

  it("Outbox payloads for OPPORTUNITY_EXPIRED/OPPORTUNITY_FUNDED never carry an order-command field, though metadata is fine", async () => {
    const expiredId = await seedOpportunity({
      status: "ACTIVE",
      targetQuantity: 100,
      fundedQuantity: 40,
      endAt: new Date(Date.now() - 1000),
    });
    const fundedId = await seedOpportunity({
      status: "ACTIVE",
      targetQuantity: 100,
      fundedQuantity: 100,
      endAt: new Date(Date.now() + 5 * 24 * 3600_000),
    });

    await runOpportunityLifecycleSweep(prisma);

    const events = await prisma.outboxEvent.findMany({
      where: { eventType: { in: ["OPPORTUNITY_EXPIRED", "OPPORTUNITY_FUNDED"] } },
    });
    const relevant = events.filter((e) => {
      const payload = e.payload as Record<string, unknown>;
      return payload.opportunityId === expiredId || payload.opportunityId === fundedId;
    });
    expect(relevant.length).toBeGreaterThanOrEqual(2);

    for (const event of relevant) {
      const payload = event.payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty("cancelOrders");
      expect(payload).not.toHaveProperty("refundOrders");
      expect(payload).not.toHaveProperty("orderIds");
      expect(payload).not.toHaveProperty("cancelPendingOrders");
      const keys = Object.keys(payload).join(",").toLowerCase();
      expect(keys).not.toMatch(/cancel|refund/);
    }
  });

  it("the sweep's SQL never references any table other than opportunities/audit_logs/outbox_events (structural, source-level)", () => {
    const rawSource = readFileSync(require.resolve("@platform/opportunity-lifecycle/dist/sweep.js"), "utf-8");
    // Strip comments first — prose inside JSDoc/line comments legitimately
    // contains words like "UPDATE"/"FROM" in ordinary English sentences,
    // which must never be misread as SQL table references.
    const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const allowedTables = ["opportunities", "audit_logs", "outbox_events", "batch"];
    const tableMentions = source.match(/(?<!FOR )(?:FROM|JOIN|UPDATE|INTO)\s+"?(\w+)"?/gi) ?? [];
    for (const mention of tableMentions) {
      const table = mention
        .replace(/(?:FROM|JOIN|UPDATE|INTO)\s+"?/i, "")
        .replace(/"$/, "")
        .toLowerCase();
      if (table === "skip") continue; // "FOR UPDATE SKIP LOCKED" — a locking hint, not a table reference
      expect(allowedTables).toContain(table);
    }
  });
});
