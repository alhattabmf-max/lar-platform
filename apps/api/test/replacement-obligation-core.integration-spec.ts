import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { ReplacementObligationService } from "../src/replacement/replacement-obligation.service";
import { seedReplacementFixture, replacementFixturePrisma } from "./fixtures/replacement.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = replacementFixturePrisma;

function buildService(p: PrismaService = prisma as unknown as PrismaService) {
  return new ReplacementObligationService(p, notificationEvents());
}

describe("ReplacementObligationService — core lifecycle (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("full sequence: start -> ready -> ship -> trader confirms delivery -> Dispute RESOLVED_REPLACED", async () => {
    const fixture = await seedReplacementFixture("REPLFULLFLOW");
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r2" };

    const started = await service.startPreparation(fixture.replacementObligationId, supplierCtx);
    expect(started.status).toBe("PREPARING");
    expect(started.preparationStartedAt).not.toBeNull();

    const ready = await service.markReady(fixture.replacementObligationId, supplierCtx);
    expect(ready.status).toBe("READY_TO_SHIP");

    const shipped = await service.ship(fixture.replacementObligationId, { carrierCode: "MOCK_CARRIER", trackingNumber: `REPLTRACK-${Date.now()}` }, supplierCtx);
    expect(shipped.status).toBe("SHIPPED");

    const tracking = await prisma.replacementShipmentTracking.findUniqueOrThrow({ where: { replacementObligationId: fixture.replacementObligationId } });
    expect(tracking.carrierCode).toBe("MOCK_CARRIER");

    const delivered = await service.confirmDeliveryByTrader(fixture.replacementObligationId, traderCtx);
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.deliveredAt).not.toBeNull();

    const finalDispute = await prisma.dispute.findUniqueOrThrow({ where: { id: fixture.disputeId } });
    expect(finalDispute.status).toBe("RESOLVED_REPLACED");

    const confirmation = await prisma.replacementDeliveryConfirmation.findUniqueOrThrow({ where: { replacementObligationId: fixture.replacementObligationId } });
    expect(confirmation.confirmedBySource).toBe("TRADER_CONFIRMATION");
  }, 30_000);

  it("DB: rejects skipping a state (AWAITING_PREPARATION -> SHIPPED directly)", async () => {
    const fixture = await seedReplacementFixture("REPLSKIP");
    await expect(
      prisma.$executeRaw`UPDATE replacement_obligations SET status = 'SHIPPED', shipped_at = now() WHERE id = ${fixture.replacementObligationId}::uuid`
    ).rejects.toThrow(/invalid or disallowed transition/);
  });

  it("DB: rejects re-editing an already-filled timestamp", async () => {
    const fixture = await seedReplacementFixture("REPLTSREDO");
    const id = fixture.replacementObligationId;
    await prisma.$executeRaw`UPDATE replacement_obligations SET status = 'PREPARING', preparation_started_at = now() WHERE id = ${id}::uuid`;
    await expect(
      prisma.$executeRaw`UPDATE replacement_obligations SET status = 'PREPARING', preparation_started_at = now() WHERE id = ${id}::uuid`
    ).rejects.toThrow(/invalid or disallowed transition/);
  });

  it("DB: a replacementQuantity greater than the original allocation quantity is rejected directly at the DB level (bypassing the application-level check)", async () => {
    const fixture = await seedReplacementFixture("REPLQTYCAP");
    const decisionRow = await prisma.disputeDecision.create({
      data: {
        disputeId: fixture.disputeId,
        sequenceNumber: 2, // won't actually be reached — insert fails before this matters
        decisionType: "REPLACEMENT",
        reasonNote: "Direct DB-level quantity cap test.",
        decidedByAdminUserId: crypto.randomUUID(),
      },
    });
    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO replacement_obligations (id, dispute_decision_id, original_order_allocation_id, replacement_quantity)
            VALUES (gen_random_uuid(), ${decisionRow.id}::uuid, ${fixture.deliveredOrderAllocationId}::uuid, 999)
          `;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_replacement_quantity_within_original IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/exceeds the original allocation quantity/);
  }, 30_000);

  it("DB: SHIPPED status without a ReplacementShipmentTracking row is rejected at deferred COMMIT", async () => {
    const fixture = await seedReplacementFixture("REPLNOTRACK");
    const id = fixture.replacementObligationId;
    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE replacement_obligations SET status = 'PREPARING', preparation_started_at = now() WHERE id = ${id}::uuid`;
          await tx.$executeRaw`UPDATE replacement_obligations SET status = 'READY_TO_SHIP', ready_to_ship_at = now() WHERE id = ${id}::uuid`;
          await tx.$executeRaw`UPDATE replacement_obligations SET status = 'SHIPPED', shipped_at = now() WHERE id = ${id}::uuid`;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_replacement_shipped_has_tracking IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/requires exactly one replacement_shipment_tracking row/);
  }, 15_000);

  it("DB: DELIVERED status without a ReplacementDeliveryConfirmation row is rejected at deferred COMMIT", async () => {
    const fixture = await seedReplacementFixture("REPLNOCONF");
    const id = fixture.replacementObligationId;
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    await service.startPreparation(id, supplierCtx);
    await service.markReady(id, supplierCtx);
    await service.ship(id, { carrierCode: "MOCK_CARRIER", trackingNumber: `REPLNOCONF-${Date.now()}` }, supplierCtx);

    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE replacement_obligations SET status = 'DELIVERED', delivered_at = now() WHERE id = ${id}::uuid`;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_replacement_delivered_has_confirmation IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/requires exactly one replacement_delivery_confirmations row/);
  }, 15_000);

  it("a supplier from a DIFFERENT company cannot act on this replacement", async () => {
    const fixture = await seedReplacementFixture("REPLSUPISO");
    const service = buildService();
    const wrongCtx = { userId: crypto.randomUUID(), companyId: crypto.randomUUID(), requestId: "r1" };
    await expect(service.startPreparation(fixture.replacementObligationId, wrongCtx)).rejects.toThrow();
  }, 30_000);

  it("a trader from a DIFFERENT company cannot confirm delivery for this replacement", async () => {
    const fixture = await seedReplacementFixture("REPLTRDISO");
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    await service.startPreparation(fixture.replacementObligationId, supplierCtx);
    await service.markReady(fixture.replacementObligationId, supplierCtx);
    await service.ship(fixture.replacementObligationId, { carrierCode: "MOCK_CARRIER", trackingNumber: `REPLTRDISO-${Date.now()}` }, supplierCtx);

    const wrongTraderCtx = { userId: crypto.randomUUID(), companyId: crypto.randomUUID(), requestId: "r2" };
    await expect(service.confirmDeliveryByTrader(fixture.replacementObligationId, wrongTraderCtx)).rejects.toThrow();
  }, 30_000);

  it("mark-failed leaves the dispute AWAITING_REPLACEMENT (unchanged)", async () => {
    const fixture = await seedReplacementFixture("REPLFAILEDMIN");
    const service = buildService();
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r1" };
    const failed = await service.markFailed(fixture.replacementObligationId, "Carrier confirmed the parcel was never delivered", adminCtx);
    expect(failed.status).toBe("FAILED");
    expect(failed.failedAt).not.toBeNull();

    const dispute = await prisma.dispute.findUniqueOrThrow({ where: { id: fixture.disputeId } });
    expect(dispute.status).toBe("AWAITING_REPLACEMENT");
  }, 30_000);

  it("no replacement path ever changes fundedQuantity, Opportunity.status, the original OrderAllocation, or creates Ledger entries", async () => {
    const fixture = await seedReplacementFixture("REPLNOSIDEFX");
    const opportunityBefore = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    const allocationBefore = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: fixture.deliveredOrderAllocationId } });

    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r2" };
    await service.startPreparation(fixture.replacementObligationId, supplierCtx);
    await service.markReady(fixture.replacementObligationId, supplierCtx);
    await service.ship(fixture.replacementObligationId, { carrierCode: "MOCK_CARRIER", trackingNumber: `REPLNOSIDEFX-${Date.now()}` }, supplierCtx);
    await service.confirmDeliveryByTrader(fixture.replacementObligationId, traderCtx);

    const opportunityAfter = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opportunityAfter.fundedQuantity).toBe(opportunityBefore.fundedQuantity);
    expect(opportunityAfter.status).toBe(opportunityBefore.status);

    const allocationAfter = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: fixture.deliveredOrderAllocationId } });
    expect(allocationAfter.status).toBe(allocationBefore.status);
    expect(allocationAfter.payoutSettledAt).toBeNull();

    const journalEntries = await prisma.journalEntry.count({ where: { referenceType: "replacement_obligation" } });
    expect(journalEntries).toBe(0);
  }, 30_000);
});
