import type { PrismaService } from "../src/database/prisma.service";
import { CheckoutSessionService } from "../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../src/settings/checkout-settings.service";
import { AuditService } from "../src/audit/audit.service";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { PrismaClient } from "@prisma/client";

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

describe("CheckoutSessionService — core scenarios (integration, real DB)", () => {
  afterAll(async () => {
    await prismaB.$disconnect();
    await (rawPrisma as unknown as PrismaClient).$disconnect();
  });

  it("two DIFFERENT traders racing for the LAST available quantity: exactly one succeeds", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "RACEQTY" });
    await rawPrisma.opportunity.update({ where: { id: fixture.opportunityId }, data: { fundedQuantity: 96 } });

    const otherTrader = await rawPrisma.company.create({
      data: {
        crNumber: `CR-RACEQTY2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        legalName: "Other Trader",
        accountType: "TRADER",
        verificationStatus: "VERIFIED",
      },
    });
    const otherUser = await rawPrisma.user.create({
      data: {
        companyId: otherTrader.id,
        email: `other-${Date.now()}@example.com`,
        passwordHash: "x",
        primaryMobile1: "+966500000001",
        primaryMobile2: "+966500000002",
      },
    });
    const opp = await rawPrisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    const otherLocation = await rawPrisma.companyLocation.create({
      data: {
        companyId: otherTrader.id,
        cityId: opp.fulfillmentCityId!,
        name: "other-loc",
        shortAddress: "addr",
        latitude: 24.7,
        longitude: 46.7,
        contactName: "n",
        contactPhone: "+966500000001",
        isDefault: true,
      },
    });
    const mandatoryPolicies = await rawPrisma.policyVersion.findMany({ where: { isPublished: true, isMandatory: true } });
    for (const p of mandatoryPolicies) {
      await rawPrisma.policyAcceptance.create({
        data: { policyVersionId: p.id, companyId: otherTrader.id, userId: otherUser.id, accountTypeSnapshot: "TRADER" },
      });
    }

    const serviceA = buildService(prismaA);
    const serviceB = buildService(prismaB);

    const results = await Promise.allSettled([
      serviceA.create(
        { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
        "race-qty-a",
        ctxFor(fixture)
      ),
      serviceB.create(
        { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: otherLocation.id, quantity: 4 }] },
        "race-qty-b",
        { userId: otherUser.id, companyId: otherTrader.id, requestId: "req-2" }
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const sessions = await rawPrisma.checkoutSession.findMany({ where: { opportunityId: fixture.opportunityId, lockReleasedAt: null } });
    expect(sessions).toHaveLength(1);
  }, 30_000);

  it("the SAME trader attempting two concurrent locks on the SAME opportunity: the partial unique index allows only one active lock", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "DBLLOCK" });
    const serviceA = buildService(prismaA);
    const serviceB = buildService(prismaB);

    const results = await Promise.allSettled([
      serviceA.create(
        { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
        "dbl-lock-a",
        ctxFor(fixture)
      ),
      serviceB.create(
        { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
        "dbl-lock-b",
        ctxFor(fixture, "req-2")
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const activeLocks = await rawPrisma.checkoutSession.findMany({
      where: { opportunityId: fixture.opportunityId, traderCompanyId: fixture.traderCompanyId, lockReleasedAt: null },
    });
    expect(activeLocks).toHaveLength(1);
  }, 30_000);

  it("all THREE shipping tiers price correctly and independently per branch in a single checkout", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "TIERS" });
    const service = buildService(prismaA);

    const tariff = await rawPrisma.shippingTariffPolicyVersion.findUniqueOrThrow({ where: { id: fixture.tariffId } });

    const session = await service.create(
      {
        opportunityId: fixture.opportunityId,
        quantity: 12,
        allocations: [
          { companyLocationId: fixture.traderLocations.sameCity, quantity: 4 },
          { companyLocationId: fixture.traderLocations.sameRegionDifferentCity, quantity: 4 },
          { companyLocationId: fixture.traderLocations.differentRegion, quantity: 4 },
        ],
      },
      "tiers-key",
      ctxFor(fixture)
    );

    const allocations = await rawPrisma.checkoutLocationAllocation.findMany({ where: { checkoutSessionId: session.id } });
    const byTier = new Map(allocations.map((a) => [a.shippingTierCode, Number(a.shippingFeeAmount)]));
    expect(byTier.get("SAME_CITY")).toBe(Number(tariff.sameCityFeeAmount));
    expect(byTier.get("SAME_REGION_DIFFERENT_CITY")).toBe(Number(tariff.sameRegionDifferentCityFeeAmount));
    expect(byTier.get("DIFFERENT_REGION")).toBe(Number(tariff.differentRegionFeeAmount));

    // The response carries a decimal STRING, so the expectation is
    // built in Decimal too — comparing against a float sum would be
    // asserting the very drift the contract exists to prevent.
    const expectedTotal = tariff.sameCityFeeAmount
      .add(tariff.sameRegionDifferentCityFeeAmount)
      .add(tariff.differentRegionFeeAmount);
    expect(session.totalShippingFeeAmount).toBe(expectedTotal.toFixed(2));
  }, 30_000);

  it("Cooldown blocks a new lock after 3 qualifying EXPIRED/TRADER_ABANDONED releases within the window", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "COOLDOWN" });
    const service = buildService(prismaA);

    await rawPrisma.systemSetting.upsert({
      where: { key: "checkout_settings" },
      create: {
        key: "checkout_settings",
        value: { lockDurationMinutes: 15, abuseThresholdCount: 3, abuseWindowMinutes: 60, cooldownMinutes: 10 },
      },
      update: {
        value: { lockDurationMinutes: 15, abuseThresholdCount: 3, abuseWindowMinutes: 60, cooldownMinutes: 10 },
      },
    });

    for (let i = 0; i < 3; i++) {
      await rawPrisma.checkoutSession.create({
        data: {
          opportunityId: fixture.opportunityId,
          traderCompanyId: fixture.traderCompanyId,
          status: "ABANDONED",
          lockedQuantity: 1,
          lockCreatedAt: new Date(Date.now() - 5000),
          lockExpiresAt: new Date(Date.now() - 4000),
          lockReleasedAt: new Date(Date.now() - 1000 * (3 - i)),
          releaseReason: "TRADER_ABANDONED",
          traderCompanySnapshot: {},
        },
      });
    }

    await expect(
      service.create(
        { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
        "cooldown-key",
        ctxFor(fixture)
      )
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "RATE_LIMITED" }) });

    await rawPrisma.systemSetting.delete({ where: { key: "checkout_settings" } }).catch(() => undefined);
  }, 30_000);

  it("Cooldown does NOT count OPPORTUNITY_CANCELLED or ADMIN_ABANDONED releases", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "COOLDOWN2" });
    const service = buildService(prismaA);

    for (let i = 0; i < 3; i++) {
      await rawPrisma.checkoutSession.create({
        data: {
          opportunityId: fixture.opportunityId,
          traderCompanyId: fixture.traderCompanyId,
          status: "ABANDONED",
          lockedQuantity: 1,
          lockCreatedAt: new Date(Date.now() - 5000),
          lockExpiresAt: new Date(Date.now() - 4000),
          lockReleasedAt: new Date(Date.now() - 1000 * (3 - i)),
          releaseReason: i === 2 ? "ADMIN_ABANDONED" : "OPPORTUNITY_CANCELLED",
          traderCompanySnapshot: {},
        },
      });
    }

    const session = await service.create(
      { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
      "cooldown2-key",
      ctxFor(fixture)
    );
    expect((session as { id: string }).id).toBeDefined();
  }, 30_000);
});
