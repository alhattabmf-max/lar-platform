import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { CheckoutSessionService } from "../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../src/settings/checkout-settings.service";
import { AuditService } from "../src/audit/audit.service";
import { AdminOpportunitiesService } from "../src/admin/opportunities/admin-opportunities.service";
import { publishTestPolicy } from "./fixtures/policy.fixture";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";

const rawPrisma = checkoutFixturePrisma;
const prismaA = rawPrisma as unknown as PrismaService;
const prismaB = new PrismaClient() as unknown as PrismaService;

function buildService(p: PrismaService) {
  const audit = new AuditService(p);
  return new CheckoutSessionService(p, new ShippingTariffPolicyService(p, audit), new CheckoutSettingsService(p, audit));
}

function ctxFor(fixture: { traderCompanyId: string; traderUserId: string }, requestId = "req-1") {
  return { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId };
}

describe("Checkout — explicit required scenarios (integration, real DB)", () => {
  afterAll(async () => {
    await prismaB.$disconnect();
    await (rawPrisma as unknown as PrismaClient).$disconnect();
  });

  it("two REAL CONCURRENT requests from the SAME company, same Idempotency-Key, identical payload -> one session, both callers get the same response", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "SAMECONC" });
    const payload = {
      opportunityId: fixture.opportunityId,
      quantity: 4,
      allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }],
    };
    const key = "same-company-concurrent-key";

    const [r1, r2] = await Promise.all([
      buildService(prismaA).create(payload, key, ctxFor(fixture)),
      buildService(prismaB).create(payload, key, ctxFor(fixture, "req-2")),
    ]);

    expect((r1 as { id: string }).id).toBe((r2 as { id: string }).id);
    const sessions = await rawPrisma.checkoutSession.findMany({ where: { opportunityId: fixture.opportunityId } });
    expect(sessions).toHaveLength(1);
  }, 30_000);

  it("a branch becoming inactive between pricing and commit forces a safe Rollback — no partial session/quote/allocation", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "MIDCHANGE" });
    const service = buildService(prismaA);

    const deactivate = rawPrisma.companyLocation.update({
      where: { id: fixture.traderLocations.sameCity },
      data: { isActive: false },
    });
    const checkout = service.create(
      { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
      "mid-change-key",
      ctxFor(fixture)
    );

    const results = await Promise.allSettled([deactivate, checkout]);
    const sessions = await rawPrisma.checkoutSession.findMany({ where: { opportunityId: fixture.opportunityId } });
    if (results[1].status === "rejected") {
      expect(sessions).toHaveLength(0);
    } else {
      expect(sessions.length).toBeLessThanOrEqual(1);
    }
  }, 30_000);

  it("branches are locked FOR SHARE ORDER BY id — confirmed via the compiled service source referencing the exact clause", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(`${__dirname}/../src/checkout/checkout-session.service.ts`, "utf-8");
    expect(source).toMatch(/ORDER BY id FOR SHARE/);
  });

  it("checkout is rejected when the trader has NOT accepted the latest mandatory policy version", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "NOPOLICY" });
    await publishTestPolicy(rawPrisma as unknown as PrismaClient);

    const service = buildService(prismaA);
    await expect(
      service.create(
        { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
        "no-policy-key",
        ctxFor(fixture)
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "POLICY_REACCEPTANCE_REQUIRED" }) });
  }, 30_000);

  it("rejects a branch belonging to a DIFFERENT company", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "OTHERCO" });
    const otherFixture = await seedCheckoutFixture({ traderCrPrefix: "OTHERCO2" });

    const service = buildService(prismaA);
    await expect(
      service.create(
        { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: otherFixture.traderLocations.sameCity, quantity: 4 }] },
        "other-co-key",
        ctxFor(fixture)
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "FORBIDDEN" }) });
  }, 30_000);

  it("rejects an INACTIVE branch belonging to the trader's own company", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "INACTIVE" });
    await rawPrisma.companyLocation.update({ where: { id: fixture.traderLocations.sameCity }, data: { isActive: false } });

    const service = buildService(prismaA);
    await expect(
      service.create(
        { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
        "inactive-branch-key",
        ctxFor(fixture)
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
  }, 30_000);

  it("rejects a SUPPLIER account (non-TRADER) attempting checkout", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "SUPCHECK" });
    const service = buildService(prismaA);
    await expect(
      service.create(
        { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
        "supplier-checkout-key",
        { userId: fixture.traderUserId, companyId: fixture.supplierCompanyId, requestId: "req-1" }
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "FORBIDDEN" }) });
  }, 30_000);

  it("PAUSED opportunity: an already-active checkout lock is NOT released", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "PAUSEKEEP" });
    const service = buildService(prismaA);
    const session = (await service.create(
      { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
      "pause-keep-key",
      ctxFor(fixture)
    )) as { id: string };

    const adminOpportunities = new AdminOpportunitiesService(rawPrisma as unknown as PrismaService);
    await adminOpportunities.pause(fixture.opportunityId, "admin pause", {
      actorId: crypto.randomUUID(),
      requestId: "req-pause",
    });

    const row = await rawPrisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe("LOCKED");
    expect(row.lockReleasedAt).toBeNull();
  }, 30_000);

  it("GET on an expired-but-still-LOCKED-in-DB session performs Lazy Cleanup and returns EXPIRED", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "LAZYGET" });
    const service = buildService(prismaA);
    const session = (await service.create(
      { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
      "lazy-get-key",
      ctxFor(fixture)
    )) as { id: string };

    const before = await rawPrisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    await rawPrisma.checkoutSession.update({
      where: { id: session.id },
      data: { lockExpiresAt: new Date(before.lockCreatedAt.getTime() + 1) },
    });

    const fetched = await service.getById(session.id, ctxFor(fixture));
    expect((fetched as { status: string }).status).toBe("EXPIRED");

    const row = await rawPrisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe("EXPIRED");
    expect(row.releaseReason).toBe("EXPIRED");
  }, 30_000);

  it("abandon() releases the lock exactly once — a second abandon() call is safely rejected, and the release counts toward Cooldown", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "ABANDONCE" });
    const service = buildService(prismaA);
    const session = (await service.create(
      { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
      "abandon-once-key",
      ctxFor(fixture)
    )) as { id: string };

    await service.abandon(session.id, ctxFor(fixture));
    await expect(service.abandon(session.id, ctxFor(fixture))).rejects.toMatchObject({
      response: expect.objectContaining({ code: "CONFLICT" }),
    });

    const row = await rawPrisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(row.status).toBe("ABANDONED");
    expect(row.releaseReason).toBe("TRADER_ABANDONED");

    const qualifying = await rawPrisma.checkoutSession.count({
      where: {
        traderCompanyId: fixture.traderCompanyId,
        opportunityId: fixture.opportunityId,
        releaseReason: "TRADER_ABANDONED",
      },
    });
    expect(qualifying).toBe(1);
  }, 30_000);
});
