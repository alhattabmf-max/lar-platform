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
import { notificationEvents } from "./notifications.fixture";

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

/**
 * Everything a supplier must have before a payment can be taken on his
 * behalf: a tax profile, an invoicing name and a verified bank account.
 *
 * EXPORTED because the direct-sale suite needs the same three and
 * nothing else from this file. Written twice they would drift, and the
 * failure would read «Supplier billing profile is incomplete» in one
 * suite and not the other.
 */
export async function seedSupplierBilling(supplierCompanyId: string): Promise<void> {
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

  // THE PURCHASE FILLS THE OFFER, so the funding closes on its own.
  //
  // «لا يتم شحن البضاعة إلا بعد ما يتم العرض شروطه ووصوله لهدفه» — since
  // `20260902080000_fulfilment_waits_for_funding` an allocation is born
  // AWAITING_FUNDING and owes no work until the offer reaches its
  // target. This fixture bought 4 of a target of 100, so nothing it
  // seeded could ever start preparing: every downstream spec — disputes,
  // replacements, refunds, settlements, invoices — failed at its first
  // `startPreparation` with «This allocation is not awaiting
  // preparation».
  //
  // IT BUYS THE WHOLE OFFER INSTEAD OF BEING HANDED A RELEASE. Nothing
  // here writes a status, and nothing calls `releaseFundedAllocationsTx`
  // from outside its own path: the payment webhook sees the target
  // reached, moves the offer to FUNDED and releases every share itself,
  // exactly as it does in production. A fixture that set the status by
  // hand would be testing the steps AFTER funding against a state the
  // platform never produces.
  //
  // THE QUANTITY IS READ FROM THE OFFER, not written as a literal, so
  // this keeps filling it if the seeded target ever changes.
  const offer = await prisma.opportunity.findUniqueOrThrow({
    where: { id: fixture.opportunityId },
    select: { targetQuantity: true },
  });
  const wholeOffer = offer.targetQuantity;
  // TWO BRANCHES, AS BEFORE — the downstream specs use the second
  // allocation for their isolation cases, so the shape is kept. The
  // split carries the remainder on the first, so the two always sum to
  // the quantity the deferred allocation check compares against.
  const firstBranch = wholeOffer - Math.floor(wholeOffer / 2);
  const secondBranch = wholeOffer - firstBranch;

  const session = await checkoutService.create(
    {
      opportunityId: fixture.opportunityId,
      quantity: wholeOffer,
      allocations: [
        { companyLocationId: fixture.traderLocations.sameCity, quantity: firstBranch },
        { companyLocationId: fixture.traderLocations.sameRegionDifferentCity, quantity: secondBranch },
      ],
    },
    `fulfx-checkout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-fulfx" }
  );

  const paymentAttemptService = new PaymentAttemptService(
    prisma as unknown as PrismaService,
    new PaymentSettingsService(prisma as unknown as PrismaService, audit),
    new CommissionTaxPolicyService(prisma as unknown as PrismaService, audit),
    provider
  );
  const attemptView = await paymentAttemptService.startPayment(
    session.id,
    `fulfx-attempt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    { userId: fixture.traderUserId, companyId: fixture.traderCompanyId, requestId: "req-fulfx-2" }
  );

  const webhookService = new PaymentWebhookService(
    prisma as unknown as PrismaService,
    new CommissionTaxPolicyService(prisma as unknown as PrismaService, audit),
    provider
  , notificationEvents());
  const { rawBody, headers } = provider.buildSignedWebhook({
    merchantReference: attemptView.id,
    providerReference: `ref-${attemptView.id}`,
    providerEventId: `evt-${attemptView.id}`,
    eventType: "SUCCESS",
    providerCapturedAt: new Date(),
    // The provider wire format carries a JSON number; the contract
    // carries the decimal string. Converted here, at the boundary.
    providerCapturedAmount: Number(attemptView.amount),
  });
  const result = await webhookService.handleWebhook(rawBody, headers);
  const masterOrderId = result.masterOrderId!;

  const allocations = await prisma.orderAllocation.findMany({ where: { masterOrderId }, orderBy: { createdAt: "asc" } });

  // THE FIXTURE PROVES ITS OWN POSTCONDITION.
  //
  // Everything downstream of here assumes the offer closed and the work
  // was released. When that silently stopped being true, twenty-odd
  // suites failed one step later with a message about preparation —
  // which named the symptom and not the cause, and cost a long hunt.
  //
  // It is checked, not arranged: if these reads disagree, the real path
  // did not do what production does and the fixture says so here rather
  // than letting a spec fail somewhere else for the wrong reason.
  const fundedOffer = await prisma.opportunity.findUniqueOrThrow({
    where: { id: fixture.opportunityId },
    select: { status: true, fundedQuantity: true, targetQuantity: true },
  });
  if (fundedOffer.status !== "FUNDED" || fundedOffer.fundedQuantity !== fundedOffer.targetQuantity) {
    throw new Error(
      `seedFulfillmentFixture: the offer did not close — status=${fundedOffer.status}, ` +
        `funded=${fundedOffer.fundedQuantity}/${fundedOffer.targetQuantity}`
    );
  }
  const waiting = allocations.filter((a) => a.status === "AWAITING_FUNDING");
  if (waiting.length > 0) {
    throw new Error(
      `seedFulfillmentFixture: ${waiting.length} allocation(s) still AWAITING_FUNDING after the offer closed`
    );
  }

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
