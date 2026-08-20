import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { SessionService } from "../src/common/security/session.service";
import { AdminSessionService } from "../src/admin/admin-auth/admin-session.service";
import { seedSettlementFixture, settlementFixturePrisma } from "./fixtures/settlement.fixture";

const prisma = settlementFixturePrisma;
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

describe("E2E — Payout hold gating & real HTTP race: openDispute vs settle (real HTTP throughout)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("a supplier company with a future payoutHoldUntil blocks settlement via HTTP", async () => {
    const fixture = await seedSettlementFixture("E2EPAYOUTHOLD");
    await prisma.company.update({ where: { id: fixture.supplierCompanyId }, data: { payoutHoldUntil: new Date(Date.now() + 86_400_000) } });
    const adminCookie = await mintAdminCookie(app);

    const settleRes = await request(app.getHttpServer())
      .post(`${API}/admin/order-allocations/${fixture.deliveredOrderAllocationId}/settle`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("payoutholdsettle"))
      .send({ externalTransferReference: "E2E-PAYOUTHOLD-REF" });
    expect(settleRes.status).toBeGreaterThanOrEqual(400);

    const allocation = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: fixture.deliveredOrderAllocationId } });
    expect(allocation.payoutSettledAt).toBeNull();
  }, 20_000);

  it("a REAL HTTP race between opening a dispute and settling the same allocation via two separate connections proves exactly one correct outcome, never asserting which side wins", async () => {
    const fixture = await seedSettlementFixture("E2ERACE", 5_000);
    const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);
    const adminCookie = await mintAdminCookie(app);

    const [disputeRes, settleRes] = await Promise.all([
      request(app.getHttpServer())
        .post(`${API}/trader/order-allocations/${fixture.deliveredOrderAllocationId}/disputes`)
        .set("Cookie", traderCookie)
        .set("Origin", ORIGIN)
        .set("Idempotency-Key", idemKey("racedispute"))
        .send({ reasonCode: "ITEM_DAMAGED", description: "Racing a real settlement attempt over HTTP." }),
      request(app.getHttpServer())
        .post(`${API}/admin/order-allocations/${fixture.deliveredOrderAllocationId}/settle`)
        .set("Cookie", adminCookie)
        .set("Origin", ORIGIN)
        .set("Idempotency-Key", idemKey("racesettle"))
        .send({ externalTransferReference: `E2E-RACE-REF-${Date.now()}` }),
    ]);

    const finalAllocation = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: fixture.deliveredOrderAllocationId } });
    const finalDispute = await prisma.dispute.findUnique({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });

    if (disputeRes.status === 201) {
      // Dispute won: it exists, and settlement must have been rejected.
      expect(finalDispute).not.toBeNull();
      expect(finalAllocation.payoutSettledAt).toBeNull();
      expect(settleRes.status).toBeGreaterThanOrEqual(400);
    } else {
      // Settlement won: payoutSettledAt is set, and the dispute attempt was rejected.
      expect(finalAllocation.payoutSettledAt).not.toBeNull();
      expect(finalDispute).toBeNull();
      expect(settleRes.status).toBe(201);
      expect(disputeRes.status).toBeGreaterThanOrEqual(400);
    }
  }, 20_000);
});
