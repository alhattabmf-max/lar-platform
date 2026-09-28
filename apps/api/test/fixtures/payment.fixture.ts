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
  /**
   * The grand total as the API serialises it: a fixed-scale decimal
   * string. This is what a client receives and what assertions about
   * the CONTRACT compare against.
   */
  grandTotalAmount: string;
  /**
   * The same amount in the PROVIDER's wire shape, which is numeric.
   *
   * Kept as a separate, differently named field rather than one field
   * that changes type by context. A webhook payload really does carry
   * a JSON number — that is the provider's format, not ours — and
   * naming it makes each test say which side of the boundary it is
   * asserting about.
   */
  providerAmount: number;
}

/**
 * THE RATE A PUBLICATION FREEZES ONTO THE LISTING.
 *
 * `getDefaultRate()` returns NULL when nothing has been configured —
 * deliberately, so a listing can never be published against an invented
 * rate — and `publish()` answers `TAX_RATE_NOT_CONFIGURED`.
 *
 * IT USED TO BE THERE BY ACCIDENT. The suites ran against the
 * development database, where the owner had set 15% months ago, so no
 * fixture ever had to ask for it. Pointing the suites at their own
 * database made that dependency visible the first time a test tried to
 * publish — which is the point of the separation.
 *
 * `version` IS PART OF THE STORED SHAPE, and the reader refuses a value
 * without one.
 */
export async function ensureDefaultTaxRate(ratePercent = 15): Promise<void> {
  const existing = await prisma.systemSetting.findUnique({ where: { key: "default_tax_rate" } });
  if (existing) return;
  await prisma.systemSetting.create({
    data: { key: "default_tax_rate", value: { version: 1, ratePercent } },
  });
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
  const session = await checkoutService.create(
    { opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] },
    `payfx-checkout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-fixture" }
  );

  const provider = new MockPaymentProvider();
  const paymentAttemptService = buildPaymentAttemptService(prisma as unknown as PrismaService, provider);
  const attemptView = await paymentAttemptService.startPayment(
    session.id,
    `payfx-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-fixture-2" }
  );

  return {
    ...fixture,
    checkoutSessionId: session.id,
    paymentAttemptId: attemptView.id,
    merchantReference: attemptView.id,
    grandTotalAmount: attemptView.amount,
    providerAmount: Number(attemptView.amount),
  };
}

export { prisma as paymentFixturePrisma };
