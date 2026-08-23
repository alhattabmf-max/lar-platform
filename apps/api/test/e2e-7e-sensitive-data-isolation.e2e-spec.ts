import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { SessionService } from "../src/common/security/session.service";
import { AdminSessionService } from "../src/admin/admin-auth/admin-session.service";
import { RefundProviderRegistry } from "../src/refunds/providers/refund-provider.registry";
import { MockRefundProvider } from "../src/refunds/providers/mock-refund.provider";
import { seedHistoricalDisputeRefundFixture, seedSettlementFixture, settlementFixturePrisma } from "./fixtures/settlement.fixture";

const prisma = settlementFixturePrisma;
const ORIGIN = "http://localhost:3001";
const API = "/api/v1";

const TRADER_VAT_NUMBER = "310175397500003";
const TRADER_PHONE = "+966500000099"; // fixed contact phone used by checkout.fixture.ts's traderLocations.sameCity

const FORBIDDEN_KEY_PATTERNS = [
  "iban",
  "bankaccount",
  "encrypted",
  "vatnumber",
  "taxprofilesnapshot",
  "rawbody",
  "signature",
  "payloadraw",
  "supplierbankaccountid",
];

function findForbiddenKeys(value: unknown, allowedKeys: ReadonlySet<string>, path = "$"): string[] {
  const found: string[] = [];
  if (value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((item, i) => found.push(...findForbiddenKeys(item, allowedKeys, `${path}[${i}]`)));
    return found;
  }
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    const matchedPattern = FORBIDDEN_KEY_PATTERNS.find((p) => lowerKey.includes(p));
    if (matchedPattern && !allowedKeys.has(lowerKey)) {
      found.push(`${path}.${key} (forbidden pattern "${matchedPattern}")`);
    }
    found.push(...findForbiddenKeys(val, allowedKeys, `${path}.${key}`));
  }
  return found;
}

function assertNoForbiddenKeys(label: string, body: unknown, allowedKeys: ReadonlySet<string> = new Set()) {
  const found = findForbiddenKeys(body, allowedKeys);
  if (found.length > 0) {
    throw new Error(`[${label}] forbidden key(s) found in response: ${found.join(", ")}`);
  }
}

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

async function postWebhook(app: INestApplication, provider: string, rawBody: Buffer, headers: Record<string, string>) {
  const req = request(app.getHttpServer()).post(`${API}/webhooks/refunds/${provider}`).set("Content-Type", "application/json").set(headers);
  req.write(rawBody);
  return req;
}

