import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import Redis from "ioredis";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { seedFulfillmentFixture } from "./fixtures/fulfillment.fixture";
import { MockShippingProvider } from "../src/fulfillment/providers/mock-shipping.provider";
import { hashPassword } from "../src/common/security/argon2.util";

const prisma = checkoutFixturePrisma;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";
const PASSWORD = "correct-horse-battery-staple";
const mockShipping = new MockShippingProvider();

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

async function createAuthenticatedAdminAgent(app: INestApplication) {
  const { authenticator } = await import("otplib");
  const email = `admin-fulfx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = "a-genuinely-strong-passphrase-2026";
  await prisma.adminUser.create({ data: { email, passwordHash: await hashPassword(password) } });

  const loginRes = await request(app.getHttpServer()).post("/api/v1/admin/auth/login").set("Origin", ORIGIN).send({ email, password });
  const setupRes = await request(app.getHttpServer())
    .post("/api/v1/admin/auth/2fa/setup")
    .set("Origin", ORIGIN)
    .send({ ticket: loginRes.body.ticket });

  const agent = request.agent(app.getHttpServer());
  await agent
    .post("/api/v1/admin/auth/2fa/setup/confirm")
    .set("Origin", ORIGIN)
    .send({ ticket: loginRes.body.ticket, code: authenticator.generate(setupRes.body.secret) });

  return agent;
}

async function loginAsCompany(app: INestApplication, companyId: string, userId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(PASSWORD) } });
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ crNumber: company.crNumber, password: PASSWORD });
  if (res.status !== 201) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}

describe("Fulfillment — full HTTP cycle (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  beforeEach(async () => {
    await resetThrottleCounters();
  });

  it("supplier moves an allocation through start/ready/ship, trader confirms delivery, second allocation delivered via carrier webhook -> MasterOrder FULFILLED", async () => {
    const fixture = await seedFulfillmentFixture("HTTPFULFIL");
    let supplierUser = await prisma.user.findFirst({ where: { companyId: fixture.supplierCompanyId } });
    if (!supplierUser) {
      supplierUser = await prisma.user.create({
        data: {
          companyId: fixture.supplierCompanyId,
          email: `supplier-fulfx-${fixture.supplierCompanyId}-${Date.now()}@example.com`,
          passwordHash: "x",
          primaryMobile1: "+966500000001",
          primaryMobile2: "+966500000002",
          emailVerificationStatus: "VERIFIED",
        },
      });
    }
    const supplierAgent = await loginAsCompany(app, fixture.supplierCompanyId, supplierUser.id);
    const traderAgent = await loginAsCompany(app, fixture.traderCompanyId, fixture.traderUserId);

    const [allocA, allocB] = fixture.orderAllocationIds;

    // --- Allocation A: full supplier flow + trader HTTP confirmation ---
    let res = await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocA}/start-preparation`).set("Origin", ORIGIN).send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PREPARING");

    res = await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocA}/mark-ready`).set("Origin", ORIGIN).send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("READY_TO_SHIP");

    res = await supplierAgent
      .post(`/api/v1/supplier/order-allocations/${allocA}/ship`)
      .set("Origin", ORIGIN)
      .send({ carrierCode: "MOCK_CARRIER", trackingNumber: `HTTPTRACKA-${Date.now()}` });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("SHIPPED");

    res = await traderAgent.post(`/api/v1/trader/order-allocations/${allocA}/confirm-delivery`).set("Origin", ORIGIN).send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DELIVERED");

    let order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    expect(order.status).toBe("IN_FULFILLMENT");

    // --- Allocation B: supplier ship, then delivery via carrier webhook ---
    await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocB}/start-preparation`).set("Origin", ORIGIN).send({});
    await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocB}/mark-ready`).set("Origin", ORIGIN).send({});
    res = await supplierAgent
      .post(`/api/v1/supplier/order-allocations/${allocB}/ship`)
      .set("Origin", ORIGIN)
      .send({ carrierCode: "MOCK_CARRIER", trackingNumber: `HTTPTRACKB-${Date.now()}` });
    expect(res.status).toBe(201);

    const { rawBody, headers } = mockShipping.buildSignedWebhook({
      orderAllocationReference: allocB,
      carrierEventId: `evt-http-${allocB}`,
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    const webhookRes = await request(app.getHttpServer())
      .post("/api/v1/webhooks/shipping/MOCK_CARRIER")
      .set("Origin", ORIGIN)
      .set(Object.fromEntries(Object.entries(headers)))
      .set("Content-Type", "application/json")
      .send(rawBody.toString());
    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.processingOutcome).toBe("DELIVERED");

    order = await prisma.masterOrder.findUniqueOrThrow({ where: { id: fixture.masterOrderId } });
    expect(order.status).toBe("FULFILLED");
  }, 30_000);

  it("rejects starting preparation twice (second call 409)", async () => {
    const fixture = await seedFulfillmentFixture("HTTPDOUBLESTART");
    let supplierUser = await prisma.user.findFirst({ where: { companyId: fixture.supplierCompanyId } });
    if (!supplierUser) {
      supplierUser = await prisma.user.create({
        data: {
          companyId: fixture.supplierCompanyId,
          email: `supplier-fulfx-${fixture.supplierCompanyId}-${Date.now()}@example.com`,
          passwordHash: "x",
          primaryMobile1: "+966500000003",
          primaryMobile2: "+966500000004",
          emailVerificationStatus: "VERIFIED",
        },
      });
    }
    const supplierAgent = await loginAsCompany(app, fixture.supplierCompanyId, supplierUser.id);

    const first = await supplierAgent.post(`/api/v1/supplier/order-allocations/${fixture.orderAllocationIds[0]}/start-preparation`).set("Origin", ORIGIN).send({});
    expect(first.status).toBe(201);

    const second = await supplierAgent.post(`/api/v1/supplier/order-allocations/${fixture.orderAllocationIds[0]}/start-preparation`).set("Origin", ORIGIN).send({});
    expect(second.status).toBe(409);
  }, 20_000);

  it("admin confirms delivery over real HTTP with a reason note, requires 2FA-authenticated session, and rejects an empty reason", async () => {
    const fixture = await seedFulfillmentFixture("HTTPADMINCONF");
    let supplierUser = await prisma.user.findFirst({ where: { companyId: fixture.supplierCompanyId } });
    if (!supplierUser) {
      supplierUser = await prisma.user.create({
        data: {
          companyId: fixture.supplierCompanyId,
          email: `supplier-fulfx-${fixture.supplierCompanyId}-${Date.now()}@example.com`,
          passwordHash: "x",
          primaryMobile1: "+966500000005",
          primaryMobile2: "+966500000006",
          emailVerificationStatus: "VERIFIED",
        },
      });
    }
    const supplierAgent = await loginAsCompany(app, fixture.supplierCompanyId, supplierUser.id);
    const allocId = fixture.orderAllocationIds[0];

    await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocId}/start-preparation`).set("Origin", ORIGIN).send({});
    await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocId}/mark-ready`).set("Origin", ORIGIN).send({});
    await supplierAgent
      .post(`/api/v1/supplier/order-allocations/${allocId}/ship`)
      .set("Origin", ORIGIN)
      .send({ carrierCode: "MOCK_CARRIER", trackingNumber: `HTTPADMINTRACK-${Date.now()}` });

    // Unauthenticated request is rejected before ever reaching the handler.
    const unauth = await request(app.getHttpServer())
      .post(`/api/v1/admin/order-allocations/${allocId}/confirm-delivery`)
      .set("Origin", ORIGIN)
      .send({ reasonNote: "should not work" });
    expect(unauth.status).toBe(401);

    const adminAgent = await createAuthenticatedAdminAgent(app);

    const emptyReason = await adminAgent.post(`/api/v1/admin/order-allocations/${allocId}/confirm-delivery`).set("Origin", ORIGIN).send({ reasonNote: "" });
    expect(emptyReason.status).toBe(400);

    const res = await adminAgent
      .post(`/api/v1/admin/order-allocations/${allocId}/confirm-delivery`)
      .set("Origin", ORIGIN)
      .send({ reasonNote: "Carrier lost the package, trader confirmed receipt by phone" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DELIVERED");

    const confirmation = await prisma.deliveryConfirmation.findUniqueOrThrow({ where: { orderAllocationId: allocId } });
    expect(confirmation.confirmedBySource).toBe("ADMIN_DECISION");
  }, 30_000);

  it("there is NO delivery/confirm endpoint on the supplier controller — only start-preparation/mark-ready/ship exist", async () => {
    const fixture = await seedFulfillmentFixture("HTTPNOSUPDELIVER");
    let supplierUser = await prisma.user.findFirst({ where: { companyId: fixture.supplierCompanyId } });
    if (!supplierUser) {
      supplierUser = await prisma.user.create({
        data: {
          companyId: fixture.supplierCompanyId,
          email: `supplier-fulfx-${fixture.supplierCompanyId}-${Date.now()}@example.com`,
          passwordHash: "x",
          primaryMobile1: "+966500000007",
          primaryMobile2: "+966500000008",
          emailVerificationStatus: "VERIFIED",
        },
      });
    }
    const supplierAgent = await loginAsCompany(app, fixture.supplierCompanyId, supplierUser.id);
    const allocId = fixture.orderAllocationIds[0];

    // Neither a "confirm-delivery" nor a "deliver" route exists under
    // /supplier/order-allocations — a supplier cannot self-declare delivery.
    const confirmAttempt = await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocId}/confirm-delivery`).set("Origin", ORIGIN).send({});
    expect(confirmAttempt.status).toBe(404);

    const deliverAttempt = await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocId}/deliver`).set("Origin", ORIGIN).send({});
    expect(deliverAttempt.status).toBe(404);
  }, 20_000);

  it("a supplier from a DIFFERENT company cannot act on this allocation over HTTP (403)", async () => {
    const fixtureA = await seedFulfillmentFixture("HTTPISOA");
    const fixtureB = await seedFulfillmentFixture("HTTPISOB");
    let otherSupplierUser = await prisma.user.findFirst({ where: { companyId: fixtureB.supplierCompanyId } });
    if (!otherSupplierUser) {
      otherSupplierUser = await prisma.user.create({
        data: {
          companyId: fixtureB.supplierCompanyId,
          email: `supplier-fulfx-b-${fixtureB.supplierCompanyId}-${Date.now()}@example.com`,
          passwordHash: "x",
          primaryMobile1: "+966500000009",
          primaryMobile2: "+966500000010",
          emailVerificationStatus: "VERIFIED",
        },
      });
    }
    const otherSupplierAgent = await loginAsCompany(app, fixtureB.supplierCompanyId, otherSupplierUser.id);

    const res = await otherSupplierAgent.post(`/api/v1/supplier/order-allocations/${fixtureA.orderAllocationIds[0]}/start-preparation`).set("Origin", ORIGIN).send({});
    expect(res.status).toBe(403);
  }, 20_000);

  it("a trader from a DIFFERENT company cannot confirm delivery for this allocation over HTTP (403)", async () => {
    const fixtureA = await seedFulfillmentFixture("HTTPISOTRDA");
    const fixtureB = await seedFulfillmentFixture("HTTPISOTRDB");
    let supplierUser = await prisma.user.findFirst({ where: { companyId: fixtureA.supplierCompanyId } });
    if (!supplierUser) {
      supplierUser = await prisma.user.create({
        data: {
          companyId: fixtureA.supplierCompanyId,
          email: `supplier-fulfx-c-${fixtureA.supplierCompanyId}-${Date.now()}@example.com`,
          passwordHash: "x",
          primaryMobile1: "+966500000011",
          primaryMobile2: "+966500000012",
          emailVerificationStatus: "VERIFIED",
        },
      });
    }
    const supplierAgent = await loginAsCompany(app, fixtureA.supplierCompanyId, supplierUser.id);
    const allocId = fixtureA.orderAllocationIds[0];
    await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocId}/start-preparation`).set("Origin", ORIGIN).send({});
    await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocId}/mark-ready`).set("Origin", ORIGIN).send({});
    await supplierAgent
      .post(`/api/v1/supplier/order-allocations/${allocId}/ship`)
      .set("Origin", ORIGIN)
      .send({ carrierCode: "MOCK_CARRIER", trackingNumber: `HTTPISOTRACK-${Date.now()}` });

    const otherTraderAgent = await loginAsCompany(app, fixtureB.traderCompanyId, fixtureB.traderUserId);
    const res = await otherTraderAgent.post(`/api/v1/trader/order-allocations/${allocId}/confirm-delivery`).set("Origin", ORIGIN).send({});
    expect(res.status).toBe(403);
  }, 20_000);

  it("the shipping webhook rejects an invalid signature and an unregistered carrier over real HTTP, without requiring any session", async () => {
    const fixture = await seedFulfillmentFixture("HTTPWHSEC");
    let supplierUser = await prisma.user.findFirst({ where: { companyId: fixture.supplierCompanyId } });
    if (!supplierUser) {
      supplierUser = await prisma.user.create({
        data: {
          companyId: fixture.supplierCompanyId,
          email: `supplier-fulfx-d-${fixture.supplierCompanyId}-${Date.now()}@example.com`,
          passwordHash: "x",
          primaryMobile1: "+966500000013",
          primaryMobile2: "+966500000014",
          emailVerificationStatus: "VERIFIED",
        },
      });
    }
    const supplierAgent = await loginAsCompany(app, fixture.supplierCompanyId, supplierUser.id);
    const allocId = fixture.orderAllocationIds[0];
    await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocId}/start-preparation`).set("Origin", ORIGIN).send({});
    await supplierAgent.post(`/api/v1/supplier/order-allocations/${allocId}/mark-ready`).set("Origin", ORIGIN).send({});
    await supplierAgent
      .post(`/api/v1/supplier/order-allocations/${allocId}/ship`)
      .set("Origin", ORIGIN)
      .send({ carrierCode: "MOCK_CARRIER", trackingNumber: `HTTPWHSECTRACK-${Date.now()}` });

    const { rawBody, headers } = mockShipping.buildSignedWebhook({
      orderAllocationReference: allocId,
      carrierEventId: `evt-httpwhsec-${allocId}`,
      eventType: "DELIVERED",
      eventOccurredAt: new Date(),
    });
    const tamperedHeaders = { ...headers, "x-mock-shipping-signature": "0".repeat(64) };
    // No session/cookie is set on this request — webhooks are never gated by session auth.
    const badSig = await request(app.getHttpServer())
      .post("/api/v1/webhooks/shipping/MOCK_CARRIER")
      .set("Origin", ORIGIN)
      .set(Object.fromEntries(Object.entries(tamperedHeaders)))
      .set("Content-Type", "application/json")
      .send(rawBody.toString());
    expect(badSig.status).toBe(401);

    const unknownCarrier = await request(app.getHttpServer())
      .post("/api/v1/webhooks/shipping/SOME_UNKNOWN_CARRIER")
      .set("Origin", ORIGIN)
      .set(Object.fromEntries(Object.entries(headers)))
      .set("Content-Type", "application/json")
      .send(rawBody.toString());
    expect(unknownCarrier.status).toBe(404);
  }, 20_000);
});
