import { PrismaClient } from "@prisma/client";
import type { PrismaService } from "../src/database/prisma.service";
import { TraderTaxProfileService } from "../src/financial/trader-tax-profile.service";
import { MasterOrderBuyerBillingOverrideService } from "../src/financial/master-order-buyer-billing-override.service";
import { AuditService } from "../src/audit/audit.service";
import { PaymentWebhookService } from "../src/payments/payment-webhook.service";
import { CommissionTaxPolicyService } from "../src/settings/commission-tax-policy.service";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { seedPaymentFixture, paymentFixturePrisma, ensureCommissionTaxPolicy } from "./fixtures/payment.fixture";
import { seedCheckoutFixture } from "./fixtures/checkout.fixture";
import { notificationEvents } from "./fixtures/notifications.fixture";
import { uniqueVatNumber } from "./fixtures/unique";

// ONE NUMBER PER TEST, not per file.
//
// `trader_tax_profiles.vat_number` is unique across the WHOLE table,
// not per company — and this file seeds a different trader in each of
// three tests. A file-level constant fixed the collision BETWEEN files
// and left one inside this one, so the value is drawn where it is used
// and read back by that test's own assertions.


const prisma = paymentFixturePrisma;

function buildTaxProfileService(p: PrismaService = prisma as unknown as PrismaService) {
  return new TraderTaxProfileService(p, new AuditService(p));
}
function buildOverrideService(p: PrismaService = prisma as unknown as PrismaService) {
  return new MasterOrderBuyerBillingOverrideService(p, new AuditService(p));
}
function buildWebhookService(p: PrismaService, provider: MockPaymentProvider) {
  const audit = new AuditService(p);
  return new PaymentWebhookService(p, new CommissionTaxPolicyService(p, audit), provider, notificationEvents());
}

async function captureViaWebhook(provider: MockPaymentProvider, p: PrismaService, merchantReference: string, providerReference: string, amount: number) {
  const webhookService = buildWebhookService(p, provider);
  const { rawBody, headers } = provider.buildSignedWebhook({
    merchantReference,
    providerReference,
    providerEventId: `evt-${merchantReference}-${Date.now()}`,
    eventType: "SUCCESS",
    providerCapturedAt: new Date(),
    providerCapturedAmount: amount,
  });
  return webhookService.handleWebhook(rawBody, headers);
}

