import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { AdminSessionService } from "../src/admin/admin-auth/admin-session.service";
import { MockRefundProvider } from "../src/refunds/providers/mock-refund.provider";
import { seedHistoricalDisputeRefundFixture, seedSettlementFixture, settlementFixturePrisma } from "./fixtures/settlement.fixture";

const prisma = settlementFixturePrisma;
const ORIGIN = "http://localhost:3001";
const API = "/api/v1";

async function mintAdminCookie(app: INestApplication): Promise<string> {
  const asid = await app.get(AdminSessionService).create({ adminUserId: crypto.randomUUID() }, 3600);
  return `asid=${asid}`;
}
const idemKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("E2E — Full Refund dispute -> ZERO_BALANCE settlement (real HTTP for every action under test)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("a FULL_REFUND dispute decision, executed via HTTP, results in a ZERO_BALANCE settlement with no transfer reference and no settlement journal", async () => {
    // The dispute itself (open -> respond -> FULL_REFUND decision) is
    // seeded as a historical fixture: its dispute window is CLOSED
    // since creation (immutable field, never mutated afterward, no
    // sleep). The dispute lifecycle over real HTTP is already
    // covered end-to-end by e2e-7e-main-journey and
    // dispute-http-controllers — this test's actual subject is the
    // refund execution and settlement, which run entirely over real
    // HTTP below.
    const snapshotProbe = await seedSettlementFixture("E2EFULLREFPROBE");
    const probeSnapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: snapshotProbe.deliveredOrderAllocationId } });

    const fixture = await seedHistoricalDisputeRefundFixture("E2EFULLREF", {
      decisionType: "FULL_REFUND",
      productRefundAmountInclTax: Number(probeSnapshot.productAmountInclTax),
      shippingRefundAmount: Number(probeSnapshot.shippingFeeAmount),
    });
    const adminCookie = await mintAdminCookie(app);
    const refundObligation = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });

    const startAttemptRes = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("refundattempt"))
      .send({ providerCode: "MOCK_REFUND" });
    expect(startAttemptRes.status).toBe(201);

    const refundProvider = new MockRefundProvider();
    const refundWebhook = refundProvider.buildSignedWebhook({
      merchantReference: startAttemptRes.body.refundAttemptId,
      providerReference: startAttemptRes.body.providerReference,
      providerEventId: `evt-refund-${startAttemptRes.body.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: Number(refundObligation.amount),
    });
    const refundWebhookReq = request(app.getHttpServer()).post(`${API}/webhooks/refunds/MOCK_REFUND`).set("Content-Type", "application/json").set(refundWebhook.headers);
    refundWebhookReq.write(refundWebhook.rawBody);
    const refundWebhookRes = await refundWebhookReq;
    expect(refundWebhookRes.status).toBe(200);
    expect(refundWebhookRes.body.processingOutcome).toBe("SUCCEEDED");

    // The dispute window is ALREADY closed (seeded in the past) — settlement can proceed immediately, no wait.
    const settleRes = await request(app.getHttpServer())
      .post(`${API}/admin/order-allocations/${fixture.deliveredOrderAllocationId}/settle`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("settlezero"))
      .send({});
    expect(settleRes.status).toBe(201);
    expect(settleRes.body.outcome).toBe("ZERO_BALANCE");
    expect(settleRes.body.netAmount).toBe(0);
    expect(settleRes.body.externalTransferReference).toBeNull();

    const journalCount = await prisma.journalEntry.count({ where: { referenceType: "supplier_payout", referenceId: settleRes.body.supplierPayoutId } });
    expect(journalCount).toBe(0);
  }, 30_000);
});
