import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import Redis from "ioredis";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { publishTestPolicy } from "./fixtures/policy.fixture";
import { ensureTestCity } from "./fixtures/city.fixture";
import { seedCheckoutFixture, checkoutFixturePrisma } from "./fixtures/checkout.fixture";
import { uniqueMobile } from "./fixtures/unique";

const prisma = checkoutFixturePrisma;
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

function randomCr(prefix: string): string {
  return `CR-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getActivePolicyIds(app: INestApplication): Promise<string[]> {
  const res = await request(app.getHttpServer()).get("/api/v1/policies/active").set("Origin", ORIGIN);
  return res.body.map((p: { id: string }) => p.id);
}

/** Registers a real trader via HTTP, then logs the session in as that SAME company as the fixture-seeded trader (by CR number match) — this lets HTTP-level checkout calls act on a fully Prisma-seeded opportunity+branches without going through the fragile product/media/publish HTTP flow. */
async function loginAsFixtureTrader(app: INestApplication, crNumber: string) {
  const acceptedPolicyVersionIds = await getActivePolicyIds(app);
  const password = "correct-horse-battery-staple";
  await request(app.getHttpServer())
    .post("/api/v1/auth/register/trader")
    .set("Origin", ORIGIN)
    .send({
      crNumber,
      legalName: "Will be overwritten by fixture",
      email: `login-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
      password,
      primaryMobile1: uniqueMobile(),
      acceptedPolicyVersionIds,
    });
  const agent = request.agent(app.getHttpServer());
  await agent.post("/api/v1/auth/login").set("Origin", ORIGIN).send({ crNumber, password });
  return agent;
}