describe("Trader billing snapshot freeze at Capture (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("the trader tax profile becoming incomplete BETWEEN Start and Capture results in REFUND_REQUIRED (TRADER_TAX_PROFILE_INCOMPLETE), no Order, no fundedQuantity increase", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "SNAPINCOMPLETE" });
    const provider = new MockPaymentProvider();

    await prisma.traderTaxProfile.deleteMany({ where: { companyId: fixture.traderCompanyId } });

    const opportunityBefore = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });

    const result = await captureViaWebhook(provider, prisma as unknown as PrismaService, fixture.paymentAttemptId, `prov-ref-${fixture.paymentAttemptId}`, fixture.providerAmount);
    expect(result.processingOutcome).toBe("REFUND_REQUIRED");

    const refund = await prisma.refundObligation.findFirstOrThrow({ where: { paymentAttemptId: fixture.paymentAttemptId } });
    expect(refund.reasonCode).toBe("TRADER_TAX_PROFILE_INCOMPLETE");

    const orderCount = await prisma.masterOrder.count({ where: { paymentAttemptId: fixture.paymentAttemptId } });
    expect(orderCount).toBe(0);

    const opportunityAfter = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opportunityAfter.fundedQuantity).toBe(opportunityBefore.fundedQuantity);
  }, 20_000);

  it("a successful capture freezes traderTaxProfileSnapshot/traderBillingLegalNameSnapshot on MasterOrder, and a LATER profile edit never changes them", async () => {
    const vat = uniqueVatNumber();
    const fixture = await seedPaymentFixture({
      traderCrPrefix: "SNAPFREEZE",
      traderTaxProfile: { isVatRegistered: true, vatNumber: vat, billingLegalName: "Original Legal Name LLC" },
    });
    const provider = new MockPaymentProvider();

    const result = await captureViaWebhook(provider, prisma as unknown as PrismaService, fixture.paymentAttemptId, `prov-ref-${fixture.paymentAttemptId}`, fixture.providerAmount);
    expect(result.processingOutcome).toBe("ORDER_CREATED");

    const order = await prisma.masterOrder.findFirstOrThrow({ where: { paymentAttemptId: fixture.paymentAttemptId } });
    expect(order.traderBillingLegalNameSnapshot).toBe("Original Legal Name LLC");
    expect((order.traderTaxProfileSnapshot as { vatNumber: string | null }).vatNumber).toBe(vat);

    const taxProfileService = buildTaxProfileService();
    await taxProfileService.upsert(
      { isVatRegistered: false, billingLegalName: "Changed Legal Name Later LLC" },
      { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-edit-after" }
    );

    const orderAfter = await prisma.masterOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderAfter.traderBillingLegalNameSnapshot).toBe("Original Legal Name LLC");
    expect((orderAfter.traderTaxProfileSnapshot as { vatNumber: string | null }).vatNumber).toBe(vat);
  }, 20_000);

  it("a REAL race between updating the trader tax profile and Capture produces a fully coherent snapshot from ONE version, never a mix", async () => {
    const raceVat = uniqueVatNumber();
    const fixture = await seedPaymentFixture({
      traderCrPrefix: "SNAPRACE",
      traderTaxProfile: { isVatRegistered: false, billingLegalName: "Race Original Name LLC" },
    });
    const provider = new MockPaymentProvider();

    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();
    const taxProfileService = buildTaxProfileService(prismaA as unknown as PrismaService);

    const results = await Promise.allSettled([
      taxProfileService.upsert(
        { isVatRegistered: true, vatNumber: raceVat, billingLegalName: "Race Updated Name LLC" },
        { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-race-update" }
      ),
      captureViaWebhook(provider, prismaB as unknown as PrismaService, fixture.paymentAttemptId, `prov-ref-race-${fixture.paymentAttemptId}`, fixture.providerAmount),
    ]);

    await prismaA.$disconnect();
    await prismaB.$disconnect();

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const order = await prisma.masterOrder.findFirstOrThrow({ where: { paymentAttemptId: fixture.paymentAttemptId } });
    const snapshot = order.traderTaxProfileSnapshot as { isVatRegistered: boolean; vatNumber: string | null };
    const nameSnapshot = order.traderBillingLegalNameSnapshot;

    const isFullyOriginal = snapshot.isVatRegistered === false && snapshot.vatNumber === null && nameSnapshot === "Race Original Name LLC";
    const isFullyUpdated = snapshot.isVatRegistered === true && snapshot.vatNumber === raceVat && nameSnapshot === "Race Updated Name LLC";
    expect(isFullyOriginal || isFullyUpdated).toBe(true);
  }, 20_000);
});

