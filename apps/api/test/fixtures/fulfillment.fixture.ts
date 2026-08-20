import type { PrismaService } from "../../src/database/prisma.service";
import { PaymentWebhookService } from "../../src/payments/payment-webhook.service";
import { CommissionTaxPolicyService } from "../../src/settings/commission-tax-policy.service";
import { AuditService } from "../../src/audit/audit.service";
import { MockPaymentProvider } from "../../src/payments/providers/mock-payment.provider";
import { CheckoutSessionService } from "../../src/checkout/checkout-session.service";
import { ShippingTariffPolicyService } from "../../src/settings/shipping-tariff-policy.service";
import { CheckoutSettingsService } from "../../src/settings/checkout-settings.service";
import { PaymentAttemptService } from "../../src/payments/payment-attempt.service";
import { PaymentSettingsService } from "../../src/settings/payment-settings.service";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./checkout.fixture";
import { ensureCommissionTaxPolicy } from "./payment.fixture";

const prisma = checkoutFixturePrisma;
const provider = new MockPaymentProvider();

export interface FulfillmentFixture {
  opportunityId: string;
  supplierCompanyId: string;
  traderCompanyId: string;
  traderUserId: string;
  masterOrderId: string;
  orderAllocationIds: string[];
}

async function seedSupplierBilling(supplierCompanyId: string): Promise<void> {
  await prisma.supplierTaxProfile.upsert({
    where: { companyId: supplierCompanyId },
    create: { companyId: supplierCompanyId, isVatRegistered: false },
    update: {},
  });
  await prisma.supplierInvoicingProfile.upsert({
    where: { companyId: supplierCompanyId },
    create: { companyId: supplierCompanyId, invoicingLegalName: "Fulfillment E2E Supplier" },
    update: {},
  });
  const existingBank = await prisma.supplierBankAccount.findFirst({ where: { companyId: supplierCompanyId } });
  const bank =
    existingBank ??
    (await prisma.supplierBankAccount.create({
      data: {
        companyId: supplierCompanyId,
        accountHolderName: "h",
        bankName: "b",
        ibanCiphertext: "c",
        ibanFingerprint: `fp-${supplierCompanyId}-${Date.now()}`,
        ibanLast4: "1234",
        verificationStatus: "VERIFIED",
      },
    }));
  await prisma.company.update({ where: { id: supplierCompanyId }, data: { activeBankAccountId: bank.id } });
}

export async function seedFulfillmentFixture(prefix: string): Promise<FulfillmentFixture> {
  await ensureCommissionTaxPolicy();
  const fixture = await seedCheckoutFixture({ traderCrPrefix: prefix });
  await seedSupplierBilling(fixture.supplierCompanyId);

  const audit = new AuditService(prisma as unknown as PrismaService);
  const checkoutService = new CheckoutSessionService(
    prisma as unknown as PrismaService,
    new ShippingTariffPolicyService(prisma as unknown as PrismaService, audit),
    new CheckoutSettingsService(prisma as unknown as PrismaService, audit)
  );

  const session = (await checkoutService.create(
    {
      opportunityId: fixture.opportunityId,
      quantity: 4,
      allocations: [
        { companyLocationId: fixture.traderLocations.sameCity, quantity: 2 },
        { companyLocationId: fixture.traderLocations.sameRegionDifferentCity, quantity: 2 },
      ],
    },
    `fulfx-checkout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-fulfx" }
  )) as { id: string; grandTotalAmount: number };

  const paymentAttemptService = new PaymentAttemptService(
    prisma as unknown as PrismaService,
    new PaymentSettingsService(prisma as unknown as PrismaService, audit),
    new CommissionTaxPolicyService(prisma as unknown as PrismaService, audit),
    provider
  );
  const attemptView = (await paymentAttemptService.startPayment(
    session.id,
    `fulfx-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-fulfx-2" }
  )) as { id: string; amount: number };

  const webhookService = new PaymentWebhookService(
    prisma as unknown as PrismaService,
    new CommissionTaxPolicyService(prisma as unknown as PrismaService, audit),
    provider
  );
  const { rawBody, headers } = provider.buildSignedWebhook({
    merchantReference: attemptView.id,
    providerReference: `ref-${attemptView.id}`,
    providerEventId: `evt-${attemptView.id}`,
    eventType: "SUCCESS",
    providerCapturedAt: new Date(),
    providerCapturedAmount: attemptView.amount,
  });
  const result = await webhookService.handleWebhook(rawBody, headers);
  const masterOrderId = result.masterOrderId!;

  const allocations = await prisma.orderAllocation.findMany({ where: { masterOrderId }, orderBy: { createdAt: "asc" } });

  return {
    opportunityId: fixture.opportunityId,
    supplierCompanyId: fixture.supplierCompanyId,
    traderCompanyId: fixture.traderCompanyId,
    traderUserId: fixture.traderUserId,
    masterOrderId,
    orderAllocationIds: allocations.map((a) => a.id),
  };
}

export { prisma as fulfillmentFixturePrisma };
