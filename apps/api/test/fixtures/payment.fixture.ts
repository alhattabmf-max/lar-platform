import type { PrismaService } from "../../src/database/prisma.service";
import { CheckoutSessionService } from "../../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../../src/settings/checkout-settings.service";
import { PaymentAttemptService } from "../../src/payments/payment-attempt.service";
import { PaymentSettingsService } from "../../src/settings/payment-settings.service";
import { CommissionTaxPolicyService } from "../../src/settings/commission-tax-policy.service";
import { AuditService } from "../../src/audit/audit.service";
import { MockPaymentProvider } from "../../src/payments/providers/mock-payment.provider";
import { seedCheckoutFixture, checkoutFixturePrisma, type CheckoutFixture } from "./checkout.fixture";

const prisma = checkoutFixturePrisma;

export interface PaymentFixture extends CheckoutFixture {
  checkoutSessionId: string;
  paymentAttemptId: string;
  merchantReference: string;
  grandTotalAmount: number;
}

export async function ensureCommissionTaxPolicy(ratePercent = 5): Promise<void> {
  const existing = await prisma.commissionTaxPolicyVersion.findFirst({ orderBy: { version: "desc" } });
  if (existing) return;
  await prisma.commissionTaxPolicyVersion.create({
    data: { ratePercent, ruleCode: "TEST_COMMISSION_TAX", ruleVersion: "v1" },
  });
}

export async function seedSupplierBilling(supplierCompanyId: string): Promise<void> {
  await prisma.supplierTaxProfile.upsert({
    where: { companyId: supplierCompanyId },
    create: { companyId: supplierCompanyId, isVatRegistered: false },
    update: {},
  });
  await prisma.supplierInvoicingProfile.upsert({
    where: { companyId: supplierCompanyId },
    create: { companyId: supplierCompanyId, invoicingLegalName: "Test Supplier LLC" },
    update: {},
  });
  const existingBank = await prisma.supplierBankAccount.findFirst({ where: { companyId: supplierCompanyId } });
  const bank =
    existingBank ??
    (await prisma.supplierBankAccount.create({
      data: {
        companyId: supplierCompanyId,
        accountHolderName: "Test Holder",
        bankName: "Test Bank",
        ibanCiphertext: "ct",
        ibanFingerprint: `fp-${supplierCompanyId}`,
        ibanLast4: "1234",
        verificationStatus: "VERIFIED",
      },
    }));
  await prisma.company.update({ where: { id: supplierCompanyId }, data: { activeBankAccountId: bank.id } });
}

function buildCheckoutService(p: PrismaService) {
  const audit = new AuditService(p);
  return new CheckoutSessionService(p, new ShippingTariffPolicyService(p, audit), new CheckoutSettingsService(p, audit));
}

export function buildPaymentAttemptService(p: PrismaService, provider: MockPaymentProvider) {
  const audit = new AuditService(p);
  return new PaymentAttemptService(p, new PaymentSettingsService(p, audit), new CommissionTaxPolicyService(p, audit), provider);
}

export async function seedPaymentFixture(overrides?: {
  traderCrPrefix?: string;
  traderTaxProfile?: { isVatRegistered: boolean; vatNumber?: string | null; billingLegalName?: string };
}): Promise<PaymentFixture> {
  await ensureCommissionTaxPolicy();
  const fixture = await seedCheckoutFixture(overrides);
  await seedSupplierBilling(fixture.supplierCompanyId);

  const checkoutService = buildCheckoutService(prisma as unknown as PrismaService);
  const session = (await checkoutService.create(
    { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
    `payfx-checkout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-fixture" }
  )) as { id: string; grandTotalAmount: number };

  const provider = new MockPaymentProvider();
  const paymentAttemptService = buildPaymentAttemptService(prisma as unknown as PrismaService, provider);
  const attemptView = (await paymentAttemptService.startPayment(
    session.id,
    `payfx-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-fixture-2" }
  )) as { id: string; status: string; amount: number; currency: string };

  return {
    ...fixture,
    checkoutSessionId: session.id,
    paymentAttemptId: attemptView.id,
    merchantReference: attemptView.id,
    grandTotalAmount: attemptView.amount,
  };
}

export { prisma as paymentFixturePrisma };
