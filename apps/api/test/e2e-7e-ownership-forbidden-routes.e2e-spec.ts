import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { SessionService } from "../src/common/security/session.service";
import { seedSettlementFixture, settlementFixturePrisma } from "./fixtures/settlement.fixture";

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
const idemKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("E2E — ownership isolation & forbidden routes for suppliers (real HTTP throughout)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("a supplier from a DIFFERENT company cannot view a dispute that isn't theirs (404)", async () => {
    const fixture = await seedSettlementFixture("E2EOWNSUPP", 5_000);
    const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);
    const openRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("ownsuppopen"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "Setting up for supplier isolation testing." });
    const disputeId = openRes.body.id;

    const strangerSupplierCookie = await mintSupplierCookie(app, crypto.randomUUID(), crypto.randomUUID());
    const res = await request(app.getHttpServer()).get(`${API}/supplier/disputes/${disputeId}`).set("Cookie", strangerSupplierCookie).set("Origin", ORIGIN);
    expect(res.status).toBe(404);
  }, 20_000);

  it("a trader from a DIFFERENT company cannot see another trader's order allocation dispute detail (404)", async () => {
    const fixture = await seedSettlementFixture("E2EOWNTRADER", 5_000);
    const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);
    const openRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("owntraderopen"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "Setting up for trader isolation testing." });
    const disputeId = openRes.body.id;

    const strangerTraderCookie = await mintTraderCookie(app, crypto.randomUUID(), crypto.randomUUID());
    const res = await request(app.getHttpServer()).get(`${API}/trader/disputes/${disputeId}`).set("Cookie", strangerTraderCookie).set("Origin", ORIGIN);
    expect(res.status).toBe(404);
  }, 20_000);

  it("no supplier-facing route exists to start a refund execution attempt (404)", async () => {
    const fixture = await seedSettlementFixture("E2ENOSUPPREFUND");
    const supplierCookie = await mintSupplierCookie(app, crypto.randomUUID(), fixture.supplierCompanyId);
    const res = await request(app.getHttpServer())
      .post(`${API}/supplier/refund-obligations/${crypto.randomUUID()}/attempts`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("nosupprefund"))
      .send({ providerCode: "MOCK_REFUND" });
    expect(res.status).toBe(404);
  }, 15_000);

  it("no supplier-facing route exists to settle their own payout (404)", async () => {
    const fixture = await seedSettlementFixture("E2ENOSUPPSETTLE");
    const supplierCookie = await mintSupplierCookie(app, crypto.randomUUID(), fixture.supplierCompanyId);
    const res = await request(app.getHttpServer())
      .post(`${API}/supplier/order-allocations/${fixture.deliveredOrderAllocationId}/settle`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("nosuppsettle"))
      .send({});
    expect(res.status).toBe(404);
  }, 15_000);

  it("no supplier-facing route exists to decide their own dispute (404)", async () => {
    const fixture = await seedSettlementFixture("E2ENOSUPPDECIDE", 5_000);
    const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);
    const openRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("nosuppdecideopen"))
      .send({ reasonCode: "ITEM_DAMAGED", description: "Setting up to prove no supplier decide route exists." });
    const disputeId = openRes.body.id;

    const supplierCookie = await mintSupplierCookie(app, crypto.randomUUID(), fixture.supplierCompanyId);
    const res = await request(app.getHttpServer())
      .post(`${API}/supplier/disputes/${disputeId}/decide`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("nosuppdecide"))
      .send({ decisionType: "REJECTED", reasonNote: "A supplier should never reach a decide route." });
    expect(res.status).toBe(404);
  }, 20_000);

  it("no supplier-facing route exists to create invoice drafts (404)", async () => {
    const fixture = await seedSettlementFixture("E2ENOSUPPINVOICE");
    const supplierCookie = await mintSupplierCookie(app, crypto.randomUUID(), fixture.supplierCompanyId);
    const res = await request(app.getHttpServer())
      .post(`${API}/supplier/orders/${fixture.masterOrderId}/invoice-drafts/product`)
      .set("Cookie", supplierCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("nosuppinvoice"))
      .send({});
    expect(res.status).toBe(404);
  }, 15_000);

  it("no trader-facing route exists to execute a refund or settle a payout (404)", async () => {
    const fixture = await seedSettlementFixture("E2ENOTRADERREFUND");
    const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);
    const refundRes = await request(app.getHttpServer())
      .post(`${API}/trader/refund-obligations/${crypto.randomUUID()}/attempts`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("notraderrefund"))
      .send({ providerCode: "MOCK_REFUND" });
    expect(refundRes.status).toBe(404);

    const settleRes = await request(app.getHttpServer())
      .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/settle`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("notradersettle"))
      .send({});
    expect(settleRes.status).toBe(404);
  }, 20_000);
});
