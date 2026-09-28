import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { SessionService } from "../src/common/security/session.service";
import { AdminSessionService } from "../src/admin/admin-auth/admin-session.service";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { ensureCommissionTaxPolicy } from "./fixtures/payment.fixture";

const prisma = checkoutFixturePrisma;
const ORIGIN = "http://localhost:3001";
const API = "/api/v1";

async function mintTraderCookie(app: INestApplication, userId: string, companyId: string): Promise<string> {
  const sid = await app.get(SessionService).create({ userId, companyId, accountType: "TRADER" });
  return `sid=${sid}`;
}
async function mintAdminCookie(app: INestApplication): Promise<string> {
  const asid = await app.get(AdminSessionService).create({ adminUserId: crypto.randomUUID() }, 3600);
  return `asid=${asid}`;
}
const idemKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("E2E — TraderTaxProfile gating & legacy-order override (real HTTP throughout)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("a trader with NO tax profile cannot start payment — rejected before any provider call, via real HTTP", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "E2ETAXGATE" });
    await prisma.traderTaxProfile.deleteMany({ where: { companyId: fixture.traderCompanyId } });
    const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);

    const checkoutRes = await request(app.getHttpServer())
      .post(`${API}/trader/checkout-sessions`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("taxgatecheckout"))
      .send({ opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] });
    expect(checkoutRes.status).toBe(201);

    const startPaymentRes = await request(app.getHttpServer())
      .post(`${API}/trader/checkout-sessions/${checkoutRes.body.id}/payment-attempts`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("taxgatestart"))
      .send({});
    expect(startPaymentRes.status).toBeGreaterThanOrEqual(400);

    const attemptCount = await prisma.paymentAttempt.count({ where: { checkoutSessionId: checkoutRes.body.id } });
    expect(attemptCount).toBe(0);
  }, 20_000);

  it("a legacy order (no buyer snapshot) is rejected for a product draft, then succeeds AFTER a real HTTP override", async () => {
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "E2ETAXLEGACY" });
    const legacyOrder = await seedLegacyMasterOrder(fixture);

    const adminCookie = await mintAdminCookie(app);

    const draftRejectedRes = await request(app.getHttpServer())
      .post(`${API}/admin/orders/${legacyOrder.id}/invoice-drafts/product`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("legacydraftbefore"))
      .send({});
    expect(draftRejectedRes.status).toBeGreaterThanOrEqual(400);

    const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);
    const setProfileRes = await request(app.getHttpServer())
      .put(`${API}/trader/settings/tax-profile`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .send({ isVatRegistered: false, billingLegalName: "Legacy Trader Current Legal Name" });
    expect(setProfileRes.status).toBe(200);

    const overrideRes = await request(app.getHttpServer())
      .post(`${API}/admin/orders/${legacyOrder.id}/buyer-billing-override`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .send({ reasonNote: "Legacy order missing buyer billing snapshot — creating an override." });
    expect(overrideRes.status).toBe(201);

    const draftSucceedsRes = await request(app.getHttpServer())
      .post(`${API}/admin/orders/${legacyOrder.id}/invoice-drafts/product`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("legacydraftafter"))
      .send({});
    expect(draftSucceedsRes.status).toBe(201);
    expect(draftSucceedsRes.body.snapshotData.buyer.legalName).toBe("Legacy Trader Current Legal Name");
  }, 30_000);
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
      ibanFingerprint: `fp-legacy-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ibanLast4: "9999",
      verificationStatus: "VERIFIED",
    },
  });

  const shippingFee = 10;
  const past = new Date(Date.now() - 400 * 86_400_000);
  const checkoutSession = await prisma.checkoutSession.create({
    data: {
      opportunityId: fixture.opportunityId,
      traderCompanyId: fixture.traderCompanyId,
      status: "PAID",
      lockedQuantity: 1,
      lockCreatedAt: past,
      lockExpiresAt: new Date(past.getTime() + 900_000),
      paymentDeadlineAt: new Date(past.getTime() + 900_000),
      capturedAt: past,
      lockReleasedAt: past,
      traderCompanySnapshot: {},
    },
  });

  const productApprovalSnapshot = await prisma.productApprovalSnapshot.findFirstOrThrow({ orderBy: { approvedAt: "desc" } });
  const shippingTariffPolicyVersion = await prisma.shippingTariffPolicyVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
  await prisma.quoteSnapshot.create({
    data: {
      checkoutSessionId: checkoutSession.id,
      productApprovalSnapshotId: productApprovalSnapshot.id,
      salesUnitNameAr: "a",
      salesUnitNameEn: "a",
      quantity: 1,
      shareQuantity: 1,
      sharePercentageReadable: 100,
      unitPriceInclTaxAmount: 100,
      unitPriceExclTaxAmount: 86.96,
      unitTaxAmount: 13.04,
      taxRatePercent: 15,
      taxCalculationRuleCode: "D",
      taxCalculationRuleVersion: "v1",
      productsSubtotalExclTaxAmount: 86.96,
      productsTaxAmount: 13.04,
      productsSubtotalInclTaxAmount: 100,
      totalShippingFeeAmount: shippingFee,
      grandTotalAmount: 110,
      shippingTariffPolicyVersionId: shippingTariffPolicyVersion.id,
      shippingProviderCode: "MOCK",
      createdAt: past,
    },
  });

  const cla = await prisma.checkoutLocationAllocation.create({
    data: {
      checkoutSessionId: checkoutSession.id,
      companyLocationId: fixture.traderLocations.sameCity,
      locationNameSnapshot: "l",
      cityNameArSnapshot: "c",
      cityNameEnSnapshot: "c",
      regionNameArSnapshot: "r",
      regionNameEnSnapshot: "r",
      addressSnapshot: "a",
      contactNameSnapshot: "n",
      contactPhoneSnapshot: "p",
      quantity: 1,
      shippingTierCode: "SAME_CITY",
      shippingFeeAmount: shippingFee,
      createdAt: past,
    },
  });

  const paymentAttempt = await prisma.paymentAttempt.create({
    data: {
      checkoutSessionId: checkoutSession.id,
      status: "SUCCEEDED",
      providerCode: "MOCK",
      idempotencyKey: `legacy-e2e-${checkoutSession.id}`,
      amount: 110,
      currency: "SAR",
      providerCapturedAt: past,
      providerCapturedAmount: 110,
    },
  });

  const commissionAmount = 4.35;
  const commissionTaxAmount = 0.22;
  const order = await prisma.masterOrder.create({
    data: {
      checkoutSessionId: checkoutSession.id,
      opportunityId: fixture.opportunityId,
      traderCompanyId: fixture.traderCompanyId,
      supplierCompanyId: fixture.supplierCompanyId,
      paymentAttemptId: paymentAttempt.id,
      supplierBankAccountId: bankAccount.id,
      status: "FULFILLED",
      totalAmount: 110,
      commissionBase: 86.96,
      commissionRateBasisPoints: 500,
      commissionAmount,
      commissionTaxRate: 5,
      commissionTaxRuleCode: "X",
      commissionTaxRuleVersion: "v1",
      commissionTaxAmount,
      supplierPayableAmount: 105.43,
      supplierLegalNameSnapshot: "Legacy Supplier LLC",
      supplierCrNumberSnapshot: "CR-LEGACY-E2E",
      supplierTaxProfileSnapshot: { isVatRegistered: supplierTaxProfile.isVatRegistered, vatNumber: supplierTaxProfile.vatNumber },
      supplierInvoicingProfileSnapshot: { invoicingLegalName: invoicingProfile.invoicingLegalName },
      paidAt: past,
      // WHAT WAS SOLD, frozen on the order — see the migration
      // `order_freezes_what_was_sold`. A fixture that omits these is
      // building an order the platform can no longer write.
      productNameArSnapshot: "منتج اختبار",
      productNameEnSnapshot: "Test product",
      salesUnitNameArSnapshot: "وحدة",
      salesUnitNameEnSnapshot: "Unit",
      unitPriceInclTaxSnapshot: 100,
      totalQuantitySnapshot: 1,
    },
  });

  await prisma.$transaction(async (tx) => {
    const alloc = await tx.orderAllocation.create({
      data: {
        masterOrderId: order.id,
        checkoutLocationAllocationId: cla.id,
        status: "DELIVERED",
        expectedPreparationDays: 3,
        preparationDueAt: new Date(past.getTime() + 3 * 86_400_000),
        preparationStartedAt: past,
        readyToShipAt: past,
        shippedAt: past,
        deliveredAt: past,
        disputeWindowClosesAt: new Date(past.getTime() + 7 * 86_400_000),
        createdAt: past,
      },
    });
    await tx.shipmentTracking.create({
      data: { orderAllocationId: alloc.id, carrierCode: "MOCK_CARRIER", trackingNumber: `LEGACYE2E-${alloc.id.slice(0, 8)}`, shippedByUserId: crypto.randomUUID() },
    });
    await tx.deliveryConfirmation.create({
      data: { orderAllocationId: alloc.id, confirmedBySource: "TRADER_CONFIRMATION", confirmedAt: past, confirmedByUserId: fixture.traderUserId },
    });
    await tx.orderAllocationFinancialSnapshot.create({
      data: {
        orderAllocationId: alloc.id,
        productAmountExclTax: 86.96,
        productTaxAmount: 13.04,
        productAmountInclTax: 100,
        allocationShareBasisPoints: 10000,
        commissionShareAmount: commissionAmount,
        commissionShareTaxAmount: commissionTaxAmount,
        supplierPayableShareAmount: 95.43,
        shippingFeeAmount: shippingFee,
      },
    });
    await tx.$executeRawUnsafe(
      `SET CONSTRAINTS trg_check_shipped_has_tracking, trg_check_delivered_has_confirmation, trg_check_financial_snapshot_sums_match_source IMMEDIATE`
    );
  });

  return order;
}
