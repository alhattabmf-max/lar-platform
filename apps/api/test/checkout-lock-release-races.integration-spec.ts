import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { runOpportunityLifecycleSweep } from "@platform/opportunity-lifecycle";
import { CheckoutSessionService } from "../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../src/settings/checkout-settings.service";
import { AuditService } from "../src/audit/audit.service";
import { AdminOpportunitiesService } from "../src/admin/opportunities/admin-opportunities.service";
import { AdminProductsService } from "../src/admin/products/admin-products.service";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";

const rawPrisma = checkoutFixturePrisma;
const prismaA = rawPrisma as unknown as PrismaService;
const prismaB = new PrismaClient() as unknown as PrismaService;

function buildCheckoutService(p: PrismaService) {
  const audit = new AuditService(p);
  return new CheckoutSessionService(p, new ShippingTariffPolicyService(p, audit), new CheckoutSettingsService(p, audit));
}

function ctxFor(fixture: { traderCompanyId: string; traderUserId: string }) {
  return { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-1" };
}

async function createLockedSession(fixture: Awaited<ReturnType<typeof seedCheckoutFixture>>, key: string) {
  const service = buildCheckoutService(prismaA);
  return service.create(
    { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocationId, quantity: 4 }] },
    key,
    ctxFor(fixture)
  ) as Promise<{ id: string }>;
}

describe("Checkout lock release races and side effects (integration, real DB)", () => {
  afterAll(async () => {
    await prismaB.$disconnect();
    await (rawPrisma as unknown as PrismaClient).$disconnect();
  });

  it("the batched Worker sweep and request-time Lazy Cleanup racing the SAME expired lock produce exactly one transition and exactly one CHECKOUT_LOCK_EXPIRED event", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "RACEEXP" });
    const session = await createLockedSession(fixture, "race-expiry-key");

    const before = await rawPrisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    await rawPrisma.checkoutSession.update({
      where: { id: session.id },
      data: { lockExpiresAt: new Date(before.lockCreatedAt.getTime() + 1) },
    });

    const checkoutServiceB = buildCheckoutService(prismaB);

    await Promise.all([
      runOpportunityLifecycleSweep(rawPrisma as unknown as PrismaClient),
      checkoutServiceB.getById(session.id, ctxFor(fixture)),
    ]);

    const row = await rawPrisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe("EXPIRED");
    expect(row.releaseReason).toBe("EXPIRED");

    const auditCount = await rawPrisma.auditLog.count({
      where: { entityId: session.id, action: "CHECKOUT_LOCK_EXPIRED" },
    });
    expect(auditCount).toBe(1);

    const outbox = await rawPrisma.outboxEvent.findMany({ where: { eventType: "CHECKOUT_LOCK_EXPIRED" } });
    const relevant = outbox.filter((e) => (e.payload as Record<string, unknown>).checkoutSessionId === session.id);
    expect(relevant).toHaveLength(1);
  }, 30_000);

  it("cancelling an opportunity releases its active checkout lock, leaves fundedQuantity untouched, and audits with no address/phone data", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "CANCELREL" });
    await rawPrisma.opportunity.update({ where: { id: fixture.opportunityId }, data: { fundedQuantity: 17 } });
    const session = await createLockedSession(fixture, "cancel-release-key");

    const adminOpportunities = new AdminOpportunitiesService(rawPrisma as unknown as PrismaService);
    await adminOpportunities.cancel(fixture.opportunityId, "test cancellation", { actorId: crypto.randomUUID(), requestId: "req-cancel" });

    const row = await rawPrisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe("ABANDONED");
    expect(row.releaseReason).toBe("OPPORTUNITY_CANCELLED");

    const opp = await rawPrisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opp.fundedQuantity).toBe(17);

    const audit = await rawPrisma.auditLog.findFirst({
      where: { entityId: session.id, action: "CHECKOUT_LOCK_ABANDONED" },
    });
    expect(audit).not.toBeNull();
    const auditText = JSON.stringify(audit);
    expect(auditText).not.toMatch(/addr|shortAddress|contactPhone|\+9665/);

    const outboxEvent = await rawPrisma.outboxEvent.findFirst({
      where: { eventType: "CHECKOUT_LOCK_ABANDONED" },
    });
    const outboxText = JSON.stringify(outboxEvent?.payload);
    expect(outboxText).not.toMatch(/addr|shortAddress|contactPhone|\+9665/);
  }, 30_000);

  it("closing a product releases the checkout lock on its cascaded-CANCELLED opportunity, leaving fundedQuantity untouched", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "CLOSEREL" });
    await rawPrisma.opportunity.update({ where: { id: fixture.opportunityId }, data: { fundedQuantity: 9 } });
    const session = await createLockedSession(fixture, "close-release-key");

    const productId = (await rawPrisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } })).productId;
    const adminProducts = new AdminProductsService(rawPrisma as unknown as PrismaService, new AuditService(rawPrisma as unknown as PrismaService));
    await adminProducts.close(productId, "test product close", crypto.randomUUID(), { requestId: "req-close" });

    const row = await rawPrisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe("ABANDONED");
    expect(row.releaseReason).toBe("OPPORTUNITY_CANCELLED");

    const opp = await rawPrisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opp.status).toBe("CANCELLED");
    expect(opp.fundedQuantity).toBe(9);
  }, 30_000);

  it("CHECKOUT_LOCK_CREATED audit/outbox never contain address or phone snapshot fields", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "NOLEAK" });
    const session = await createLockedSession(fixture, "no-leak-key");

    const audit = await rawPrisma.auditLog.findFirst({
      where: { entityId: session.id, action: "CHECKOUT_LOCK_CREATED" },
    });
    const auditText = JSON.stringify(audit);
    expect(auditText).not.toMatch(/addr|shortAddress|contactPhone|contactName|\+9665/);

    const outboxEvent = await rawPrisma.outboxEvent.findFirst({
      where: { eventType: "CHECKOUT_LOCK_CREATED" },
      orderBy: { createdAt: "desc" },
    });
    const outboxText = JSON.stringify(outboxEvent?.payload);
    expect(outboxText).not.toMatch(/addr|shortAddress|contactPhone|contactName|\+9665/);
  }, 30_000);
});
