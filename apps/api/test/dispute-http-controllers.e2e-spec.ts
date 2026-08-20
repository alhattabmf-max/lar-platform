import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { SessionService } from "../src/common/security/session.service";
import { AdminSessionService } from "../src/admin/admin-auth/admin-session.service";
import { PrismaService } from "../src/database/prisma.service";
import { seedSettlementFixture } from "./fixtures/settlement.fixture";

// Merged from the former dispute-controllers.e2e-spec.ts +
// dispute-http-controllers.e2e-spec.ts (which covered heavily
// overlapping ground) into a single file that keeps the UNION of
// every distinct scenario from both — nothing was dropped, only
// genuine duplicates were consolidated to their single strictest
// assertion.
const ORIGIN = "http://localhost:3001";
const API = "/api/v1";

async function mintTraderCookie(sessions: SessionService, userId: string, companyId: string): Promise<string> {
  const sid = await sessions.create({ userId, companyId, accountType: "TRADER" });
  return `sid=${sid}`;
}
async function mintSupplierCookie(sessions: SessionService, userId: string, companyId: string): Promise<string> {
  const sid = await sessions.create({ userId, companyId, accountType: "SUPPLIER" });
  return `sid=${sid}`;
}
async function mintAdminCookie(adminSessions: AdminSessionService): Promise<string> {
  const asid = await adminSessions.create({ adminUserId: crypto.randomUUID() }, 3600);
  return `asid=${asid}`;
}
const idemKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Dispute controllers — HTTP integration (real Guards/CSRF/Idempotency, merged coverage)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let sessions: SessionService;
  let adminSessions: AdminSessionService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    prisma = moduleRef.get(PrismaService) as unknown as PrismaClient;
    sessions = moduleRef.get(SessionService);
    adminSessions = moduleRef.get(AdminSessionService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("full happy path: open dispute -> add evidence -> supplier respond -> admin decide, verified from every party's own view", async () => {
    const fixture = await seedSettlementFixture("HTTPDISPUTE", 60_000);
    const traderCookie = await mintTraderCookie(sessions, fixture.traderUserId, fixture.traderCompanyId);
    const supplierUserId = crypto.randomUUID();
    const supplierCookie = await mintSupplierCookie(sessions, supplierUserId, fixture.supplierCompanyId);
    const adminCookie = await mintAdminCookie(adminSessions);

    const uploadRes = await request(app.getHttpServer())
      .post(`${API}/trader/evidence-uploads`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .attach("file", Buffer.from("fake-image-bytes"), { filename: "evidence.jpg", contentType: "image/jpeg" });
    expect(uploadRes.status).toBe(201);
    const storageObjectKey = uploadRes.body.storageObjectKey;
    expect(typeof storageObjectKey).toBe("string");

    const openRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("open"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "The item arrived damaged in transit." });
    expect(openRes.status).toBe(201);
    const disputeId = openRes.body.id;
    expect(disputeId).toBeTruthy();

    const evidenceRes = await request(app.getHttpServer())
      .post(`${API}/trader/disputes/${disputeId}/evidence`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("evidence"))
      .send({ storageObjectKey });
    expect(evidenceRes.status).toBe(201);

    const traderGetRes = await request(app.getHttpServer()).get(`${API}/trader/disputes/${disputeId}`).set("Cookie", traderCookie).set("Origin", ORIGIN);
    expect(traderGetRes.status).toBe(200);
    expect(traderGetRes.body.status).toBe("OPEN");
    expect(traderGetRes.body.evidence.length).toBeGreaterThan(0);

    const respondRes = await request(app.getHttpServer())
      .post(`${API}/supplier/disputes/${disputeId}/respond`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("respond"))
      .send({ responseType: "PARTIAL_ACCEPT", description: "We accept partial responsibility for the damage." });
    expect(respondRes.status).toBe(201);

    const supplierGetRes = await request(app.getHttpServer()).get(`${API}/supplier/disputes/${disputeId}`).set("Cookie", supplierCookie).set("Origin", ORIGIN);
    expect(supplierGetRes.status).toBe(200);
    expect(supplierGetRes.body.status).toBe("SUPPLIER_RESPONDED");
    expect(supplierGetRes.body.supplierResponse.responseType).toBe("PARTIAL_ACCEPT");

    const decideRes = await request(app.getHttpServer())
      .post(`${API}/admin/disputes/${disputeId}/decide`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("decide"))
      .send({ decisionType: "PARTIAL_REFUND", productRefundAmountInclTax: "10.00", shippingRefundAmount: "0.00", reasonNote: "Partial refund approved for shipping damage." });
    expect(decideRes.status).toBe(201);
    expect(decideRes.body.decisionType).toBe("PARTIAL_REFUND");

    const adminListRes = await request(app.getHttpServer()).get(`${API}/admin/disputes`).set("Cookie", adminCookie).set("Origin", ORIGIN);
    expect(adminListRes.status).toBe(200);
    expect(Array.isArray(adminListRes.body)).toBe(true);

    const adminGetRes = await request(app.getHttpServer()).get(`${API}/admin/disputes/${disputeId}`).set("Cookie", adminCookie).set("Origin", ORIGIN);
    expect(adminGetRes.status).toBe(200);
    expect(adminGetRes.body.decisions).toHaveLength(1);
  }, 30_000);

  it("a DIFFERENT trader company cannot see or open a dispute on someone else's allocation — 404, never 403 (no existence leak)", async () => {
    const fixture = await seedSettlementFixture("HTTPDISPUTEISO", 60_000);
    const strangerCookie = await mintTraderCookie(sessions, crypto.randomUUID(), crypto.randomUUID());

    const openRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", strangerCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("isoopen"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "Trying to open a dispute on an allocation that is not mine." });
    expect(openRes.status).toBe(404);

    const traderCookie = await mintTraderCookie(sessions, fixture.traderUserId, fixture.traderCompanyId);
    const legitOpenRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("isoopen2"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "The legitimate trader opens this dispute." });
    expect(legitOpenRes.status).toBe(201);

    const strangerGetRes = await request(app.getHttpServer())
      .get(`${API}/trader/disputes/${legitOpenRes.body.id}`)
      .set("Cookie", strangerCookie)
      .set("Origin", ORIGIN);
    expect(strangerGetRes.status).toBe(404);
  }, 30_000);

  it("Idempotency: replaying the SAME open-dispute request with the same key returns the SAME dispute — no duplicate row", async () => {
    const fixture = await seedSettlementFixture("HTTPDISPUTEIDEM", 60_000);
    const traderCookie = await mintTraderCookie(sessions, fixture.traderUserId, fixture.traderCompanyId);
    const key = idemKey("idem");
    const body = { reasonCode: "ITEM_DAMAGED", description: "Idempotency test for opening a dispute via HTTP." };

    const first = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", key)
      .send(body);
    const second = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", key)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    const count = await prisma.dispute.count({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
    expect(count).toBe(1);
  }, 30_000);

  it("a POST without Idempotency-Key is rejected with 400", async () => {
    const fixture = await seedSettlementFixture("HTTPDISPUTENOKEY", 60_000);
    const traderCookie = await mintTraderCookie(sessions, fixture.traderUserId, fixture.traderCompanyId);
    const res = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .send({ reasonCode: "ITEM_DAMAGED", description: "Missing the Idempotency-Key header on purpose." });
    expect(res.status).toBe(400);
  }, 20_000);

  it("a supplier attempting to respond to a dispute NOT belonging to their company gets 404", async () => {
    const fixture = await seedSettlementFixture("HTTPDISPUTESUPWRONG", 60_000);
    const traderCookie = await mintTraderCookie(sessions, fixture.traderUserId, fixture.traderCompanyId);
    const openRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("supwrongopen"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "Dispute for supplier-isolation test." });
    const disputeId = openRes.body.id;

    const wrongSupplierCookie = await mintSupplierCookie(sessions, crypto.randomUUID(), crypto.randomUUID());
    const res = await request(app.getHttpServer())
      .post(`${API}/supplier/disputes/${disputeId}/respond`)
      .set("Cookie", wrongSupplierCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("supwrongrespond"))
      .send({ responseType: "ACCEPT", description: "Attempting to respond to someone else's dispute." });
    expect(res.status).toBe(404);
  }, 20_000);

  it("a TRADER attempting to respond as a supplier (respond is a supplier-only action) gets 403", async () => {
    const fixture = await seedSettlementFixture("HTTPDISPUTETRADERSUPP", 60_000);
    const traderCookie = await mintTraderCookie(sessions, fixture.traderUserId, fixture.traderCompanyId);
    const openRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("tradersupopen"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "Setting up for a trader-as-supplier isolation test." });
    const disputeId = openRes.body.id;

    const res = await request(app.getHttpServer())
      .post(`${API}/supplier/disputes/${disputeId}/respond`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("tradersuprespond"))
      .send({ responseType: "ACCEPT", description: "A trader should never be able to respond as the supplier." });
    expect(res.status).toBe(403);
  }, 20_000);

  it("a supplier attempting to call the REAL admin decide endpoint (no admin session) gets 401", async () => {
    const fixture = await seedSettlementFixture("HTTPDISPUTESUPASADMIN", 60_000);
    const traderCookie = await mintTraderCookie(sessions, fixture.traderUserId, fixture.traderCompanyId);
    const openRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("supasadminopen"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "Dispute for supplier-as-admin (real endpoint) test." });
    const disputeId = openRes.body.id;

    const supplierCookie = await mintSupplierCookie(sessions, crypto.randomUUID(), fixture.supplierCompanyId);
    const res = await request(app.getHttpServer())
      .post(`${API}/admin/disputes/${disputeId}/decide`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("supasadmindecide"))
      .send({ decisionType: "REJECTED", reasonNote: "Supplier trying to decide their own dispute via the real admin endpoint." });
    expect(res.status).toBe(401);
  }, 20_000);

  it("a supplier hitting a decide-style path under their OWN namespace gets 404 — no such route exists there at all", async () => {
    const fixture = await seedSettlementFixture("HTTPDISPUTESUPPADMINROUTE", 60_000);
    const traderCookie = await mintTraderCookie(sessions, fixture.traderUserId, fixture.traderCompanyId);
    const openRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("suppadminrouteopen"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "Setting up for a supplier-namespace-has-no-decide-route test." });
    const disputeId = openRes.body.id;

    const supplierCookie = await mintSupplierCookie(sessions, crypto.randomUUID(), fixture.supplierCompanyId);
    const res = await request(app.getHttpServer())
      .post(`${API}/supplier/disputes/${disputeId}/decide`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("suppadminroutedecide"))
      .send({ decisionType: "REJECTED", reasonNote: "A supplier should never be able to reach this — the route itself does not exist." });
    expect(res.status).toBe(404);
  }, 20_000);
});
