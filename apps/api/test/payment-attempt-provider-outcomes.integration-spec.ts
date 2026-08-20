import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { ensureCommissionTaxPolicy, buildPaymentAttemptService } from "./fixtures/payment.fixture";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { CheckoutSessionService } from "../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../src/settings/checkout-settings.service";
import { AuditService } from "../src/audit/audit.service";

const prisma = checkoutFixturePrisma;

async function seedSupplierBilling(supplierCompanyId: string): Promise<void> {
  await prisma.supplierTaxProfile.upsert({
    where: { companyId: supplierCompanyId },
    create: { companyId: supplierCompanyId, isVatRegistered: false },
    update: {},
  });
  await prisma.supplierInvoicingProfile.upsert({
    where: { companyId: supplierCompanyId },
    create: { companyId: supplierCompanyId, invoicingLegalName: "x" },
    update: {},
  });
  const bank = await prisma.supplierBankAccount.create({
    data: {
      companyId: supplierCompanyId,
      accountHolderName: "h",
      bankName: "b",
      ibanCiphertext: "c",
      ibanFingerprint: `fp-${supplierCompanyId}-${Date.now()}`,
      ibanLast4: "1234",
      verificationStatus: "VERIFIED",
    },
  });
  await prisma.company.update({ where: { id: supplierCompanyId }, data: { activeBankAccountId: bank.id } });
}

function buildCheckoutService() {
  const audit = new AuditService(prisma as unknown as PrismaService);
  return new CheckoutSessionService(
    prisma as unknown as PrismaService,
    new ShippingTariffPolicyService(prisma as unknown as PrismaService, audit),
    new CheckoutSettingsService(prisma as unknown as PrismaService, audit)
  );
}

describe("PaymentAttemptService — createPaymentIntent outcome handling (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("RETRYABLE_UNKNOWN leaves the attempt CREATED and checkout PAYMENT_PENDING — no FAILED, no new attempt on retry", async () => {
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "RETRYUNK" });
    await seedSupplierBilling(fixture.supplierCompanyId);

    const checkoutService = buildCheckoutService();
    const session = (await checkoutService.create(
      { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
      `retryunk-checkout-${Date.now()}`,
      { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-1" }
    )) as { id: string };

    const provider = new MockPaymentProvider();
    provider.setNextCreateIntentResult({ outcome: "RETRYABLE_UNKNOWN", reason: "network timeout" });
    const attemptService = buildPaymentAttemptService(prisma as unknown as PrismaService, provider);

    const result = (await attemptService.startPayment(session.id, `retryunk-key-${Date.now()}`, {
      userId: fixture.traderUserId,
      companyId: fixture.traderCompanyId,
      requestId: "req-2",
    })) as { id: string; status: string };

    expect(result.status).toBe("CREATED");

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: result.id } });
    expect(attempt.status).toBe("CREATED");
    expect(attempt.providerReference).toBeNull();

    const checkoutSession = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(checkoutSession.status).toBe("PAYMENT_PENDING");

    const attemptsCount = await prisma.paymentAttempt.count({ where: { checkoutSessionId: session.id } });
    expect(attemptsCount).toBe(1);
  }, 30_000);

  it("DEFINITIVE_FAILURE marks the attempt FAILED and restores Checkout to LOCKED (lock still valid) — retry then succeeds", async () => {
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "DEFFAIL" });
    await seedSupplierBilling(fixture.supplierCompanyId);

    const checkoutService = buildCheckoutService();
    const session = (await checkoutService.create(
      { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
      `deffail-checkout-${Date.now()}`,
      { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-1" }
    )) as { id: string };

    const provider = new MockPaymentProvider();
    provider.setNextCreateIntentResult({ outcome: "DEFINITIVE_FAILURE", reason: "card declined" });
    const attemptService = buildPaymentAttemptService(prisma as unknown as PrismaService, provider);

    const result = (await attemptService.startPayment(session.id, `deffail-key-${Date.now()}`, {
      userId: fixture.traderUserId,
      companyId: fixture.traderCompanyId,
      requestId: "req-2",
    })) as { id: string; status: string };

    expect(result.status).toBe("FAILED");

    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: result.id } });
    expect(attempt.status).toBe("FAILED");

    const checkoutSession = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(checkoutSession.status).toBe("LOCKED");
    expect(checkoutSession.paymentDeadlineAt).toBeNull();

    const provider2 = new MockPaymentProvider();
    const attemptService2 = buildPaymentAttemptService(prisma as unknown as PrismaService, provider2);
    const retry = (await attemptService2.startPayment(session.id, `deffail-retry-${Date.now()}`, {
      userId: fixture.traderUserId,
      companyId: fixture.traderCompanyId,
      requestId: "req-3",
    })) as { id: string; status: string };
    expect(retry.status).toBe("PENDING");
  }, 30_000);
});