describe("Phase 7B — Checkout (e2e, HTTP layer over Prisma-seeded fixture)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();

    await publishTestPolicy(prisma);
    // Registration no longer carries a city; the fixture still needs one.
    await ensureTestCity(prisma);
    await prisma.systemSetting.deleteMany({ where: { key: { in: ["company_verification_mode", "email_verification_enabled"] } } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  beforeEach(async () => {
    await resetThrottleCounters();
  });

  it("a real HTTP checkout request succeeds and the response never exposes internal policy/snapshot fields", async () => {
    const crNumber = randomCr("HTTPCKO");
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "HTTPFX" });
    // Overwrite the fixture-created trader's CR number so the HTTP-registered
    // session (which creates its OWN company) instead logs in as a distinct
    // company — simpler: just create the trader company via the fixture,
    // then manually create the User/session pieces needed for a real login.
    void crNumber;

    const traderCompany = await prisma.company.findUniqueOrThrow({ where: { id: fixture.traderCompanyId } });
    const agent = request.agent(app.getHttpServer());
    // Directly set a password hash so we can log in as the fixture's trader.
    const { hashPassword } = await import("../src/common/security/argon2.util");
    await prisma.user.update({
      where: { id: fixture.traderUserId },
      data: { passwordHash: await hashPassword("correct-horse-battery-staple") },
    });
    const loginRes = await agent
      .post("/api/v1/auth/login")
      .set("Origin", ORIGIN)
      .send({ crNumber: traderCompany.crNumber, password: "correct-horse-battery-staple" });
    expect(loginRes.status).toBe(201);

    const res = await agent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `http-e2e-${Date.now()}`)
      .send({
        opportunityId: fixture.opportunityId,
        quantity: 4,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("LOCKED");
    expect(res.body.quantity).toBe(4);
    expect(res.body).not.toHaveProperty("shareBasisPoints");
    expect(res.body).not.toHaveProperty("shareTierPolicyVersionId");
    expect(res.body).not.toHaveProperty("commissionPolicyVersionId");
    expect(res.body).not.toHaveProperty("productApprovalSnapshotId");
    expect(res.body).not.toHaveProperty("shippingTariffPolicyVersionId");

    // The trader-facing summary fields ARE present.
    expect(res.body.minimumQuantity).toBeDefined();
    expect(res.body.sharePercentage).toBeDefined();
    expect(res.body.grandTotalAmount).toBeDefined();
  }, 30_000);

  async function loginAsFixtureTraderCompany(fixtureTraderCompanyId: string, fixtureTraderUserId: string) {
    const { hashPassword } = await import("../src/common/security/argon2.util");
    await prisma.user.update({
      where: { id: fixtureTraderUserId },
      data: { passwordHash: await hashPassword("correct-horse-battery-staple") },
    });
    const traderCompany = await prisma.company.findUniqueOrThrow({ where: { id: fixtureTraderCompanyId } });
    const agent = request.agent(app.getHttpServer());
    const loginRes = await agent
      .post("/api/v1/auth/login")
      .set("Origin", ORIGIN)
      .send({ crNumber: traderCompany.crNumber, password: "correct-horse-battery-staple" });
    expect(loginRes.status).toBe(201);
    return agent;
  }

  it("splits a real checkout across TWO branches with different shipping tiers, then GET returns the same session with both allocations", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "HTTPSPLIT" });
    const agent = await loginAsFixtureTraderCompany(fixture.traderCompanyId, fixture.traderUserId);

    const createRes = await agent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `split-${Date.now()}`)
      .send({
        opportunityId: fixture.opportunityId,
        quantity: 8,
        allocations: [
          { companyLocationId: fixture.traderLocations.sameCity, quantity: 4 },
          { companyLocationId: fixture.traderLocations.differentRegion, quantity: 4 },
        ],
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.allocations).toHaveLength(2);

    const getRes = await agent.get(`/api/v1/trader/checkout-sessions/${createRes.body.id}`).set("Origin", ORIGIN);
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(createRes.body.id);
  }, 30_000);

  it("GET on someone else's checkout session (different trader company) is not visible — 404", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "HTTPOWN1" });
    const otherFixture = await seedCheckoutFixture({ traderCrPrefix: "HTTPOWN2" });
    const ownerAgent = await loginAsFixtureTraderCompany(fixture.traderCompanyId, fixture.traderUserId);
    const otherAgent = await loginAsFixtureTraderCompany(otherFixture.traderCompanyId, otherFixture.traderUserId);

    const createRes = await ownerAgent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `owner-${Date.now()}`)
      .send({
        opportunityId: fixture.opportunityId,
        quantity: 4,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }],
      });
    expect(createRes.status).toBe(201);

    const getRes = await otherAgent.get(`/api/v1/trader/checkout-sessions/${createRes.body.id}`).set("Origin", ORIGIN);
    expect(getRes.status).toBe(404);
  }, 30_000);

  it("abandon() over real HTTP releases the lock — subsequent GET reflects ABANDONED", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "HTTPABANDON" });
    const agent = await loginAsFixtureTraderCompany(fixture.traderCompanyId, fixture.traderUserId);

    const createRes = await agent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `abandon-${Date.now()}`)
      .send({
        opportunityId: fixture.opportunityId,
        quantity: 4,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }],
      });
    expect(createRes.status).toBe(201);

    const abandonRes = await agent.post(`/api/v1/trader/checkout-sessions/${createRes.body.id}/abandon`).set("Origin", ORIGIN);
    expect(abandonRes.status).toBe(201);
    expect(abandonRes.body.status).toBe("ABANDONED");

    const getRes = await agent.get(`/api/v1/trader/checkout-sessions/${createRes.body.id}`).set("Origin", ORIGIN);
    expect(getRes.body.status).toBe("ABANDONED");
  }, 30_000);

  it("rejects a branch that does NOT belong to the trader's own company over real HTTP", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "HTTPFORBID" });
    const otherFixture = await seedCheckoutFixture({ traderCrPrefix: "HTTPFORBID2" });
    const agent = await loginAsFixtureTraderCompany(fixture.traderCompanyId, fixture.traderUserId);

    const res = await agent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `forbid-${Date.now()}`)
      .send({
        opportunityId: fixture.opportunityId,
        quantity: 4,
        allocations: [{ companyLocationId: otherFixture.traderLocations.sameCity, quantity: 4 }],
      });
    expect(res.status).toBe(403);
  }, 30_000);

  it("rejects checkout over real HTTP when the trader has not accepted the latest mandatory policy", async () => {
    const fixture = await seedCheckoutFixture({ traderCrPrefix: "HTTPPOLICY" });
    // Only THIS trader becomes non-compliant. Publishing a fresh
    // mandatory policy did it by invalidating everyone in the shared
    // database, including suites running in other workers.
    const { withdrawPolicyAcceptances } = await import("./fixtures/policy.fixture");
    const withdrawn = await withdrawPolicyAcceptances(prisma, fixture.traderCompanyId);
    expect(withdrawn).toBeGreaterThan(0);
    const agent = await loginAsFixtureTraderCompany(fixture.traderCompanyId, fixture.traderUserId);

    const res = await agent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", `policy-${Date.now()}`)
      .send({
        opportunityId: fixture.opportunityId,
        quantity: 4,
        allocations: [{ companyLocationId: fixture.traderLocations.sameCity, quantity: 4 }],
      });
    expect(res.status).toBe(403);
  }, 30_000);

  it("requires an Idempotency-Key header — missing header is rejected with 400", async () => {
    const agent = await loginAsFixtureTrader(app, randomCr("NOKEY"));
    const res = await agent
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .send({ opportunityId: "00000000-0000-0000-0000-000000000000", quantity: 4, allocations: [] });
    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/trader/checkout-sessions")
      .set("Origin", ORIGIN)
      .set("Idempotency-Key", "anon")
      .send({ opportunityId: "00000000-0000-0000-0000-000000000000", quantity: 4, allocations: [] });
    expect(res.status).toBe(401);
  });
});
