import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { OrderAllocationService } from "../src/fulfillment/order-allocation.service";
import { ShippingWebhookService } from "../src/fulfillment/shipping-webhook.service";
import { ShippingProviderRegistry } from "../src/fulfillment/providers/shipping-provider.registry";
import { MockShippingProvider } from "../src/fulfillment/providers/mock-shipping.provider";
import { seedFulfillmentFixture, fulfillmentFixturePrisma } from "./fixtures/fulfillment.fixture";

const prisma = fulfillmentFixturePrisma;

function buildService(p: PrismaService = prisma as unknown as PrismaService) {
  return new OrderAllocationService(p);
}

async function shipBothAllocations(fixture: { orderAllocationIds: string[]; supplierCompanyId: string }) {
  const service = buildService();
  const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r-ship" };
  for (const id of fixture.orderAllocationIds) {
    await service.startPreparation(id, supplierCtx);
    await service.markReady(id, supplierCtx);
    await service.ship(id, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACK-${id.slice(0, 8)}-${Date.now()}` }, supplierCtx);
  }
}

describe("MasterOrder FULFILLED — real concurrent delivery of the last two allocations (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("delivering the last two allocations via two truly concurrent operations: both DELIVERED, MasterOrder FULFILLED exactly once, one Audit/Outbox entry", async () => {
    const fixture = await seedFulfillmentFixture("CONCFULFIL");
    await shipBothAllocations(fixture);

    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();
    const serviceA = buildService(prismaA as unknown as PrismaService);
    const serviceB = buildService(prismaB as unknown as PrismaService);

    const traderCtxA = { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-a" };
    const traderCtxB = { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-b" };

    const [resultA, resultB] = await Promise.all([
      serviceA.confirmDeliveryByTrader(fixture.orderAllocationIds[0], traderCtxA),
      serviceB.confirmDeliveryByTrader(fixture.orderAllocationIds[1], traderCtxB),
    ]);

    await prismaA.$disconnect();
    await prismaB.$disconnect();

    expect(resultA.status).toBe("DELIVERED");
    expect(resultB.status).toBe("DELIVERED");

    const order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    expect(order.status).toBe("FULFILLED");

    const fulfilledAudits = await prisma.auditLog.count({ where: { entityId: fixture.masterOrderId, action: "MASTER_ORDER_FULFILLED" } });
    expect(fulfilledAudits).toBe(1);

    const outboxEvents = await prisma.outboxEvent.findMany({ where: { eventType: "MASTER_ORDER_FULFILLED" } });
    const matching = outboxEvents.filter((e) => (e.payload as Record<string, unknown>).masterOrderId === fixture.masterOrderId);
    expect(matching).toHaveLength(1);

    const allocations = await prisma.orderAllocation.findMany({ where: { id: { in: fixture.orderAllocationIds } } });
    expect(allocations.every((a) => a.status === "DELIVERED")).toBe(true);
  }, 30_000);
});

describe("ShippingWebhookService (integration, real DB)", () => {
  const provider = new MockShippingProvider();

  function buildWebhookService() {
    const registry = new ShippingProviderRegistry();
    registry.register(provider);
    return new ShippingWebhookService(prisma as unknown as PrismaService, registry, buildService());
  }

  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("a valid DELIVERED webhook confirms delivery via CARRIER_WEBHOOK source", async () => {
    const fixture = await seedFulfillmentFixture("WHDELIVER");
    await shipBothAllocations(fixture);
    const service = buildWebhookService();
    const allocationId = fixture.orderAllocationIds[0];

    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: allocationId,
      carrierEventId: `evt-${allocationId}`,
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    const result = await service.handleWebhook("MOCK_CARRIER", rawBody, headers);
    expect(result.processingOutcome).toBe("DELIVERED");

    const allocation = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: allocationId } });
    expect(allocation.status).toBe("DELIVERED");
    const confirmation = await prisma.deliveryConfirmation.findUniqueOrThrow({ where: { orderAllocationId: allocationId } });
    expect(confirmation.confirmedBySource).toBe("CARRIER_WEBHOOK");
    expect(confirmation.carrierTrackingEventId).not.toBeNull();
  }, 30_000);

  it("a non-DELIVERED tracking event (IN_TRANSIT) is RECORDED and never changes allocation status", async () => {
    const fixture = await seedFulfillmentFixture("WHTRANSIT");
    await shipBothAllocations(fixture);
    const service = buildWebhookService();
    const allocationId = fixture.orderAllocationIds[0];

    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: allocationId,
      carrierEventId: `evt-transit-${allocationId}`,
      eventType: "IN_TRANSIT",
      eventOccurredAt: new Date(),
    });
    const result = await service.handleWebhook("MOCK_CARRIER", rawBody, headers);
    expect(result.processingOutcome).toBe("RECORDED");

    const allocation = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: allocationId } });
    expect(allocation.status).toBe("SHIPPED");
  }, 30_000);

  it("a duplicate DELIVERED webhook (identical event) returns the same outcome, no new event/confirmation row", async () => {
    const fixture = await seedFulfillmentFixture("WHDUP");
    await shipBothAllocations(fixture);
    const service = buildWebhookService();
    const allocationId = fixture.orderAllocationIds[0];

    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: allocationId,
      carrierEventId: `evt-dup-${allocationId}`,
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    const r1 = await service.handleWebhook("MOCK_CARRIER", rawBody, headers);
    const r2 = await service.handleWebhook("MOCK_CARRIER", rawBody, headers);
    expect(r1).toEqual(r2);

    const events = await prisma.carrierTrackingEvent.count({ where: { carrierEventId: `evt-dup-${allocationId}` } });
    expect(events).toBe(1);
    const confirmations = await prisma.deliveryConfirmation.count({ where: { orderAllocationId: allocationId } });
    expect(confirmations).toBe(1);
  }, 30_000);

  it("a SECOND, genuinely different DELIVERED event for an already-delivered allocation is IGNORED_ALREADY_DELIVERED", async () => {
    const fixture = await seedFulfillmentFixture("WHIGNOREDDUP");
    await shipBothAllocations(fixture);
    const service = buildWebhookService();
    const allocationId = fixture.orderAllocationIds[0];

    const first = provider.buildSignedWebhook({
      orderAllocationReference: allocationId,
      carrierEventId: `evt-first-${allocationId}`,
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    const r1 = await service.handleWebhook("MOCK_CARRIER", first.rawBody, first.headers);
    expect(r1.processingOutcome).toBe("DELIVERED");

    const second = provider.buildSignedWebhook({
      orderAllocationReference: allocationId,
      carrierEventId: `evt-second-${allocationId}`,
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    const r2 = await service.handleWebhook("MOCK_CARRIER", second.rawBody, second.headers);
    expect(r2.processingOutcome).toBe("IGNORED_ALREADY_DELIVERED");

    const confirmations = await prisma.deliveryConfirmation.count({ where: { orderAllocationId: allocationId } });
    expect(confirmations).toBe(1);
  }, 30_000);

  it("same carrierEventId with a DIFFERENT payload hash is rejected as a security incident", async () => {
    const fixture = await seedFulfillmentFixture("WHHASHMISMATCH");
    await shipBothAllocations(fixture);
    const service = buildWebhookService();
    const allocationId = fixture.orderAllocationIds[0];
    const eventId = `evt-hashmismatch-${allocationId}`;

    const first = provider.buildSignedWebhook({
      orderAllocationReference: allocationId,
      carrierEventId: eventId,
      eventType: "IN_TRANSIT",
      eventOccurredAt: new Date(),
    });
    await service.handleWebhook("MOCK_CARRIER", first.rawBody, first.headers);

    const second = provider.buildSignedWebhook({
      orderAllocationReference: allocationId,
      carrierEventId: eventId,
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    await expect(service.handleWebhook("MOCK_CARRIER", second.rawBody, second.headers)).rejects.toThrow();

    const events = await prisma.carrierTrackingEvent.count({ where: { carrierEventId: eventId } });
    expect(events).toBe(1);
  }, 30_000);

  it("a webhook with a wrong signature is rejected before any DB write", async () => {
    const fixture = await seedFulfillmentFixture("WHBADSIG");
    await shipBothAllocations(fixture);
    const service = buildWebhookService();
    const allocationId = fixture.orderAllocationIds[0];

    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: allocationId,
      carrierEventId: `evt-badsig-${allocationId}`,
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    const tampered = { ...headers, "x-mock-shipping-signature": "0".repeat(64) };
    await expect(service.handleWebhook("MOCK_CARRIER", rawBody, tampered)).rejects.toThrow();

    const events = await prisma.carrierTrackingEvent.count({ where: { carrierEventId: `evt-badsig-${allocationId}` } });
    expect(events).toBe(0);
  }, 30_000);

  it("an unregistered carrier in the URL is rejected outright (404-equivalent)", async () => {
    const service = buildWebhookService();
    const { rawBody, headers } = provider.buildSignedWebhook({
      orderAllocationReference: "does-not-matter",
      carrierEventId: "evt-unknown-carrier",
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    await expect(service.handleWebhook("SOME_UNKNOWN_CARRIER", rawBody, headers)).rejects.toThrow();
  }, 30_000);
});
