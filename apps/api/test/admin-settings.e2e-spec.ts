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
import { SETTINGS_KEYS } from "../src/settings/settings-keys.constants";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

function randomEmail(): string {
  return `admin-settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function createAuthenticatedAdminAgent(app: INestApplication) {
  const email = randomEmail();
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

describe("Admin Settings Registry (e2e)", () => {
  let app: INestApplication;
  let agent: request.Agent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();
    agent = await createAuthenticatedAdminAgent(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  it("writes email_verification_enabled with a valid boolean", async () => {
    const res = await agent
      .put(`/api/v1/admin/settings/${SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED}`)
      .set("Origin", ORIGIN)
      .send({ value: true });
    expect(res.status).toBe(200);

    const row = await prisma.systemSetting.findUnique({
      where: { key: SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED },
    });
    expect(row?.value).toBe(true);
  });

  it("rejects a malformed value for email_verification_enabled (not a boolean)", async () => {
    const res = await agent
      .put(`/api/v1/admin/settings/${SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED}`)
      .set("Origin", ORIGIN)
      .send({ value: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("writes company_verification_mode with an allowed enum value", async () => {
    const res = await agent
      .put(`/api/v1/admin/settings/${SETTINGS_KEYS.COMPANY_VERIFICATION_MODE}`)
      .set("Origin", ORIGIN)
      .send({ value: "AUTOMATIC" });
    expect(res.status).toBe(200);
  });

  it("rejects an out-of-range value for company_verification_mode", async () => {
    const res = await agent
      .put(`/api/v1/admin/settings/${SETTINGS_KEYS.COMPANY_VERIFICATION_MODE}`)
      .set("Origin", ORIGIN)
      .send({ value: "DELETE_EVERYTHING" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects writes to unknown/unregistered keys (404, not silently accepted)", async () => {
    const res = await agent
      .put("/api/v1/admin/settings/some_key_nobody_registered")
      .set("Origin", ORIGIN)
      .send({ value: "anything" });
    expect(res.status).toBe(404);
  });

  it("CANNOT bypass SecuritySettingsService bounds via the generic settings endpoint", async () => {
    const attempts = [
      "admin_login_rate_limit",
      "admin_2fa_rate_limit",
      "admin_session_duration_seconds",
    ];
    for (const key of attempts) {
      const res = await agent
        .put(`/api/v1/admin/settings/${key}`)
        .set("Origin", ORIGIN)
        .send({ value: { limit: 999999, ttlSeconds: 1 } });
      expect(res.status).toBe(404);
    }

    const boundedAttempt = await agent
      .put("/api/v1/admin/settings/security/login-rate-limit")
      .set("Origin", ORIGIN)
      .send({ limit: 999999, ttlSeconds: 1 });
    expect(boundedAttempt.status).toBe(400);
  });

  it("GET /admin/settings only returns registry-known keys", async () => {
    const res = await agent.get("/api/v1/admin/settings").set("Origin", ORIGIN);
    expect(res.status).toBe(200);
    const keys = res.body.map((row: { key: string }) => row.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED,
        SETTINGS_KEYS.COMPANY_VERIFICATION_MODE,
      ])
    );
    expect(keys).not.toContain("admin_login_rate_limit");
  });
});
