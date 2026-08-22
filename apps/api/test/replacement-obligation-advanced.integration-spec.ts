import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { ReplacementObligationService } from "../src/replacement/replacement-obligation.service";
import { ReplacementShippingWebhookService } from "../src/replacement/replacement-shipping-webhook.service";
import { DisputeService } from "../src/disputes/dispute.service";
import { ShippingProviderRegistry } from "../src/fulfillment/providers/shipping-provider.registry";
import { MockShippingProvider } from "../src/fulfillment/providers/mock-shipping.provider";
import { seedReplacementFixture, replacementFixturePrisma } from "./fixtures/replacement.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = replacementFixturePrisma;

function buildService(p: PrismaService = prisma as unknown as PrismaService) {
  return new ReplacementObligationService(p, notificationEvents());
}

async function shipReplacement(fixture: { replacementObligationId: string; supplierCompanyId: string }) {
  const service = buildService();
  const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r-ship" };
  await service.startPreparation(fixture.replacementObligationId, supplierCtx);
  await service.markReady(fixture.replacementObligationId, supplierCtx);
  await service.ship(fixture.replacementObligationId, { carrierCode: "MOCK_CARRIER", trackingNumber: `REPLADV-${Date.now()}` }, supplierCtx);
}

describe("ReplacementObligationService — races, decision sequencing, webhook (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("race: DELIVERED vs mark-failed on the same replacement — exactly one wins, dispute state is consistent", async () => {
    const fixture = await seedReplacementFixture("REPLRACEDELFAIL");
    await shipReplacement(fixture);

    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();
    const serviceA = buildService(prismaA as unknown as PrismaService);
    const serviceB = buildService(prismaB as unknown as PrismaService);

    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r-a" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r-b" };

    const results = await Promise.allSettled([
      serviceA.confirmDeliveryByTrader(fixture.replacementObligationId, traderCtx),
      serviceB.markFailed(fixture.replacementObligationId, adminCtx),
    ]);

    await prismaA.$disconnect();
    await prismaB.$disconnect();

    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded).toHaveLength(1);

    const finalObligation = await prisma.replacementObligation.findUniqueOrThrow({ where: { id: fixture.replacementObligationId } });
    expect(["DELIVERED", "FAILED"]).toContain(finalObligation.status);

    const finalDispute = await prisma.dispute.findUniqueOrThrow({ where: { id: fixture.disputeId } });
    if (finalObligation.status === "DELIVERED") {
      expect(finalDispute.status).toBe("RESOLVED_REPLACED");
    } else {
      expect(finalDispute.status).toBe("AWAITING_REPLACEMENT");
    }
  }, 30_000);

  it("delivering the replacement closes the dispute exactly once — Audit recorded once, no duplicate close on retry", async () => {
    const fixture = await seedReplacementFixture("REPLCLOSEONCE");
    await shipReplacement(fixture);
    const service = buildService();
    const traderCtx = { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" };

    await service.confirmDeliveryByTrader(fixture.replacementObligationId, traderCtx);

    const resolvedAudits = await prisma.auditLog.count({ where: { entityId: fixture.disputeId, action: "DISPUTE_RESOLVED_REPLACED" } });
    expect(resolvedAudits).toBe(1);

    await expect(service.confirmDeliveryByTrader(fixture.replacementObligationId, traderCtx)).rejects.toThrow();
    const resolvedAuditsAfter = await prisma.auditLog.count({ where: { entityId: fixture.disputeId, action: "DISPUTE_RESOLVED_REPLACED" } });
    expect(resolvedAuditsAfter).toBe(1);
  }, 30_000);

  it("a FAILED replacement allows a second decision (FULL_REFUND) via the real service, and a third decision is rejected", async () => {
    const fixture = await seedReplacementFixture("REPLSECONDDECISION");
    const replacementService = buildService();
    const disputeService = new DisputeService(prisma as unknown as PrismaService, notificationEvents());
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r1" };

    await replacementService.markFailed(fixture.replacementObligationId, adminCtx);

    const secondDecision = await disputeService.adminDecide(
      fixture.disputeId,
      { decisionType: "FULL_REFUND", reasonNote: "Replacement failed, issuing full refund instead." },
      adminCtx,
      `idem-${fixture.disputeId}-second`
    );
    expect(secondDecision.sequenceNumber).toBe(2);
    expect(secondDecision.decisionType).toBe("FULL_REFUND");

    const finalDispute = await prisma.dispute.findUniqueOrThrow({ where: { id: fixture.disputeId } });
    expect(finalDispute.status).toBe("RESOLVED_ACCEPTED");

    await expect(
      disputeService.adminDecide(fixture.disputeId, { decisionType: "REJECTED", reasonNote: "Trying a third." }, adminCtx, `idem-${fixture.disputeId}-third`)
    ).rejects.toThrow();

    const decisionCount = await prisma.disputeDecision.count({ where: { disputeId: fixture.disputeId } });
    expect(decisionCount).toBe(2);
  }, 30_000);

  it("replacement shipping webhook: valid DELIVERED event confirms delivery via CARRIER_WEBHOOK, independent idempotency scope", async () => {
    const fixture = await seedReplacementFixture("REPLWEBHOOK");
    await shipReplacement(fixture);

    const provider = new MockShippingProvider();
    const registry = new ShippingProviderRegistry();
    registry.register(provider);
    const webhookService = new ReplacementShippingWebhookService(prisma as unknown as PrismaService, registry, buildService());

    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: fixture.replacementObligationId,
      carrierEventId: `evt-repl-${fixture.replacementObligationId}`,
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });

    const result = await webhookService.handleWebhook("MOCK_CARRIER", rawBody, headers);
    expect(result.processingOutcome).toBe("DELIVERED");

    const obligation = await prisma.replacementObligation.findUniqueOrThrow({ where: { id: fixture.replacementObligationId } });
    expect(obligation.status).toBe("DELIVERED");
    const confirmation = await prisma.replacementDeliveryConfirmation.findUniqueOrThrow({ where: { replacementObligationId: fixture.replacementObligationId } });
    expect(confirmation.confirmedBySource).toBe("CARRIER_WEBHOOK");

    const replay = await webhookService.handleWebhook("MOCK_CARRIER", rawBody, headers);
    expect(replay).toEqual(result);
    const events = await prisma.replacementCarrierTrackingEvent.count({ where: { carrierEventId: `evt-repl-${fixture.replacementObligationId}` } });
    expect(events).toBe(1);
  }, 30_000);

  it("replacement webhook: same eventId with a DIFFERENT payload hash is rejected as a security incident", async () => {
    const fixture = await seedReplacementFixture("REPLWEBHOOKSEC");
    await shipReplacement(fixture);

    const provider = new MockShippingProvider();
    const registry = new ShippingProviderRegistry();
    registry.register(provider);
    const webhookService = new ReplacementShippingWebhookService(prisma as unknown as PrismaService, registry, buildService());
    const eventId = `evt-replsec-${fixture.replacementObligationId}`;

    const first = provider.buildSignedWebhook({
      orderAllocationReference: fixture.replacementObligationId,
      carrierEventId: eventId,
      eventType: "IN_TRANSIT",
      eventOccurredAt: new Date(),
    });
    await webhookService.handleWebhook("MOCK_CARRIER", first.rawBody, first.headers);

    const second = provider.buildSignedWebhook({
      orderAllocationReference: fixture.replacementObligationId,
      carrierEventId: eventId,
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    await expect(webhookService.handleWebhook("MOCK_CARRIER", second.rawBody, second.headers)).rejects.toThrow();
  }, 30_000);

  it("replacement webhook: an unregistered carrier is rejected outright", async () => {
    const provider = new MockShippingProvider();
    const registry = new ShippingProviderRegistry();
    registry.register(provider);
    const webhookService = new ReplacementShippingWebhookService(prisma as unknown as PrismaService, registry, buildService());

    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: "does-not-matter",
      carrierEventId: "evt-unknown",
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    await expect(webhookService.handleWebhook("SOME_UNKNOWN_CARRIER", rawBody, headers)).rejects.toThrow();
  }, 30_000);
});