describe("E2E — sensitive data isolation across the full 7E surface (real HTTP for every action under test; dispute lifecycle seeded historically, window already closed)", () => {
  let app: INestApplication;
  let refundRegistry: RefundProviderRegistry;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    refundRegistry = app.get(RefundProviderRegistry);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("no dispute/settlement response exposes a forbidden key; the authorized invoice draft may show vatNumber but never bank/encrypted/rawBody/signature keys", async () => {
    // The dispute (open -> respond -> FULL_REFUND decision) is seeded
    // historically, with the dispute window ALREADY closed since
    // creation (immutable field, no sleep). Its lifecycle over real
    // HTTP is already covered by e2e-7e-main-journey and
    // dispute-http-controllers; this test's subject is field
    // isolation across every response, which is checked here via the
    // real GET endpoints each party would actually call, plus every
    // subsequent action (refund execution, settlement, invoice
    // draft) over real HTTP.
    const snapshotProbe = await seedSettlementFixture("E2ESENSITIVEPROBE");
    const probeSnapshot = await prisma.orderAllocationFinancialSnapshot.findUniqueOrThrow({ where: { orderAllocationId: snapshotProbe.deliveredOrderAllocationId } });

    const fixture = await seedHistoricalDisputeRefundFixture("E2ESENSITIVE", {
      decisionType: "FULL_REFUND",
      productRefundAmountInclTax: probeSnapshot.productAmountInclTax.toFixed(2),
      shippingRefundAmount: probeSnapshot.shippingFeeAmount.toFixed(2),
    });
    const bankAccount = await prisma.supplierBankAccount.findFirstOrThrow({ where: { companyId: fixture.supplierCompanyId } });

    const traderCookie = await mintTraderCookie(app, fixture.traderUserId, fixture.traderCompanyId);
    const setProfileRes = await request(app.getHttpServer())
      .put(`${API}/trader/settings/tax-profile`)
      .set("Cookie", traderCookie)
      .set("Origin", ORIGIN)
      .send({ isVatRegistered: true, vatNumber: TRADER_VAT_NUMBER, billingLegalName: "Sensitive Data Trader LLC" });
    expect(setProfileRes.status).toBe(200);

    const supplierUserId = crypto.randomUUID();
    const supplierCookie = await mintSupplierCookie(app, supplierUserId, fixture.supplierCompanyId);
    const adminCookie = await mintAdminCookie(app);

    const traderGetRes = await request(app.getHttpServer()).get(`${API}/trader/disputes/${fixture.disputeId}`).set("Cookie", traderCookie).set("Origin", ORIGIN);
    expect(traderGetRes.status).toBe(200);
    const supplierGetRes = await request(app.getHttpServer()).get(`${API}/supplier/disputes/${fixture.disputeId}`).set("Cookie", supplierCookie).set("Origin", ORIGIN);
    expect(supplierGetRes.status).toBe(200);
    const adminGetDisputeRes = await request(app.getHttpServer()).get(`${API}/admin/disputes/${fixture.disputeId}`).set("Cookie", adminCookie).set("Origin", ORIGIN);
    expect(adminGetDisputeRes.status).toBe(200);
    const adminListDisputesRes = await request(app.getHttpServer()).get(`${API}/admin/disputes`).set("Cookie", adminCookie).set("Origin", ORIGIN);
    expect(adminListDisputesRes.status).toBe(200);

    for (const [label, res] of [
      ["trader-get-dispute", traderGetRes],
      ["supplier-get-dispute", supplierGetRes],
      ["admin-get-dispute", adminGetDisputeRes],
      ["admin-list-disputes", adminListDisputesRes],
    ] as const) {
      assertNoForbiddenKeys(label, res.body);
    }

    const refundObligation = await prisma.refundObligation.findUniqueOrThrow({ where: { id: fixture.refundObligationId } });
    const startAttemptRes = await request(app.getHttpServer())
      .post(`${API}/admin/refund-obligations/${refundObligation.id}/attempts`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("sensrefundattempt"))
      .send({ providerCode: "MOCK_REFUND" });
    assertNoForbiddenKeys("admin-start-refund-attempt", startAttemptRes.body);

    const provider = refundRegistry.get("MOCK_REFUND") as MockRefundProvider;
    const webhook = provider.buildSignedWebhook({
      merchantReference: startAttemptRes.body.refundAttemptId,
      providerReference: startAttemptRes.body.providerReference,
      providerEventId: `evt-sens-${startAttemptRes.body.refundAttemptId}`,
      eventType: "SUCCESS",
      amount: Number(refundObligation.amount),
    });
    const refundWebhookRes = await postWebhook(app, "MOCK_REFUND", webhook.rawBody, webhook.headers);
    expect(refundWebhookRes.status).toBe(200);
    assertNoForbiddenKeys("refund-webhook-response", refundWebhookRes.body);

    // The dispute window was ALREADY closed at seed time — settlement proceeds immediately, no wait.
    const settleRes = await request(app.getHttpServer())
      .post(`${API}/admin/order-allocations/${fixture.deliveredOrderAllocationId}/settle`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("senssettle"))
      .send({});
    assertNoForbiddenKeys("admin-settle", settleRes.body);

    const draftRes = await request(app.getHttpServer())
      .post(`${API}/admin/orders/${fixture.masterOrderId}/invoice-drafts/product`)
      .set("Cookie", adminCookie)
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", idemKey("sensdraft"))
      .send({});
    assertNoForbiddenKeys("admin-product-draft", draftRes.body, new Set(["vatnumber"]));
    expect(draftRes.body.snapshotData.documentPurpose).toBe("NOT_A_TAX_INVOICE");

    const rawBodyString = webhook.rawBody.toString();
    const signatureValue = webhook.headers["x-mock-refund-signature"];

    const relevantAudits = await prisma.auditLog.findMany({
      where: { entityType: { in: ["dispute", "invoice_document", "refund_attempt", "refund_obligation", "supplier_payout"] } },
    });
    for (const entry of relevantAudits) {
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toContain(TRADER_VAT_NUMBER);
      expect(serialized).not.toContain(TRADER_PHONE);
      expect(serialized).not.toContain(rawBodyString);
      expect(serialized).not.toContain(signatureValue);
      expect(serialized).not.toContain(bankAccount.ibanFingerprint);
      expect(serialized).not.toMatch(/iban/i);
    }

    const relevantOutbox = await prisma.outboxEvent.findMany();
    for (const evt of relevantOutbox) {
      const serialized = JSON.stringify(evt);
      expect(serialized).not.toContain(TRADER_VAT_NUMBER);
      expect(serialized).not.toContain(TRADER_PHONE);
      expect(serialized).not.toContain(rawBodyString);
      expect(serialized).not.toContain(signatureValue);
      expect(serialized).not.toContain(bankAccount.ibanFingerprint);
      expect(serialized).not.toMatch(/iban/i);
    }
  }, 30_000);
});
