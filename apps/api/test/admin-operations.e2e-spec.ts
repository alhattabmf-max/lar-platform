import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { authenticator } from "otplib";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { hashPassword } from "../src/common/security/argon2.util";
import { publishTestPolicy } from "./fixtures/policy.fixture";
import { ensureTestCity } from "./fixtures/city.fixture";
import { uniqueMobile } from "./fixtures/unique";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

function randomEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}
function randomCr(): string {
  return `CR-OPS-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createAuthenticatedAdminAgent(app: INestApplication) {
  const email = randomEmail("admin-ops");
  const password = "a-genuinely-strong-passphrase-2026";
  const passwordHash = await hashPassword(password);
  await prisma.adminUser.create({ data: { email, passwordHash } });

  const loginRes = await request(app.getHttpServer())
    .post("/api/v1/admin/auth/login")
    .set("Origin", ORIGIN)
    .send({ email, password });
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

async function registerPendingSupplier(app: INestApplication) {
  const activeRes = await request(app.getHttpServer())
    .get("/api/v1/policies/active")
    .set("Origin", ORIGIN);
  const acceptedPolicyVersionIds = activeRes.body.map((p: { id: string }) => p.id);

  const crNumber = randomCr();
  const payload = {
    crNumber,
    legalName: "Ops Test Supplier Co",
    email: randomEmail("supplier-ops"),
    password: "correct-horse-battery-staple",
    primaryMobile1: uniqueMobile(),
    acceptedPolicyVersionIds,
  };
  await request(app.getHttpServer())
    .post("/api/v1/auth/register/supplier")
    .set("Origin", ORIGIN)
    .send(payload);
  return prisma.company.findUniqueOrThrow({ where: { crNumber } });
}

describe("Admin Operations — Pending Supplier Verification (e2e)", () => {
  let app: INestApplication;
  let agent: request.Agent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();
    agent = await createAuthenticatedAdminAgent(app);
    // Ensures at least one mandatory published policy exists — the
    // actual set accepted at registration is fetched live via
    // GET /policies/active inside registerPendingSupplier(), since
    // other E2E files sharing this database publish their own too.
    await publishTestPolicy(prisma);
    // The city is no longer part of registration, but the suite still
    // needs one to exist for the branches it creates later.
    await ensureTestCity(prisma);
    await prisma.systemSetting.deleteMany({ where: { key: "company_verification_mode" } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  it("lists a newly-registered supplier as pending", async () => {
    const company = await registerPendingSupplier(app);

    const res = await agent.get("/api/v1/admin/operations/pending-suppliers").set("Origin", ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { id: string }) => c.id)).toContain(company.id);
  });

  it("approves a pending supplier, moving it to VERIFIED and auditing the action", async () => {
    const company = await registerPendingSupplier(app);

    const res = await agent
      .post(`/api/v1/admin/operations/suppliers/${company.id}/approve`)
      .set("Origin", ORIGIN);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("VERIFIED");

    const updated = await prisma.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(updated.verificationStatus).toBe("VERIFIED");

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: company.id, action: "COMPANY_VERIFICATION_APPROVED" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorType).toBe("ADMIN");
  });

  it("rejects a pending supplier with a reason, auditing it, and no longer lists it as pending", async () => {
    const company = await registerPendingSupplier(app);

    const res = await agent
      .post(`/api/v1/admin/operations/suppliers/${company.id}/reject`)
      .set("Origin", ORIGIN)
      .send({ reason: "Commercial registration could not be verified" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("REJECTED");

    const list = await agent.get("/api/v1/admin/operations/pending-suppliers").set("Origin", ORIGIN);
    expect(list.body.map((c: { id: string }) => c.id)).not.toContain(company.id);
  });

  it("requires an admin session — an unauthenticated request is rejected", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/admin/operations/pending-suppliers")
      .set("Origin", ORIGIN);
    expect(res.status).toBe(401);
  });
});