describe("MasterOrderBuyerBillingOverride (integration, real DB)", () => {
  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect();
  });

  it("rejects an override for a RECENT order that already has a snapshot", async () => {
    const fixture = await seedPaymentFixture({ traderCrPrefix: "OVERRIDERECENT" });
    const provider = new MockPaymentProvider();
    await captureViaWebhook(provider, prisma as unknown as PrismaService, fixture.paymentAttemptId, `prov-ref-${fixture.paymentAttemptId}`, fixture.providerAmount);
    const order = await prisma.masterOrder.findFirstOrThrow({ where: { paymentAttemptId: fixture.paymentAttemptId } });

    const service = buildOverrideService();
    await expect(
      service.createOverride(order.id, "Trying to override a recent order.", { userId: crypto.randomUUID(), requestId: "r1" })
    ).rejects.toThrow();
  }, 20_000);

  it("a legacy order (traderTaxProfileSnapshot IS NULL) gets an override copying the CURRENT trader profile verbatim; the admin body never influences the VAT data", async () => {
    const legacyVat = uniqueVatNumber();
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "OVERRIDELEGACY" });
    const legacyOrder = await seedLegacyMasterOrder(fixture);

    const taxProfileService = buildTaxProfileService();
    await taxProfileService.upsert(
      { isVatRegistered: true, vatNumber: legacyVat, billingLegalName: "Legacy Current Legal Name LLC" },
      { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-set-profile" }
    );

    const service = buildOverrideService();
    const override = await service.createOverride(legacyOrder.id, "Legacy order missing buyer billing data.", {
      userId: crypto.randomUUID(),
      requestId: "r-override",
    });

    const snapshotOverride = override.traderTaxProfileSnapshotOverride as { isVatRegistered: boolean; vatNumber: string | null; billingLegalName: string };
    expect(snapshotOverride.isVatRegistered).toBe(true);
    expect(snapshotOverride.vatNumber).toBe(legacyVat);
    expect(snapshotOverride.billingLegalName).toBe("Legacy Current Legal Name LLC");
  }, 20_000);

  it("rejects a SECOND override for the same order", async () => {
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "OVERRIDESECOND" });
    const legacyOrder = await seedLegacyMasterOrder(fixture);
    const taxProfileService = buildTaxProfileService();
    await taxProfileService.upsert(
      { isVatRegistered: false, billingLegalName: "Second Override Test LLC" },
      { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-set-profile" }
    );

    const service = buildOverrideService();
    await service.createOverride(legacyOrder.id, "First override.", { userId: crypto.randomUUID(), requestId: "r1" });
    await expect(
      service.createOverride(legacyOrder.id, "Second override attempt.", { userId: crypto.randomUUID(), requestId: "r2" })
    ).rejects.toThrow();
  }, 20_000);

  it("a REAL race creating two overrides for the SAME order via two separate connections: exactly one succeeds", async () => {
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "OVERRIDERACE" });
    const legacyOrder = await seedLegacyMasterOrder(fixture);
    const taxProfileService = buildTaxProfileService();
    await taxProfileService.upsert(
      { isVatRegistered: false, billingLegalName: "Race Override Test LLC" },
      { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-set-profile" }
    );

    const prismaA = new PrismaClient();
    const prismaB = new PrismaClient();
    const serviceA = buildOverrideService(prismaA as unknown as PrismaService);
    const serviceB = buildOverrideService(prismaB as unknown as PrismaService);

    const results = await Promise.allSettled([
      serviceA.createOverride(legacyOrder.id, "Race attempt A.", { userId: crypto.randomUUID(), requestId: "r1" }),
      serviceB.createOverride(legacyOrder.id, "Race attempt B.", { userId: crypto.randomUUID(), requestId: "r2" }),
    ]);

    await prismaA.$disconnect();
    await prismaB.$disconnect();

    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded).toHaveLength(1);
    const overrideCount = await prisma.masterOrderBuyerBillingOverride.count({ where: { masterOrderId: legacyOrder.id } });
    expect(overrideCount).toBe(1);
  }, 20_000);

  it("rejects an override when the trader tax profile is incomplete", async () => {
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "OVERRIDENOPROFILE" });
    await prisma.traderTaxProfile.deleteMany({ where: { companyId: fixture.traderCompanyId } });
    const legacyOrder = await seedLegacyMasterOrder(fixture);

    const service = buildOverrideService();
    await expect(
      service.createOverride(legacyOrder.id, "Trying without a trader profile.", { userId: crypto.randomUUID(), requestId: "r1" })
    ).rejects.toThrow();
  }, 20_000);

  it("rejects an empty reasonNote", async () => {
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "OVERRIDENOREASON" });
    const legacyOrder = await seedLegacyMasterOrder(fixture);
    const taxProfileService = buildTaxProfileService();
    await taxProfileService.upsert(
      { isVatRegistered: false, billingLegalName: "No Reason Test LLC" },
      { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-set-profile" }
    );

    const service = buildOverrideService();
    await expect(service.createOverride(legacyOrder.id, "   ", { userId: crypto.randomUUID(), requestId: "r1" })).rejects.toThrow();
  }, 20_000);

  it("rejects a non-existent order", async () => {
    const service = buildOverrideService();
    await expect(
      service.createOverride(crypto.randomUUID(), "Order does not exist.", { userId: crypto.randomUUID(), requestId: "r1" })
    ).rejects.toThrow();
  }, 15_000);

  it("DB: the override row is immutable — UPDATE and DELETE are both rejected", async () => {
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "OVERRIDEIMMUTABLE" });
    const legacyOrder = await seedLegacyMasterOrder(fixture);
    const taxProfileService = buildTaxProfileService();
    await taxProfileService.upsert(
      { isVatRegistered: false, billingLegalName: "Immutable Test LLC" },
      { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-set-profile" }
    );
    const service = buildOverrideService();
    const override = await service.createOverride(legacyOrder.id, "Testing immutability.", { userId: crypto.randomUUID(), requestId: "r1" });

    await expect(prisma.$executeRaw`UPDATE master_order_buyer_billing_overrides SET reason_note = 'tampered' WHERE id = ${override.id}::uuid`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM master_order_buyer_billing_overrides WHERE id = ${override.id}::uuid`).rejects.toThrow();
  }, 20_000);

  it("Audit for the override never contains vatNumber or the raw billing legal name", async () => {
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "OVERRIDEAUDITSAFE" });
    const legacyOrder = await seedLegacyMasterOrder(fixture);
    const secretVat = uniqueVatNumber();
    const secretName = "Override Secret Legal Name Co";
    const taxProfileService = buildTaxProfileService();
    await taxProfileService.upsert(
      { isVatRegistered: true, vatNumber: secretVat, billingLegalName: secretName },
      { userId: crypto.randomUUID(), companyId: fixture.traderCompanyId, requestId: "r-set-profile" }
    );

    const service = buildOverrideService();
    const override = await service.createOverride(legacyOrder.id, "Audit safety test.", { userId: crypto.randomUUID(), requestId: "r1" });

    const audits = await prisma.auditLog.findMany({ where: { entityType: "master_order_buyer_billing_override", entityId: override.id } });
    expect(audits.length).toBeGreaterThan(0);
    for (const entry of audits) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(secretVat);
      expect(serialized).not.toContain(secretName);
    }
  }, 20_000);
});

async function seedLegacyMasterOrder(fixture: Awaited<ReturnType<typeof seedCheckoutFixture>>) {
  const supplierTaxProfile = await prisma.supplierTaxProfile.upsert({
    where: { companyId: fixture.supplierCompanyId },
    create: { companyId: fixture.supplierCompanyId, isVatRegistered: false },
    update: {},
  });
  const invoicingProfile = await prisma.supplierInvoicingProfile.upsert({
    where: { companyId: fixture.supplierCompanyId },
    create: { companyId: fixture.supplierCompanyId, invoicingLegalName: "Legacy Supplier LLC" },
    update: {},
  });
  const bankAccount = await prisma.supplierBankAccount.create({
    data: {
      companyId: fixture.supplierCompanyId,
      accountHolderName: "Legacy Holder",
      bankName: "Legacy Bank",
      ibanCiphertext: "ct",
      ibanFingerprint: `fp-legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ibanLast4: "9999",
      verificationStatus: "VERIFIED",
    },
  });

  const checkoutSession = await prisma.checkoutSession.create({
    data: {
      opportunityId: fixture.opportunityId,
      traderCompanyId: fixture.traderCompanyId,
      status: "PAID",
      lockedQuantity: 1,
      lockCreatedAt: new Date(Date.now() - 400 * 86_400_000),
      lockExpiresAt: new Date(Date.now() - 400 * 86_400_000 + 900_000),
      paymentDeadlineAt: new Date(Date.now() - 400 * 86_400_000 + 900_000),
      capturedAt: new Date(Date.now() - 400 * 86_400_000),
      lockReleasedAt: new Date(Date.now() - 400 * 86_400_000),
      traderCompanySnapshot: {},
    },
  });
  const paymentAttempt = await prisma.paymentAttempt.create({
    data: {
      checkoutSessionId: checkoutSession.id,
      status: "SUCCEEDED",
      providerCode: "MOCK",
      idempotencyKey: `legacy-${checkoutSession.id}`,
      amount: 110,
      currency: "SAR",
      providerCapturedAt: new Date(Date.now() - 400 * 86_400_000),
      providerCapturedAmount: 110,
    },
  });

  return prisma.masterOrder.create({
    data: {
      checkoutSessionId: checkoutSession.id,
      opportunityId: fixture.opportunityId,
      traderCompanyId: fixture.traderCompanyId,
      supplierCompanyId: fixture.supplierCompanyId,
      paymentAttemptId: paymentAttempt.id,
      supplierBankAccountId: bankAccount.id,
      status: "FULFILLED",
      totalAmount: 110,
      commissionBase: 100,
      commissionRateBasisPoints: 500,
      commissionAmount: 5,
      commissionTaxRate: 5,
      commissionTaxRuleCode: "X",
      commissionTaxRuleVersion: "v1",
      commissionTaxAmount: 0.25,
      supplierPayableAmount: 104.75,
      supplierLegalNameSnapshot: "Legacy Supplier LLC",
      supplierCrNumberSnapshot: "CR-LEGACY",
      supplierTaxProfileSnapshot: { isVatRegistered: supplierTaxProfile.isVatRegistered, vatNumber: supplierTaxProfile.vatNumber },
      supplierInvoicingProfileSnapshot: { invoicingLegalName: invoicingProfile.invoicingLegalName },
      paidAt: new Date(Date.now() - 400 * 86_400_000),
      // WHAT WAS SOLD, frozen on the order — see the migration
      // `order_freezes_what_was_sold`.
      productNameArSnapshot: "منتج اختبار",
      productNameEnSnapshot: "Test product",
      salesUnitNameArSnapshot: "وحدة",
      salesUnitNameEnSnapshot: "Unit",
      unitPriceInclTaxSnapshot: 100,
      totalQuantitySnapshot: 1,
    },
  });
}
