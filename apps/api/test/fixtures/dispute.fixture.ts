import type { PrismaService } from "../../src/database/prisma.service";
import { OrderAllocationService } from "../../src/fulfillment/order-allocation.service";
import { seedFulfillmentFixture, fulfillmentFixturePrisma } from "./fulfillment.fixture";

const prisma = fulfillmentFixturePrisma;

export interface DisputeFixture {
  opportunityId: string;
  supplierCompanyId: string;
  traderCompanyId: string;
  traderUserId: string;
  masterOrderId: string;
  orderAllocationIds: string[];
  deliveredOrderAllocationId: string;
}

/** Full pipeline through 7D delivery for the FIRST allocation, leaving the second SHIPPED-only for isolation tests. */
export async function seedDisputeFixture(prefix: string): Promise<DisputeFixture> {
  const base = await seedFulfillmentFixture(prefix);
  const service = new OrderAllocationService(prisma as unknown as PrismaService);
  const supplierCtx = { userId: crypto.randomUUID(), companyId: base.supplierCompanyId, requestId: `r-dispute-fixture-${prefix}` };
  const traderCtx = { userId: base.traderUserId, companyId: base.traderCompanyId, requestId: `r-dispute-fixture-trader-${prefix}` };

  const deliveredId = base.orderAllocationIds[0];
  await service.startPreparation(deliveredId, supplierCtx);
  await service.markReady(deliveredId, supplierCtx);
  await service.ship(deliveredId, { carrierCode: "MOCK_CARRIER", trackingNumber: `DISPTRACK-${deliveredId.slice(0, 8)}-${Date.now()}` }, supplierCtx);
  await service.confirmDeliveryByTrader(deliveredId, traderCtx);

  return { ...base, deliveredOrderAllocationId: deliveredId };
}

export { prisma as disputeFixturePrisma };
