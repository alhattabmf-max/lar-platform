import type { PrismaService } from "../src/database/prisma.service";
import { CheckoutSessionService } from "../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../src/settings/checkout-settings.service";
import { AuditService } from "../src/audit/audit.service";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";

const rawPrisma = checkoutFixturePrisma;
const prisma = rawPrisma as unknown as PrismaService;

function buildService() {
  const audit = new AuditService(prisma);
  const shippingTariff = new ShippingTariffPolicyService(prisma, audit);
  const checkoutSettings = new CheckoutSettingsService(prisma, audit);
  return new CheckoutSessionService(prisma, shippingTariff, checkoutSettings);
}

function ctxFor(fixture: { traderCompanyId: string; traderUserId: string }) {
  return { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-1" };
}

describe("Checkout Idempotency (integration, real DB)", () => {
  afterAll(async () => {
    await rawPrisma.$disconnect();
  });

  it("two DIFFERENT trader companies using the identical Idempotency-Key string never collide or leak into each other's session", async () => {
    const fixtureA = await seedCheckoutFixture({ traderCrPrefix: "IDKA" });
    const fixtureB = await seedCheckoutFixture({ traderCrPrefix: "IDKB" });
    const service = buildService();
    const sameKey = `identical-key-used-by-two-companies-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const [sessionA, sessionB] = await Promise.all([
      service.create(
        { opportunityId: fixtureA.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixtureA.traderLocationId, quantity: 4 }] },
        sameKey,
        ctxFor(fixtureA)
      ),
      service.create(
        { opportunityId: fixtureB.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixtureB.traderLocationId, quantity: 4 }] },
        sameKey,
        ctxFor(fixtureB)
      ),
    ]);

    expect((sessionA as { id: string }).id).not.toBe((sessionB as { id: string }).id);

    const rowA = await rawPrisma.checkoutSession.findUniqueOrThrow({ where: { id: (sessionA as { id: string }).id } });
    const rowB = await rawPrisma.checkoutSession.findUniqueOrThrow({ where: { id: (sessionB as { id: string }).id } });
    expect(rowA.traderCompanyId).toBe(fixtureA.traderCompanyId);
    expect(rowB.traderCompanyId).toBe(fixtureB.traderCompanyId);

    const keys = await rawPrisma.idempotencyKey.findMany({ where: { key: sameKey } });
    expect(keys).toHaveLength(2);
    expect(new Set(keys.map((k) => k.scope)).size).toBe(2);
  }, 30_000);

  it("a deliberate failure AFTER the idempotency key is claimed leaves NO lingering IN_PROGRESS row — the whole transaction rolls back together", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "IDKFAIL" });
    const service = buildService();
    const key = "will-fail-after-claim";

    await expect(
      service.create(
        {
          opportunityId: fixture.opportunityId,
          quantity: 4,
          allocations: [{ companyLocationId: fixture.traderLocationId, quantity: 3 }],
        },
        key,
        ctxFor(fixture)
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });

    const row = await rawPrisma.idempotencyKey.findFirst({ where: { key } });
    expect(row).toBeNull();

    const sessions = await rawPrisma.checkoutSession.findMany({ where: { opportunityId: fixture.opportunityId } });
    expect(sessions).toHaveLength(0);
  }, 30_000);

  it("replaying the identical request with the same key returns the SAME session and never creates a second Audit or Outbox entry", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "IDKREPLAY" });
    const service = buildService();
    const key = "replay-me";
    const payload = {
      opportunityId: fixture.opportunityId,
      quantity: 4,
      allocations: [{ companyLocationId: fixture.traderLocationId, quantity: 4 }],
    };

    const first = (await service.create(payload, key, ctxFor(fixture))) as { id: string };
    const second = (await service.create(payload, key, ctxFor(fixture))) as { id: string };

    expect(second.id).toBe(first.id);

    const auditCount = await rawPrisma.auditLog.count({
      where: { entityId: first.id, action: "CHECKOUT_LOCK_CREATED" },
    });
    expect(auditCount).toBe(1);

    const outbox = await rawPrisma.outboxEvent.findMany({ where: { eventType: "CHECKOUT_LOCK_CREATED" } });
    const relevant = outbox.filter((e) => (e.payload as Record<string, unknown>).checkoutSessionId === first.id);
    expect(relevant).toHaveLength(1);
  }, 30_000);

  it("replaying the same key with a DIFFERENT payload is rejected with 409, and creates no second session", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "IDKDIFF" });
    const service = buildService();
    const key = "same-key-different-payload";

    await service.create(
      { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocationId, quantity: 4 }] },
      key,
      ctxFor(fixture)
    );

    await expect(
      service.create(
        { opportunityId: fixture.opportunityId, quantity: 8, allocations: [{ companyLocationId: fixture.traderLocationId, quantity: 8 }] },
        key,
        ctxFor(fixture)
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "CONFLICT" }) });

    const sessions = await rawPrisma.checkoutSession.findMany({ where: { opportunityId: fixture.opportunityId } });
    expect(sessions).toHaveLength(1);
  }, 30_000);
});
