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

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";

function randomEmail(): string {
  return `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

async function createAdmin(email: string, password: string) {
  const passwordHash = await hashPassword(password);
  return prisma.adminUser.create({ data: { email, passwordHash } });
}

describe("Admin Auth (e2e)", () => {
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

  describe("First-time login (2FA setup required)", () => {
    it("completes password -> setup -> confirm and reaches a working admin session", async () => {
      const email = randomEmail();
      const password = "a-genuinely-strong-passphrase-2026";
      await createAdmin(email, password);

      const loginRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .set("Origin", ORIGIN)
        .send({ email, password });
      expect(loginRes.status).toBe(201);
      expect(loginRes.body.stage).toBe("SETUP_REQUIRED");
      const { ticket } = loginRes.body;

      const setupRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/setup")
        .set("Origin", ORIGIN)
        .send({ ticket });
      expect(setupRes.status).toBe(201);
      expect(setupRes.body.secret).toBeDefined();
      expect(setupRes.body.recoveryCodes).toHaveLength(10);

      const code = authenticator.generate(setupRes.body.secret);
      const agent = request.agent(app.getHttpServer());
      const confirmRes = await agent
        .post("/api/v1/admin/auth/2fa/setup/confirm")
        .set("Origin", ORIGIN)
        .send({ ticket, code });
      expect(confirmRes.status).toBe(201);
      const setCookie = confirmRes.headers["set-cookie"];
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toMatch(/asid=/);
      expect(cookieStr.toLowerCase()).toMatch(/httponly/);

      const securityRes = await agent.get("/api/v1/admin/settings/security").set("Origin", ORIGIN);
      expect(securityRes.status).toBe(200);
      expect(securityRes.body.loginRateLimit).toBeDefined();

      const admin = await prisma.adminUser.findUnique({ where: { email } });
      expect(admin?.twoFactorEnabledAt).not.toBeNull();
      expect(admin?.twoFactorSecretEncrypted).not.toBe(setupRes.body.secret); // never stored in plaintext
    });
  });

  describe("Returning admin login (2FA verify)", () => {
    async function enrollAdmin(email: string, password: string) {
      const loginRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .set("Origin", ORIGIN)
        .send({ email, password });
      const setupRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/setup")
        .set("Origin", ORIGIN)
        .send({ ticket: loginRes.body.ticket });
      const code = authenticator.generate(setupRes.body.secret);
      await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/setup/confirm")
        .set("Origin", ORIGIN)
        .send({ ticket: loginRes.body.ticket, code });
      return { secret: setupRes.body.secret, recoveryCodes: setupRes.body.recoveryCodes as string[] };
    }

    it("logs in with password then TOTP code", async () => {
      const email = randomEmail();
      const password = "a-genuinely-strong-passphrase-2026";
      await createAdmin(email, password);
      const { secret } = await enrollAdmin(email, password);
      await resetThrottleCounters();

      const loginRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .set("Origin", ORIGIN)
        .send({ email, password });
      expect(loginRes.body.stage).toBe("VERIFY_REQUIRED");

      const code = authenticator.generate(secret);
      const verifyRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/verify")
        .set("Origin", ORIGIN)
        .send({ ticket: loginRes.body.ticket, code });
      expect(verifyRes.status).toBe(201);
      expect(verifyRes.headers["set-cookie"]).toBeDefined();
    });

    it("logs in with a recovery code, which is then consumed (single-use)", async () => {
      const email = randomEmail();
      const password = "a-genuinely-strong-passphrase-2026";
      await createAdmin(email, password);
      const { recoveryCodes } = await enrollAdmin(email, password);
      await resetThrottleCounters();

      const loginRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .set("Origin", ORIGIN)
        .send({ email, password });

      const firstUse = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/verify")
        .set("Origin", ORIGIN)
        .send({ ticket: loginRes.body.ticket, recoveryCode: recoveryCodes[0] });
      expect(firstUse.status).toBe(201);

      // Same recovery code, fresh ticket — must be rejected (consumed).
      await resetThrottleCounters();
      const loginRes2 = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .set("Origin", ORIGIN)
        .send({ email, password });
      const secondUse = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/verify")
        .set("Origin", ORIGIN)
        .send({ ticket: loginRes2.body.ticket, recoveryCode: recoveryCodes[0] });
      expect(secondUse.status).toBe(401);
    });
  });

  describe("Login ticket security", () => {
    it("rejects reuse of the same ticket after a successful 2FA verification", async () => {
      const email = randomEmail();
      const password = "a-genuinely-strong-passphrase-2026";
      await createAdmin(email, password);

      const loginRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .set("Origin", ORIGIN)
        .send({ email, password });
      const { ticket } = loginRes.body;

      const setupRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/setup")
        .set("Origin", ORIGIN)
        .send({ ticket });

      const firstConfirm = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/setup/confirm")
        .set("Origin", ORIGIN)
        .send({ ticket, code: authenticator.generate(setupRes.body.secret) });
      expect(firstConfirm.status).toBe(201);

      // Reusing the exact same ticket again must fail — it was consumed.
      const replay = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/setup/confirm")
        .set("Origin", ORIGIN)
        .send({ ticket, code: authenticator.generate(setupRes.body.secret) });
      expect(replay.status).toBe(400);
    });

    it("never exposes the raw login ticket, TOTP code, or recovery code inside Redis rate-limit key names", async () => {
      const email = randomEmail();
      const password = "a-genuinely-strong-passphrase-2026";
      await createAdmin(email, password);

      const loginRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/login")
        .set("Origin", ORIGIN)
        .send({ email, password });
      const { ticket } = loginRes.body;

      const setupRes = await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/setup")
        .set("Origin", ORIGIN)
        .send({ ticket });
      const rawSecret: string = setupRes.body.secret;
      const rawRecoveryCode: string = setupRes.body.recoveryCodes[0];
      const code = authenticator.generate(rawSecret);

      await request(app.getHttpServer())
        .post("/api/v1/admin/auth/2fa/setup/confirm")
        .set("Origin", ORIGIN)
        .send({ ticket, code });

      const throttleKeys = await redis.keys("throttle:*");
      expect(throttleKeys.length).toBeGreaterThan(0);
      for (const key of throttleKeys) {
        expect(key).not.toContain(ticket);
        expect(key).not.toContain(email);
        expect(key).not.toContain(rawSecret);
        expect(key).not.toContain(code);
        expect(key).not.toContain(rawRecoveryCode);
      }

      // Also confirm no other Redis key anywhere holds the raw ticket,
      // secret, recovery code, or password as a substring of its value.
      const allKeys = await redis.keys("*");
      for (const key of allKeys) {
        const type = await redis.type(key);
        if (type !== "string") continue;
        const value = await redis.get(key);
        if (!value) continue;
        expect(value).not.toContain(rawSecret);
        expect(value).not.toContain(rawRecoveryCode);
        expect(value).not.toContain(password);
      }
    });
  });

  describe("Rate limiting — dual key (IP + identity/ticket)", () => {
    it("blocks the login identity after exceeding the configured limit, independent of IP reuse across different emails", async () => {
      const email = randomEmail();
      await createAdmin(email, "a-genuinely-strong-passphrase-2026");

      const attempts = [];
      for (let i = 0; i < 6; i++) {
        attempts.push(
          await request(app.getHttpServer())
            .post("/api/v1/admin/auth/login")
            .set("Origin", ORIGIN)
            .send({ email, password: "wrong-password" })
        );
      }
      const statuses = attempts.map((r) => r.status);
      expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
      expect(statuses[5]).toBe(429);
    });
  });
});
