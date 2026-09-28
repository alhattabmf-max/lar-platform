import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { TraderTaxProfileService } from "../src/financial/trader-tax-profile.service";
import { AuditService } from "../src/audit/audit.service";
import { CheckoutSessionService } from "../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../src/settings/checkout-settings.service";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { buildPaymentAttemptService } from "./fixtures/payment.fixture";
import { uniqueVatNumber } from "./fixtures/unique";

// ONE NUMBER PER RUN, shared by every write and every assertion in
// this file. `*_tax_profiles.vat_number` is UNIQUE, so a literal
// here collided with the same literal in a sibling spec — and with
// the rows every previous run left behind.
const TRADER_VAT = uniqueVatNumber();

/**
 * ASCII digits to Arabic-Indic ones (٠-٩).
 *
 * The normalisation test needs the SAME number in both scripts:
 * what it writes and what it expects back must be one value, or
 * the test proves nothing about normalisation.
 */
function toArabicIndic(digits: string): string {
  return digits.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}



const prisma = checkoutFixturePrisma;

function buildService(p: PrismaService = prisma as unknown as PrismaService) {
  return new TraderTaxProfileService(p, new AuditService(p));
}

describe("TraderTaxProfileService (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("isVatRegistered=true without a vatNumber is rejected", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "TAXNOVAT" });
    const service = buildService();
    await expect(
      service.upsert({ isVatRegistered: true, billingLegalName: "Valid Name LLC" }, { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r1" })
    ).rejects.toThrow();
  }, 15_000);

  it("an invalid VAT number (wrong length/non-digit) is rejected at the application level", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "TAXBADVAT" });
    const service = buildService();
    await expect(
      service.upsert(
        { isVatRegistered: true, vatNumber: "12345", billingLegalName: "Valid Name LLC" },
        { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r1" }
      )
    ).rejects.toThrow();
  }, 15_000);

  it("an invalid VAT number is ALSO rejected directly at the DB level (bypassing the application check)", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "TAXBADVATDB" });
    await prisma.traderTaxProfile.deleteMany({ where: { companyId: fixture.traderCompanyId } });
    await expect(
      prisma.traderTaxProfile.create({
        data: { companyId: fixture.traderCompanyId, isVatRegistered: true, vatNumber: "NOTANUMBER1234", billingLegalName: "Valid Name LLC" },
      })
    ).rejects.toThrow();
  }, 15_000);

  it("Arabic-Indic and Extended Arabic-Indic digits are normalized and stored in a uniform ASCII format", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "TAXARABICDIGITS" });
    const service = buildService();
    // THE SAME NUMBER, WRITTEN IN ARABIC-INDIC DIGITS — derived from
    // `TRADER_VAT` rather than typed out, so the value written here and
    // the value asserted below can never drift apart. It was a literal
    // whose ASCII form was the old shared constant; once that constant
    // became per-run, the literal was writing one number while the
    // assertion expected another.
    //
    // The space is kept: separators are part of what normalisation has
    // to strip, and removing it would quietly narrow the test.
    const arabicVat = `${toArabicIndic(TRADER_VAT.slice(0, 3))} ${toArabicIndic(TRADER_VAT.slice(3))}`;
    const profile = await service.upsert(
      { isVatRegistered: true, vatNumber: arabicVat, billingLegalName: "Arabic Digit Test LLC" },
      { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r1" }
    );
    expect(profile.vatNumber).toBe(TRADER_VAT);
  }, 15_000);

  it("isVatRegistered=false WITH a vatNumber is rejected", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "TAXFALSEVAT" });
    const service = buildService();
    await expect(
      service.upsert(
        { isVatRegistered: false, vatNumber: TRADER_VAT, billingLegalName: "Valid Name LLC" },
        { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r1" }
      )
    ).rejects.toThrow();
  }, 15_000);

  it("an empty billingLegalName is rejected", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "TAXEMPTYNAME" });
    const service = buildService();
    await expect(
      service.upsert({ isVatRegistered: false, billingLegalName: "   " }, { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r1" })
    ).rejects.toThrow();
  }, 15_000);

  it("a billingLegalName longer than the safe limit is rejected", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "TAXLONGNAME" });
    const service = buildService();
    await expect(
      service.upsert(
        { isVatRegistered: false, billingLegalName: "A".repeat(301) },
        { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r1" }
      )
    ).rejects.toThrow();
  }, 15_000);

  it("company isolation: updating one company's profile never affects another's", async () => {
    const fixtureA = await seedCheckoutFixture({ traderCrPrefix: "TAXISOA" });
    const fixtureB = await seedCheckoutFixture({ traderCrPrefix: "TAXISOB" });
    const service = buildService();

    await service.upsert(
      { isVatRegistered: false, billingLegalName: "Company A Legal Name" },
      { userId: crypto.randomUUID(), companyId: fixtureA.traderCompanyId, requestId: "r1" }
    );
    const profileB = await service.get(fixtureB.traderCompanyId);
    expect(profileB?.companyId).toBe(fixtureB.traderCompanyId);
    expect(profileB?.companyId).not.toBe(fixtureA.traderCompanyId);
  }, 15_000);

  it("Audit and Outbox never contain vatNumber or the raw billingLegalName", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "TAXAUDITSAFE" });
    const service = buildService();
    const secretVat = uniqueVatNumber();
    const secretName = "Extremely Secret Legal Name Co";

    await service.upsert(
      { isVatRegistered: true, vatNumber: secretVat, billingLegalName: secretName },
      { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-auditsafe" }
    );

    const audits = await prisma.auditLog.findMany({ where: { entityType: "trader_tax_profile", companyId: fixture.traderCompanyId } });
    expect(audits.length).toBeGreaterThan(0);
    for (const entry of audits) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(secretVat);
      expect(serialized).not.toContain(secretName);
    }

    const outboxEvents = await prisma.outboxEvent.findMany({ where: { eventType: "TRADER_TAX_PROFILE_UPDATED" } });
    for (const evt of outboxEvents) {
      const serialized = JSON.stringify(evt);
      expect(serialized).not.toContain(secretVat);
      expect(serialized).not.toContain(secretName);
    }
  }, 15_000);

  it("starting payment with NO trader tax profile is rejected BEFORE any PaymentAttempt is created or the provider is called", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "TAXNOPROFILESTART" });
    await prisma.traderTaxProfile.deleteMany({ where: { companyId: fixture.traderCompanyId } });

    const audit = new AuditService(prisma as unknown as PrismaService);
    const checkout = new CheckoutSessionService(
      prisma as unknown as PrismaService,
      new ShippingTariffPolicyService(prisma as unknown as PrismaService, audit),
      new CheckoutSettingsService(prisma as unknown as PrismaService, audit)
    );
    const session = (await checkout.create(
      { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
      `taxnoprofile-checkout-${Date.now()}`,
      { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r1" }
    )) as { id: string };

    const provider = new MockPaymentProvider();
    const attemptService = buildPaymentAttemptService(prisma as unknown as PrismaService, provider);
    let providerCalled = false;
    const originalCreateIntent = provider.createPaymentIntent.bind(provider);
    provider.createPaymentIntent = async (input) => {
      providerCalled = true;
      return originalCreateIntent(input);
    };

    await expect(
      attemptService.startPayment(session.id, `taxnoprofile-attempt-${Date.now()}`, { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "r2" })
    ).rejects.toThrow();

    expect(providerCalled).toBe(false);
    const attemptCount = await prisma.paymentAttempt.count({ where: { checkoutSessionId: session.id } });
    expect(attemptCount).toBe(0);
  }, 15_000);
});
