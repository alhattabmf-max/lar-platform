import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { OrderAllocationService } from "../src/fulfillment/order-allocation.service";
import { seedFulfillmentFixture, fulfillmentFixturePrisma } from "./fixtures/fulfillment.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";

const prisma = fulfillmentFixturePrisma;

function buildService() {
  return new OrderAllocationService(prisma as unknown as PrismaService, notificationEvents());
}

describe("OrderAllocationService — full flow + direct DB constraints (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("full sequence via the service: start -> ready -> ship -> trader confirms delivery; both allocations delivered -> MasterOrder FULFILLED once", async () => {
    const fixture = await seedFulfillmentFixture("FULLFLOW");
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    const traderCtx = { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r2" };

    for (const allocationId of fixture.orderAllocationIds) {
      const started = await service.startPreparation(allocationId, supplierCtx);
      expect(started.status).toBe("PREPARING");
      expect(started.preparationStartedAt).not.toBeNull();

      const ready = await service.markReady(allocationId, supplierCtx);
      expect(ready.status).toBe("READY_TO_SHIP");
      expect(ready.readyToShipAt).not.toBeNull();

      const shipped = await service.ship(allocationId, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACK123${allocationId.slice(0, 4)}${Date.now()}` }, supplierCtx);
      expect(shipped.status).toBe("SHIPPED");
      expect(shipped.shippedAt).not.toBeNull();

      const tracking = await prisma.shipmentTracking.findUniqueOrThrow({ where: { orderAllocationId: allocationId } });
      expect(tracking.carrierCode).toBe("MOCK_CARRIER");
    }

    const delivered1 = await service.confirmDeliveryByTrader(fixture.orderAllocationIds[0], traderCtx);
    expect(delivered1.status).toBe("DELIVERED");
    let order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    expect(order.status).toBe("IN_FULFILLMENT");

    const delivered2 = await service.confirmDeliveryByTrader(fixture.orderAllocationIds[1], traderCtx);
    expect(delivered2.status).toBe("DELIVERED");
    order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    expect(order.status).toBe("FULFILLED");

    const confirmations = await prisma.deliveryConfirmation.findMany({
      where: { orderAllocationId: { in: fixture.orderAllocationIds } },
    });
    expect(confirmations).toHaveLength(2);
    expect(confirmations.every((c) => c.confirmedBySource === "TRADER_CONFIRMATION")).toBe(true);

    const fulfilledAudits = await prisma.auditLog.count({ where: { entityId: fixture.masterOrderId, action: "MASTER_ORDER_FULFILLED" } });
    expect(fulfilledAudits).toBe(1);
    const relevantOutbox = await prisma.outboxEvent.findMany({ where: { eventType: "MASTER_ORDER_FULFILLED" } });
    const matching = relevantOutbox.filter((e) => (e.payload as Record<string, unknown>).masterOrderId === fixture.masterOrderId);
    expect(matching).toHaveLength(1);
  }, 30_000);

  it("admin can confirm delivery with a reason note; rejects an empty reason note", async () => {
    const fixture = await seedFulfillmentFixture("ADMINCONF");
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    const adminCtx = { userId: crypto.randomUUID(), requestId: "r3" };
    const allocationId = fixture.orderAllocationIds[0];

    await service.startPreparation(allocationId, supplierCtx);
    await service.markReady(allocationId, supplierCtx);
    await service.ship(allocationId, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACKADMIN${Date.now()}` }, supplierCtx);

    await expect(service.confirmDeliveryByAdmin(allocationId, "", adminCtx)).rejects.toThrow();

    const delivered = await service.confirmDeliveryByAdmin(allocationId, "Carrier lost tracking, trader confirmed by phone", adminCtx);
    expect(delivered.status).toBe("DELIVERED");
    const confirmation = await prisma.deliveryConfirmation.findUniqueOrThrow({ where: { orderAllocationId: allocationId } });
    expect(confirmation.confirmedBySource).toBe("ADMIN_DECISION");
    expect(confirmation.adminReasonNote).not.toBeNull();
  }, 30_000);

  it("the supplier cannot act on an allocation belonging to a different supplier company", async () => {
    const fixture = await seedFulfillmentFixture("WRONGSUP");
    const service = buildService();
    const wrongCtx = { userId: crypto.randomUUID(), companyId: "00000000-0000-0000-0000-000000000000", requestId: "r1" };
    await expect(service.startPreparation(fixture.orderAllocationIds[0], wrongCtx)).rejects.toThrow();
  }, 30_000);

  it("the trader cannot confirm delivery for an allocation belonging to a different trader company", async () => {
    const fixture = await seedFulfillmentFixture("WRONGTRD");
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    await service.startPreparation(fixture.orderAllocationIds[0], supplierCtx);
    await service.markReady(fixture.orderAllocationIds[0], supplierCtx);
    await service.ship(fixture.orderAllocationIds[0], { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACKWRONG${Date.now()}` }, supplierCtx);

    const wrongTraderCtx = { userId: crypto.randomUUID(), companyId: "00000000-0000-0000-0000-000000000000", requestId: "r2" };
    await expect(service.confirmDeliveryByTrader(fixture.orderAllocationIds[0], wrongTraderCtx)).rejects.toThrow();
  }, 30_000);

  it("DB: rejects skipping a state (AWAITING_PREPARATION -> SHIPPED directly)", async () => {
    const fixture = await seedFulfillmentFixture("DBSKIP");
    await expect(
      prisma.$executeRaw`UPDATE order_allocations SET status = 'SHIPPED', shipped_at = now() WHERE id = ${fixture.orderAllocationIds[0]}::uuid`
    ).rejects.toThrow(/invalid or disallowed transition/);
  });

  it("DB: rejects modifying a timestamp column WITHOUT changing status", async () => {
    const fixture = await seedFulfillmentFixture("DBTSONLY");
    await expect(
      prisma.$executeRaw`UPDATE order_allocations SET preparation_started_at = now() WHERE id = ${fixture.orderAllocationIds[0]}::uuid`
    ).rejects.toThrow(/invalid or disallowed transition/);
  });

  it("DB: rejects re-editing an already-filled timestamp (second write)", async () => {
    const fixture = await seedFulfillmentFixture("DBTSREDO");
    const id = fixture.orderAllocationIds[0];
    await prisma.$executeRaw`UPDATE order_allocations SET status = 'PREPARING', preparation_started_at = now() WHERE id = ${id}::uuid`;
    await expect(
      prisma.$executeRaw`UPDATE order_allocations SET status = 'PREPARING', preparation_started_at = now() WHERE id = ${id}::uuid`
    ).rejects.toThrow(/invalid or disallowed transition/);
  });

  it("DB: SHIPPED status without a ShipmentTracking row is rejected at COMMIT (deferred check)", async () => {
    const fixture = await seedFulfillmentFixture("DBNOTRACK");
    const id = fixture.orderAllocationIds[0];
    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE order_allocations SET status = 'PREPARING', preparation_started_at = now() WHERE id = ${id}::uuid`;
          await tx.$executeRaw`UPDATE order_allocations SET status = 'READY_TO_SHIP', ready_to_ship_at = now() WHERE id = ${id}::uuid`;
          await tx.$executeRaw`UPDATE order_allocations SET status = 'SHIPPED', shipped_at = now() WHERE id = ${id}::uuid`;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_shipped_has_tracking IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/requires exactly one shipment_tracking row/);
  }, 15_000);

  it("DB: DELIVERED status without a DeliveryConfirmation row is rejected at COMMIT (deferred check)", async () => {
    const fixture = await seedFulfillmentFixture("DBNOCONF");
    const id = fixture.orderAllocationIds[0];
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    await service.startPreparation(id, supplierCtx);
    await service.markReady(id, supplierCtx);
    await service.ship(id, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACKNOCONF${Date.now()}` }, supplierCtx);

    await expect(
      (async () => {
        await (prisma as unknown as PrismaClient).$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE order_allocations SET status = 'DELIVERED', delivered_at = now(), dispute_window_closes_at = now() + interval '7 days' WHERE id = ${id}::uuid`;
          await tx.$executeRawUnsafe(`SET CONSTRAINTS trg_check_delivered_has_confirmation IMMEDIATE`);
        });
      })()
    ).rejects.toThrow(/requires exactly one delivery_confirmations row/);
  }, 15_000);

  it("DB: rejects an expectedPreparationDays of 0 (must be >= 1)", async () => {
    const fixture = await seedFulfillmentFixture("DBMINDAYS");

    // A fully independent, real checkout (via the real service, which
    // creates its own QuoteSnapshot) gives us a valid
    // CheckoutLocationAllocation FK target for this DB-level CHECK test.
    const { seedCheckoutFixture } = await import("./fixtures/checkout.fixture");
    const { CheckoutSessionService } = await import("../src/checkout/checkout-session.service");
    const { ShippingTariffPolicyService } = await import("../src/settings/shipping-tariff-policy.service");
    const { CheckoutSettingsService } = await import("../src/settings/checkout-settings.service");
    const { AuditService } = await import("../src/audit/audit.service");
    const audit = new AuditService(prisma as unknown as PrismaService);
    const checkoutService = new CheckoutSessionService(
      prisma as unknown as PrismaService,
      new ShippingTariffPolicyService(prisma as unknown as PrismaService, audit),
      new CheckoutSettingsService(prisma as unknown as PrismaService, audit)
    );
    const independentFixture = await seedCheckoutFixture({ traderCrPrefix: "DBMINDAYS2" });
    const session = (await checkoutService.create(
      { opportunityId: independentFixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: independentFixture.traderLocations.sameCity, quantity: 4 }] },
      `dbmindays-${Date.now()}`,
      { userId: independentFixture.traderUserId, companyId: independentFixture.traderCompanyId, requestId: "r-dbmindays" }
    )) as { id: string };
    const cla = await prisma.checkoutLocationAllocation.findFirstOrThrow({ where: { checkoutSessionId: session.id } });

    await expect(
      prisma.$executeRaw`
        INSERT INTO order_allocations (id, master_order_id, checkout_location_allocation_id, expected_preparation_days, preparation_due_at)
        VALUES (gen_random_uuid(), ${fixture.masterOrderId}::uuid, ${cla.id}::uuid, 0, now())
      `
    ).rejects.toThrow(/expected_preparation_days_positive/);
  }, 15_000);

  it("DB: MasterOrder cannot transition FULFILLED -> IN_FULFILLMENT (no reversal)", async () => {
    const fixture = await seedFulfillmentFixture("DBNOREV");
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    const traderCtx = { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r2" };
    for (const id of fixture.orderAllocationIds) {
      await service.startPreparation(id, supplierCtx);
      await service.markReady(id, supplierCtx);
      await service.ship(id, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACKNOREV${id.slice(0, 4)}${Date.now()}` }, supplierCtx);
      await service.confirmDeliveryByTrader(id, traderCtx);
    }
    const order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    expect(order.status).toBe("FULFILLED");

    await expect(
      prisma.$executeRaw`UPDATE master_orders SET status = 'IN_FULFILLMENT' WHERE id = ${fixture.masterOrderId}::uuid`
    ).rejects.toThrow(/only IN_FULFILLMENT -> FULFILLED is a legal status transition/);
  }, 30_000);

  it("DB: DeliveryConfirmation source-field consistency — TRADER_CONFIRMATION with a non-null adminReasonNote is rejected", async () => {
    const fixture = await seedFulfillmentFixture("DBSRCFIELD");
    const id = fixture.orderAllocationIds[0];
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    await service.startPreparation(id, supplierCtx);
    await service.markReady(id, supplierCtx);
    await service.ship(id, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACKSRCF${Date.now()}` }, supplierCtx);

    await expect(
      prisma.deliveryConfirmation.create({
        data: {
          orderAllocationId: id,
          confirmedBySource: "TRADER_CONFIRMATION",
          confirmedAt: new Date(),
          confirmedByUserId: crypto.randomUUID(),
          adminReasonNote: "this should not be allowed here",
        },
      })
    ).rejects.toThrow(/delivery_confirmations_source_fields_consistency/);
  }, 15_000);

  it("no path in this file ever changes fundedQuantity regardless of opportunity status", async () => {
    const fixture = await seedFulfillmentFixture("NOFUNDCHANGE");
    const before = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).fundedQuantity;
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    const traderCtx = { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r2" };
    for (const id of fixture.orderAllocationIds) {
      await service.startPreparation(id, supplierCtx);
      await service.markReady(id, supplierCtx);
      await service.ship(id, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACKNOFUND${id.slice(0, 4)}${Date.now()}` }, supplierCtx);
      await service.confirmDeliveryByTrader(id, traderCtx);
    }
    const after = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).fundedQuantity;
    expect(after).toBe(before);
  }, 30_000);

  it("an opportunity status change (PAUSED, EXPIRED, or CANCELLED) mid-fulfillment never stops delivery and never touches fundedQuantity", async () => {
    for (const opportunityStatus of ["PAUSED", "EXPIRED", "CANCELLED"] as const) {
      const fixture = await seedFulfillmentFixture(`OPPSTATUS${opportunityStatus}`);
      const service = buildService();
      const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
      const traderCtx = { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r2" };

      const before = (await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).fundedQuantity;

      // Ship the first allocation, THEN flip the opportunity's status —
      // this must not block or alter the rest of the fulfillment flow.
      const [allocA, allocB] = fixture.orderAllocationIds;
      await service.startPreparation(allocA, supplierCtx);
      await service.markReady(allocA, supplierCtx);
      await service.ship(allocA, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACKOPPSTATUS${opportunityStatus}A${Date.now()}` }, supplierCtx);

      await prisma.opportunity.update({ where: { id: fixture.opportunityId }, data: { status: opportunityStatus } });

      // Fulfillment continues unaffected by the opportunity status change.
      const delivered = await service.confirmDeliveryByTrader(allocA, traderCtx);
      expect(delivered.status).toBe("DELIVERED");

      await service.startPreparation(allocB, supplierCtx);
      await service.markReady(allocB, supplierCtx);
      await service.ship(allocB, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACKOPPSTATUS${opportunityStatus}B${Date.now()}` }, supplierCtx);
      await service.confirmDeliveryByTrader(allocB, traderCtx);

      const order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
      expect(order.status).toBe("FULFILLED");

      const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
      expect(opportunity.status).toBe(opportunityStatus); // still whatever we set it to — fulfillment never reverts it
      expect(opportunity.fundedQuantity).toBe(before); // completely untouched
    }
  }, 60_000);
});
