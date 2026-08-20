import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { AdminSessionService } from "../src/admin/admin-auth/admin-session.service";
import { seedSettlementFixture, settlementFixturePrisma } from "./fixtures/settlement.fixture";

const prisma = settlementFixturePrisma;
const ORIGIN = "http://localhost:3001";
const API = "/api/v1";

async function mintAdminCookie(app: INestApplication): Promise<string> {
  const asid = await app.get(AdminSessionService).create({ adminUserId: crypto.randomUUID() }, 3600);
  return `asid=${asid}`;
}
const idemKey = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function ensurePlatformProfile(app: INestApplication, adminCookie: string, prefix: string) {
  const res = await request(app.getHttpServer())
    .post(`${API}/admin/platform-billing-profile`)
    .set("Cookie", adminCookie)
    .set("Origin", ORIGIN)
    .send({ legalName: `FORSA Platform ${prefix}`, crNumber: `CR-FORSA-${prefix}`, isVatRegistered: true, vatNumber: "300000000000003", addressSnapshot: { city: "Riyadh" } });
  expect(res.status).toBe(201);
  return res.body;
}

describe("E2E — Settlement + Invoice Drafts (real HTTP throughout, historical fixture only for initial state)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("settles a delivered allocation with a closed dispute window via HTTP, then creates NOT_A_TAX_INVOICE product & commission drafts via HTTP", async () => {
    const fixture = await seedSettlementFixture("E2ESETTLE");
    const adminCookie = await mintAdminCookie(app);
    await ensurePlatformProfile(app, adminCookie, "E2ESETTLE");

    const allocationBefore = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: fixture.deliveredOrderAllocationId } });
    expect(allocationBefore.payoutSettledAt).toBeNull();
    expect(allocationBefore.disputeWindowClosesAt!.getTime()).toBeLessThan(Date.now());

    const snapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: fixture.deliveredOrderAllocationId } });
    const expectedNet = (Number(snapshot.supplierPayableShareAmount) + Number(snapshot.shippingFeeAmount)).toFixed(2);

    const settleRes = await request(app.getHttpServer())
      .post(`${API}/admin/order-allocations/${fixture.deliveredOrderAllocationId}/settle`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("settle"))
      .send({ externalTransferReference: `E2E-SETTLE-REF-${Date.now()}` });
    expect(settleRes.status).toBe(201);
    expect(settleRes.body.outcome).toBe("EXECUTED");
    expect(settleRes.body.netAmount).toBe(Number(expectedNet));

    const allocationAfter = await prisma.orderAllocation.findUniqueOrThrow({ where: { id: fixture.deliveredOrderAllocationId } });
    expect(allocationAfter.payoutSettledAt).not.toBeNull();

    const productDraftRes = await request(app.getHttpServer())
      .post(`${API}/admin/orders/${fixture.masterOrderId}/invoice-drafts/product`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("productdraft"))
      .send({});
    expect(productDraftRes.status).toBe(201);
    expect(productDraftRes.body.documentType).toBe("INTERNAL_PRODUCT_DRAFT");
    expect(productDraftRes.body.snapshotData.documentPurpose).toBe("NOT_A_TAX_INVOICE");
    expect(productDraftRes.body.snapshotData.shipping).toBe("0.00");
    expect(productDraftRes.body.internalDocumentReference).toMatch(/^DRAFT-PROD-/);

    const allSnapshots = await prisma.orderAllocationFinancialSnapshot.findMany({ where: { orderAllocation: { masterOrderId: fixture.masterOrderId } } });
    const expectedProductTotal = allSnapshots.reduce((s, x) => s + Number(x.productAmountInclTax), 0).toFixed(2);
    expect(productDraftRes.body.snapshotData.totalInclTax).toBe(expectedProductTotal);
    expect(Number(productDraftRes.body.amount)).toBe(Number(expectedProductTotal));

    const order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    const commissionDraftRes = await request(app.getHttpServer())
      .post(`${API}/admin/orders/${fixture.masterOrderId}/invoice-drafts/commission`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("commissiondraft"))
      .send({});
    expect(commissionDraftRes.status).toBe(201);
    expect(commissionDraftRes.body.documentType).toBe("INTERNAL_COMMISSION_DRAFT");
    expect(commissionDraftRes.body.snapshotData.documentPurpose).toBe("NOT_A_TAX_INVOICE");
    const expectedCommissionTotal = (Number(order.commissionAmount) + Number(order.commissionTaxAmount)).toFixed(2);
    expect(commissionDraftRes.body.snapshotData.totalInclTax).toBe(expectedCommissionTotal);

    const listRes = await request(app.getHttpServer())
      .get(`${API}/admin/orders/${fixture.masterOrderId}/invoice-drafts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(2);
    for (const doc of listRes.body) {
      expect(doc.documentType).not.toContain("INVOICE");
      expect(JSON.stringify(doc)).not.toMatch(/iban/i);
    }
  }, 30_000);
});
