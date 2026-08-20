import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { OrderAllocationService } from "../src/fulfillment/order-allocation.service";
import { seedFulfillmentFixture, fulfillmentFixturePrisma } from "./fixtures/fulfillment.fixture";

const prisma = fulfillmentFixturePrisma;

function buildService() {
  return new OrderAllocationService(prisma as unknown as PrismaService);
}

async function shipOne(fixture: { orderAllocationIds: string[]; supplierCompanyId: string }, idx = 0) {
  const service = buildService();
  const ctx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r-ship" };
  const id = fixture.orderAllocationIds[idx];
  await service.startPreparation(id, ctx);
  await service.markReady(id, ctx);
  await service.ship(id, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACK-${id.slice(0, 8)}-${Date.now()}` }, ctx);
  return id;
}

describe("Migration 63 — direct DB-level constraint verification (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("rejects a CARRIER_WEBHOOK confirmation carrying a non-null adminReasonNote", async () => {
    const fixture = await seedFulfillmentFixture("M63CWREASON");
    const id = await shipOne(fixture);
    const tracking = await prisma.shipmentTracking.findUniqueOrThrow({ where: { orderAllocationId: id } });
    const event = await prisma.carrierTrackingEvent.create({
      data: {
        shipmentTrackingId: tracking.id,
        carrierCode: "MOCK_CARRIER",
        carrierEventId: `evt-${id}-${Date.now()}`,
        eventType: "DELIVERED",
        eventOccurredAt: new Date(),
        processingOutcome: "DELIVERED",
        payloadHash: "hash",
        payloadMetadataRedacted: {},
      },
    });

    await expect(
      prisma.deliveryConfirmation.create({
        data: {
          orderAllocationId: id,
          confirmedBySource: "CARRIER_WEBHOOK",
          confirmedAt: new Date(),
          carrierTrackingEventId: event.id,
          adminReasonNote: "this must not be allowed on a carrier webhook confirmation",
        },
      })
    ).rejects.toThrow(/delivery_confirmations_source_fields_consistency/);
  });

  it("rejects a TRADER_CONFIRMATION carrying a non-null adminReasonNote", async () => {
    const fixture = await seedFulfillmentFixture("M63TRDREASON");
    const id = await shipOne(fixture);

    await expect(
      prisma.deliveryConfirmation.create({
        data: {
          orderAllocationId: id,
          confirmedBySource: "TRADER_CONFIRMATION",
          confirmedAt: new Date(),
          confirmedByUserId: crypto.randomUUID(),
          adminReasonNote: "this must not be allowed on a trader confirmation",
        },
      })
    ).rejects.toThrow(/delivery_confirmations_source_fields_consistency/);
  });

  it("rejects an ADMIN_DECISION with a NULL/empty adminReasonNote", async () => {
    const fixture = await seedFulfillmentFixture("M63ADMINEMPTY");
    const id = await shipOne(fixture);

    // NULL adminReasonNote — rejected at the DB CHECK level directly.
    await expect(
      prisma.deliveryConfirmation.create({
        data: {
          orderAllocationId: id,
          confirmedBySource: "ADMIN_DECISION",
          confirmedAt: new Date(),
          confirmedByUserId: crypto.randomUUID(),
          adminReasonNote: null,
        },
      })
    ).rejects.toThrow(/delivery_confirmations_source_fields_consistency/);

    // Empty-string reason is rejected at the application level (service), tested separately —
    // here we confirm the service itself refuses it before ever reaching the DB.
    const service = buildService();
    await expect(
      service.confirmDeliveryByAdmin(id, "", { userId: crypto.randomUUID(), requestId: "r-empty" })
    ).rejects.toThrow();
    await expect(
      service.confirmDeliveryByAdmin(id, "   ", { userId: crypto.randomUUID(), requestId: "r-empty-2" })
    ).rejects.toThrow();
  });

  it("rejects MasterOrder FULFILLED -> IN_FULFILLMENT directly at the DB level (no reversal, no skip)", async () => {
    const fixture = await seedFulfillmentFixture("M63NOREVDIRECT");
    const service = buildService();
    const supplierCtx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    const traderCtx = { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r2" };
    for (const id of fixture.orderAllocationIds) {
      await service.startPreparation(id, supplierCtx);
      await service.markReady(id, supplierCtx);
      await service.ship(id, { carrierCode: "MOCK_CARRIER", trackingNumber: `TRACK-${id.slice(0, 8)}-${Date.now()}` }, supplierCtx);
      await service.confirmDeliveryByTrader(id, traderCtx);
    }
    const order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    expect(order.status).toBe("FULFILLED");

    await expect(
      prisma.$executeRaw`UPDATE master_orders SET status = 'IN_FULFILLMENT' WHERE id = ${fixture.masterOrderId}::uuid`
    ).rejects.toThrow(/only IN_FULFILLMENT -> FULFILLED is a legal status transition/);
  }, 30_000);

  it("rejects an empty (or whitespace-only) carrierCode on shipment_tracking", async () => {
    const fixture = await seedFulfillmentFixture("M63EMPTYCARRIER");
    const service = buildService();
    const ctx = { userId: crypto.randomUUID(), companyId: fixture.supplierCompanyId, requestId: "r1" };
    const id = fixture.orderAllocationIds[0];
    await service.startPreparation(id, ctx);
    await service.markReady(id, ctx);

    // The service itself trims and rejects an empty carrierCode before ever reaching the DB.
    await expect(service.ship(id, { carrierCode: "   ", trackingNumber: "VALIDTRACK1" }, ctx)).rejects.toThrow();

    // Direct DB-level proof: even bypassing the service, the CHECK constraint itself rejects it.
    await expect(
      prisma.$executeRaw`
        INSERT INTO shipment_tracking (id, order_allocation_id, carrier_code, tracking_number, shipped_by_user_id)
        VALUES (gen_random_uuid(), ${id}::uuid, '   ', 'VALIDTRACKDB1', ${ctx.userId}::uuid)
      `
    ).rejects.toThrow(/shipment_tracking_carrier_code_non_empty/);
  });

  it("rejects an empty tracking_number on shipment_tracking (length CHECK)", async () => {
    const fixture = await seedFulfillmentFixture("M63EMPTYTRACK");
    const id = fixture.orderAllocationIds[0];
    await expect(
      prisma.$executeRaw`
        INSERT INTO shipment_tracking (id, order_allocation_id, carrier_code, tracking_number, shipped_by_user_id)
        VALUES (gen_random_uuid(), ${id}::uuid, 'MOCK_CARRIER', '', ${crypto.randomUUID()}::uuid)
      `
    ).rejects.toThrow(/shipment_tracking_tracking_number_length/);
  });

  it("rejects an empty carrier_code on carrier_tracking_events", async () => {
    const fixture = await seedFulfillmentFixture("M63EMPTYCTECARRIER");
    const id = await shipOne(fixture);
    const tracking = await prisma.shipmentTracking.findUniqueOrThrow({ where: { orderAllocationId: id } });
    await expect(
      prisma.$executeRaw`
        INSERT INTO carrier_tracking_events (id, shipment_tracking_id, carrier_code, carrier_event_id, event_type, event_occurred_at, processing_outcome, payload_hash, payload_metadata_redacted)
        VALUES (gen_random_uuid(), ${tracking.id}::uuid, '', 'evt-empty-carrier', 'IN_TRANSIT', now(), 'RECORDED', 'hash', '{}'::jsonb)
      `
    ).rejects.toThrow(/carrier_tracking_events_carrier_code_non_empty/);
  });

  it("rejects an empty carrier_event_id on carrier_tracking_events", async () => {
    const fixture = await seedFulfillmentFixture("M63EMPTYCTEID");
    const id = await shipOne(fixture);
    const tracking = await prisma.shipmentTracking.findUniqueOrThrow({ where: { orderAllocationId: id } });
    await expect(
      prisma.$executeRaw`
        INSERT INTO carrier_tracking_events (id, shipment_tracking_id, carrier_code, carrier_event_id, event_type, event_occurred_at, processing_outcome, payload_hash, payload_metadata_redacted)
        VALUES (gen_random_uuid(), ${tracking.id}::uuid, 'MOCK_CARRIER', '', 'IN_TRANSIT', now(), 'RECORDED', 'hash', '{}'::jsonb)
      `
    ).rejects.toThrow(/carrier_tracking_events_carrier_event_id_non_empty/);
  });

  it("rejects a whitespace-only carrier_event_id (btrim catches it, not just empty string)", async () => {
    const fixture = await seedFulfillmentFixture("M63WSCTEID");
    const id = await shipOne(fixture);
    const tracking = await prisma.shipmentTracking.findUniqueOrThrow({ where: { orderAllocationId: id } });
    await expect(
      prisma.$executeRaw`
        INSERT INTO carrier_tracking_events (id, shipment_tracking_id, carrier_code, carrier_event_id, event_type, event_occurred_at, processing_outcome, payload_hash, payload_metadata_redacted)
        VALUES (gen_random_uuid(), ${tracking.id}::uuid, 'MOCK_CARRIER', '   ', 'IN_TRANSIT', now(), 'RECORDED', 'hash', '{}'::jsonb)
      `
    ).rejects.toThrow(/carrier_tracking_events_carrier_event_id_non_empty/);
  });
});
