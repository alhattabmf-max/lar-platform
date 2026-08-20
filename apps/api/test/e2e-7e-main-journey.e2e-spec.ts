import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { SessionService } from "../src/common/security/session.service";
import { AdminSessionService } from "../src/admin/admin-auth/admin-session.service";
import { MockPaymentProvider } from "../src/payments/providers/mock-payment.provider";
import { MockRefundProvider } from "../src/refunds/providers/mock-refund.provider";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { ensureCommissionTaxPolicy, seedSupplierBilling } from "./fixtures/payment.fixture";

const prisma = checkoutFixturePrisma;
const ORIGIN = "http://localhost:3001";
const API = "/api/v1";

async function mintTraderCookie(app: INestApplication, userId: string, companyId: string): Promise<string> {
  const sid = await app.get(SessionService).create({ userId, companyId, accountType: "TRADER" });
  return `sid=${sid}`;
}
async function mintSupplierCookie(app: INestApplication, userId: string, companyId: string): Promise<string> {
  const sid = await app.get(SessionService).create({ userId, companyId, accountType: "SUPPLIER" });
  return `sid=${sid}`;
}
async function mintAdminCookie(app: INestApplication): Promise<string> {
  const asid = await app.get(AdminSessionService).create({ adminUserId: crypto.randomUUID() }, 3600);
  return `asid=${asid}`;
}
const idemKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("E2E 7E — main journey: checkout -> payment -> fulfillment -> dispute -> refund (real HTTP throughout)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("the full 7E journey through real HTTP, ending with a COMPLETED refund and two separate balanced ledger entries", async () => {
    await ensureCommissionTaxPolicy();
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "E2EMAIN" });
    await seedSupplierBilling(fixture.supplierCompanyId);

    const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);
    const opportunityAtStart = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });

    // 1. Checkout.
    const checkoutRes = await request(app.getHttpServer())
      .post(`${API}/trader/checkout-sessions`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("checkout"))
      .send({ opportunityId: fixture.opportunityId, quantity: 4, allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }] });
    expect(checkoutRes.status).toBe(201);
    const checkoutSessionId = checkoutRes.body.id;
    const grandTotalAmount = checkoutRes.body.grandTotalAmount;

    // 2. Start payment.
    const startPaymentRes = await request(app.getHttpServer())
      .post(`${API}/trader/checkout-sessions/${checkoutSessionId}/payment-attempts`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("startpay"))
      .send({});
    expect(startPaymentRes.status).toBe(201);
    const paymentAttemptId = startPaymentRes.body.id;

    // 3. Payment succeeds via a real signed webhook over HTTP.
    const paymentProvider = new MockPaymentProvider();
    const { rawBody, headers } = paymentProvider.buildSignedWebhook({
      merchantReference: paymentAttemptId,
      providerReference: `prov-ref-${paymentAttemptId}`,
      providerEventId: `evt-${paymentAttemptId}`,
      eventType: "SUCCESS",
      providerCapturedAt: new Date(),
      providerCapturedAmount: grandTotalAmount,
    });
    const webhookReq = request(app.getHttpServer()).post(`${API}/webhooks/payments/MOCK`).set("Content-Type", "application/json").set(headers);
    webhookReq.write(rawBody);
    const webhookRes = await webhookReq;
    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.processingOutcome).toBe("ORDER_CREATED");

    const order = await prisma.masterOrder.findFirstOrThrow({ where: { paymentAttemptId } });
    const allocation = await prisma.orderAllocation.findFirstOrThrow({ where: { masterOrderId: order.id } });
    const opportunityBefore = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });

    // 4. Deliver the allocation via real HTTP (supplier prep -> ship, trader confirms).
    const supplierUserId = crypto.randomUUID();
    const supplierCookie = await mintSupplierCookie(app, supplierUserId, fixture.supplierCompanyId);

    let res = await request(app.getHttpServer())
      .post(`${API}/supplier/order-allocations/${allocation.id}/start-preparation`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN);
    expect(res.status).toBe(201);

    res = await request(app.getHttpServer())
      .post(`${API}/supplier/order-allocations/${allocation.id}/mark-ready`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN);
    expect(res.status).toBe(201);

    res = await request(app.getHttpServer())
      .post(`${API}/supplier/order-allocations/${allocation.id}/ship`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN)
      .send({ carrierCode: "MOCK_CARRIER", trackingNumber: `E2E-${allocation.id.slice(0, 8)}` });
    expect(res.status).toBe(201);

    res = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${allocation.id}/confirm-delivery`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN);
    expect(res.status).toBe(201);

    // 5. Trader opens a dispute WITH evidence.
    const uploadRes = await request(app.getHttpServer())
      .post(`${API}/trader/evidence-uploads`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .attach("file", Buffer.from("fake-evidence-bytes"), { filename: "proof.jpg", contentType: "image/jpeg" });
    expect(uploadRes.status).toBe(201);

    const openRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${allocation.id}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("open"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "The item arrived visibly damaged, see attached photo.", evidenceStorageObjectKeys: [uploadRes.body.storageObjectKey] });
    expect(openRes.status).toBe(201);
    const disputeId = openRes.body.id;

    // 6. Supplier responds.
    res = await request(app.getHttpServer())
      .post(`${API}/supplier/disputes/${disputeId}/respond`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("respond"))
      .send({ responseType: "PARTIAL_ACCEPT", description: "We accept partial responsibility for the damage." });
    expect(res.status).toBe(201);

    // 7. Admin decides: PARTIAL_REFUND.
    const adminCookie = await mintAdminCookie(app);
    const snapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: allocation.id } });
    const partialProduct = (Math.floor((Number(snapshot.productAmountInclTax) / 4) * 100) / 100).toFixed(2);

    const decideRes = await request(app.getHttpServer())
      .post(`${API}/admin/disputes/${disputeId}/decide`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("decide"))
      .send({ decisionType: "PARTIAL_REFUND", productRefundAmountInclTax: partialProduct, shippingRefundAmount: "0.00", reasonNote: "Partial refund approved for the reported damage." });
    expect(decideRes.status).toBe(201);

    const refundObligation = await prisma.refundObligation.findFirstOrThrow({ where: { disputeDecision: { disputeId } } });
    const decisionJournal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "refund_obligation", referenceId: refundObligation.id, eventType: "DISPUTE_REFUND_OBLIGATION" } });
    const opportunityBeforeRefund = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });

    // 8. Admin starts the refund attempt via HTTP.
    const startAttemptRes = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("refundattempt"))
      .send({ providerCode: "MOCK_REFUND" });
    expect(startAttemptRes.status).toBe(201);
    expect(startAttemptRes.body.outcome).toBe("PENDING");
    const refundAttemptId = startAttemptRes.body.refundAttemptId;
    const actualProviderReference = startAttemptRes.body.providerReference;

    // 9. Refund succeeds via a real signed webhook over HTTP.
    const refundProvider = new MockRefundProvider();
    const refundWebhook = refundProvider.buildSignedWebhook({
      merchantReference: refundAttemptId,
      providerReference: actualProviderReference,
      providerEventId: `evt-refund-${refundAttemptId}`,
      eventType: "SUCCESS",
      amount: Number(refundObligation.amount),
    });
    const refundWebhookReq = request(app.getHttpServer()).post(`${API}/webhooks/refunds/MOCK_REFUND`).set("Content-Type", "application/json").set(refundWebhook.headers);
    refundWebhookReq.write(refundWebhook.rawBody);
    const refundWebhookRes = await refundWebhookReq;
    expect(refundWebhookRes.status).toBe(200);
    expect(refundWebhookRes.body.processingOutcome).toBe("SUCCEEDED");

    // Verify: COMPLETED, two SEPARATE balanced ledger entries, fundedQuantity unchanged.
    const refundObligationAfter = await prisma.refundObligation.findUniqueOrThrow({ where: { id: refundObligation.id } });
    expect(refundObligationAfter.status).toBe("COMPLETED");

    const executionJournal = await prisma.journalEntry.findFirstOrThrow({ where: { referenceType: "refund_obligation", referenceId: refundObligation.id, eventType: "REFUND_EXECUTED" } });
    expect(executionJournal.id).not.toBe(decisionJournal.id);

    for (const journalId of [decisionJournal.id, executionJournal.id]) {
      const postings = await prisma.ledgerPosting.findMany({ where: { journalEntryId: journalId } });
      const debitSum = postings.filter((p) => p.direction === "DEBIT").reduce((s, p) => s + Number(p.amount), 0);
      const creditSum = postings.filter((p) => p.direction === "CREDIT").reduce((s, p) => s + Number(p.amount), 0);
      expect(Math.round(debitSum * 100)).toBe(Math.round(creditSum * 100));
    }

    const opportunityAfter = await prisma.opportunity.findUniqueOrThrow({ where: { id: fixture.opportunityId } });
    expect(opportunityAfter.fundedQuantity).toBe(opportunityAtStart.fundedQuantity + 4);
    expect(opportunityAfter.fundedQuantity).toBe(opportunityBefore.fundedQuantity);
    // Precisely: the dispute/refund phase itself never touches fundedQuantity again.
    expect(opportunityAfter.fundedQuantity).toBe(opportunityBeforeRefund.fundedQuantity);
  }, 60_000);
});
