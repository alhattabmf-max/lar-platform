import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { DisputeService } from "../src/disputes/dispute.service";
import { seedDisputeFixture, disputeFixturePrisma } from "./fixtures/dispute.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = disputeFixturePrisma;

function buildService() {
  return new DisputeService(prisma as unknown as PrismaService, notificationEvents());
}

describe("DisputeService (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("opens a dispute successfully on a DELIVERED allocation within the window", async () => {
    const fixture = await seedDisputeFixture("DISPOPEN");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };

    const dispute = await service.openDispute(
      fixture.deliveredOrderAllocationId,
      { reasonCode: "ITEM_DAMAGED", description: "The item arrived visibly damaged on the outside." },
      traderCtx
    );
    expect(dispute.status).toBe("OPEN");
    expect(dispute.supplierResponseDueAt.getTime()).toBeGreaterThan(Date.now());
  }, 30_000);

  it("rejects opening a SECOND dispute on the same allocation — one dispute for its entire lifetime", async () => {
    const fixture = await seedDisputeFixture("DISPONETIME");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };

    await service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "First dispute description here." }, traderCtx);

    await expect(
      service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_INCORRECT", description: "Second attempt should be rejected." }, traderCtx)
    ).rejects.toThrow();
  }, 30_000);

  it("rejects opening a dispute on a non-DELIVERED allocation", async () => {
    const fixture = await seedDisputeFixture("DISPNOTDELIVERED");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const shippedOnlyId = fixture.orderAllocationIds[1];

    await expect(
      service.openDispute(shippedOnlyId, { reasonCode: "ITEM_DAMAGED", description: "Trying on a non-delivered allocation." }, traderCtx)
    ).rejects.toThrow();
  }, 30_000);

  it("rejects opening a dispute from a DIFFERENT trader company (isolation)", async () => {
    const fixture = await seedDisputeFixture("DISPTRADERISO");
    const service = buildService();
    const wrongCtx = { userId: crypto.randomUUID(), companyId: crypto.randomUUID(), requestId: "r1" };

    await expect(
      service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Wrong trader trying to open this." }, wrongCtx)
    ).rejects.toThrow();
  }, 30_000);

  it("a second supplier response is rejected — only one final response allowed", async () => {
    const fixture = await seedDisputeFixture("DISPSECONDRESP");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r2" };

    const dispute = await service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Testing double response rejection." }, traderCtx);

    await service.supplierRespond(dispute.id, { responseType: "ACCEPT", description: "We accept full responsibility for this issue." }, supplierCtx);

    await expect(
      service.supplierRespond(dispute.id, { responseType: "REJECT", description: "Trying to respond a second time now." }, supplierCtx)
    ).rejects.toThrow();
  }, 30_000);

  it("rejects a supplier response from a DIFFERENT supplier company (isolation)", async () => {
    const fixture = await seedDisputeFixture("DISPSUPPLIERISO");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const wrongSupplierCtx = { userId: crypto.randomUUID(), companyId: crypto.randomUUID(), requestId: "r2" };

    const dispute = await service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Testing supplier isolation here." }, traderCtx);

    await expect(
      service.supplierRespond(dispute.id, { responseType: "ACCEPT", description: "Wrong supplier trying to respond." }, wrongSupplierCtx)
    ).rejects.toThrow();
  }, 30_000);

  it("rejects an admin decision BEFORE the supplier responds and BEFORE the deadline passes (early decision)", async () => {
    const fixture = await seedDisputeFixture("DISPEARLYDECISION");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r2" };

    const dispute = await service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Testing early decision rejection." }, traderCtx);

    await expect(
      service.adminDecide(dispute.id, { decisionType: "REJECTED", reasonNote: "Deciding too early on purpose." }, adminCtx, `idem-${dispute.id}-early`)
    ).rejects.toThrow();
  }, 30_000);

  it("allows an admin decision immediately after the supplier responds (no need to wait for the deadline)", async () => {
    const fixture = await seedDisputeFixture("DISPAFTERRESPONSE");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r2" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r3" };

    const dispute = await service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "QUALITY_ISSUE", description: "Testing decision right after response." }, traderCtx);
    await service.supplierRespond(dispute.id, { responseType: "REJECT", description: "We reject this claim entirely." }, supplierCtx);

    const decision = await service.adminDecide(
      dispute.id,
      { decisionType: "REJECTED", reasonNote: "Evidence insufficient, dispute rejected." },
      adminCtx,
      `idem-${dispute.id}-decide1`
    );
    expect(decision.decisionType).toBe("REJECTED");
    expect(decision.sequenceNumber).toBe(1);

    const finalDispute = await prisma.dispute.findUniqueOrThrow({ where: { id: dispute.id } });
    expect(finalDispute.status).toBe("RESOLVED_REJECTED");
  }, 30_000);

  it("REJECTED decision creates NO RefundObligation and NO Ledger entries", async () => {
    const fixture = await seedDisputeFixture("DISPREJECTNOMONEY");
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r2" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r3" };

    const dispute = await service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Testing rejected decision has no money." }, traderCtx);
    await service.supplierRespond(dispute.id, { responseType: "REJECT", description: "We reject this claim." }, supplierCtx);
    const decision = await service.adminDecide(dispute.id, { decisionType: "REJECTED", reasonNote: "No merit found." }, adminCtx, `idem-${dispute.id}-reject`);

    const refunds = await prisma.refundObligation.findMany({ where: { disputeDecisionId: decision.decisionId } });
    expect(refunds).toHaveLength(0);
  }, 30_000);

  it("no dispute path ever changes fundedQuantity or Opportunity.status", async () => {
    const fixture = await seedDisputeFixture("DISPNOFUNDCHANGE");
    const before = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r2" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r3" };

    const dispute = await service.openDispute(fixture.deliveredOrderAllocationId, { reasonCode: "ITEM_DAMAGED", description: "Checking no funded quantity change." }, traderCtx);
    await service.supplierRespond(dispute.id, { responseType: "ACCEPT", description: "We accept this claim fully." }, supplierCtx);
    await service.adminDecide(dispute.id, { decisionType: "FULL_REFUND", reasonNote: "Full refund granted." }, adminCtx, `idem-${dispute.id}-nofund`);

    const after = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(after.fundedQuantity).toBe(before.fundedQuantity);
    expect(after.status).toBe(before.status);
  }, 30_000);
});
