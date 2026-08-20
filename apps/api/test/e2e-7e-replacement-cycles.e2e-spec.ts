import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { SessionService } from "../src/common/security/session.service";
import { AdminSessionService } from "../src/admin/admin-auth/admin-session.service";
import { seedHistoricalActiveReplacementFixture, settlementFixturePrisma } from "./fixtures/settlement.fixture";

const prisma = settlementFixturePrisma;
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

describe("E2E — Replacement cycles (real HTTP for every action under test; dispute lifecycle seeded historically, window already closed)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("cycle 1: a full replacement through delivery, then the ORIGINAL allocation becomes eligible for settlement — no sleep, no field mutation", async () => {
    // The dispute (open -> respond -> REPLACEMENT decision) is seeded
    // historically, with the dispute window ALREADY closed since
    // creation (immutable field). The dispute lifecycle itself over
    // real HTTP is already covered by e2e-7e-main-journey and
    // dispute-http-controllers. This test's actual subject —
    // fulfilling the replacement and settling — runs entirely over
    // real HTTP below, with no wait required at any point.
    const fixture = await seedHistoricalActiveReplacementFixture("E2EREPLOK");
    const supplierUserId = crypto.randomUUID();
    const supplierCookie = await mintSupplierCookie(app, supplierUserId, fixture.supplierCompanyId);
    const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);
    const adminCookie = await mintAdminCookie(app);

    let res = await request(app.getHttpServer())
      .post(`${API}/supplier/replacement-obligations/${fixture.replacementObligationId}/start-preparation`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN);
    expect(res.status).toBe(201);

    res = await request(app.getHttpServer())
      .post(`${API}/supplier/replacement-obligations/${fixture.replacementObligationId}/mark-ready`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN);
    expect(res.status).toBe(201);

    res = await request(app.getHttpServer())
      .post(`${API}/supplier/replacement-obligations/${fixture.replacementObligationId}/ship`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN)
      .send({ carrierCode: "MOCK_CARRIER", trackingNumber: `E2EREPL-${fixture.replacementObligationId.slice(0, 8)}` });
    expect(res.status).toBe(201);

    res = await request(app.getHttpServer())
      .post(`${API}/trader/replacement-obligations/${fixture.replacementObligationId}/confirm-delivery`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN);
    expect(res.status).toBe(201);

    const replacementAfter = await prisma.replacementObligation.findUniqueOrThrow({ where: { id: fixture.replacementObligationId } });
    expect(replacementAfter.status).toBe("DELIVERED");

    const disputeAfter = await prisma.dispute.findUniqueOrThrow({ where: { id: fixture.disputeId } });
    expect(disputeAfter.status).toBe("RESOLVED_REPLACED");

    // The dispute window was ALREADY closed at seed time — settlement proceeds immediately, no wait.
    const snapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
    const expectedNet = (Number(snapshot.supplierPayableShareAmount) + Number(snapshot.shippingFeeAmount)).toFixed(2);

    const settleRes = await request(app.getHttpServer())
      .post(`${API}/admin/order-allocations/${fixture.deliveredOrderAllocationId}/settle`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("replok-settle"))
      .send({ externalTransferReference: `E2E-REPLOK-REF-${Date.now()}` });
    expect(settleRes.status).toBe(201);
    expect(settleRes.body.outcome).toBe("EXECUTED");
    expect(settleRes.body.netAmount).toBe(Number(expectedNet));
  }, 30_000);

  it("cycle 2: a FAILED replacement (marked via real HTTP), then a SECOND FULL_REFUND decision on the SAME dispute — no new dispute, no third decision allowed", async () => {
    const fixture = await seedHistoricalActiveReplacementFixture("E2EREPLFAIL");
    const adminCookie = await mintAdminCookie(app);

    const failRes = await request(app.getHttpServer())
      .post(`${API}/admin/replacement-obligations/${fixture.replacementObligationId}/mark-failed`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN);
    expect(failRes.status).toBe(201);

    const disputeAfterFail = await prisma.dispute.findUniqueOrThrow({ where: { id: fixture.disputeId } });
    expect(disputeAfterFail.status).toBe("AWAITING_REPLACEMENT");

    const secondDecideRes = await request(app.getHttpServer())
      .post(`${API}/admin/disputes/${fixture.disputeId}/decide`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("replfail-decide2"))
      .send({ decisionType: "FULL_REFUND", reasonNote: "Replacement failed — issuing a full refund instead." });
    expect(secondDecideRes.status).toBe(201);
    expect(secondDecideRes.body.sequenceNumber).toBe(2);

    const decisions = await prisma.disputeDecision.findMany({ where: { disputeId: fixture.disputeId }, orderBy: { sequenceNumber: "asc" } });
    expect(decisions).toHaveLength(2);
    expect(decisions[0].decisionType).toBe("REPLACEMENT");
    expect(decisions[1].decisionType).toBe("FULL_REFUND");

    const disputeCount = await prisma.dispute.count({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
    expect(disputeCount).toBe(1);

    const thirdDecideRes = await request(app.getHttpServer())
      .post(`${API}/admin/disputes/${fixture.disputeId}/decide`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("replfail-decide3"))
      .send({ decisionType: "REJECTED", reasonNote: "Attempting a third decision, should be rejected." });
    expect(thirdDecideRes.status).toBeGreaterThanOrEqual(400);
  }, 30_000);
});
