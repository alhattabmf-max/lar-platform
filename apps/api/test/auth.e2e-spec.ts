import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { publishTestPolicy } from "./fixtures/policy.fixture";
import { ensureTestCity } from "./fixtures/city.fixture";
import { SETTINGS_KEYS } from "../src/settings/settings-keys.constants";
import { getCapturedEmails } from "./helpers/captured-emails";
import { CapturingEmailProvider } from "./helpers/capturing-email.provider";
import { EMAIL_PROVIDER } from "../src/email/email-provider.interface";

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";

async function resetThrottleCounters(): Promise<void> {
  // Every test in this suite logs in from the same IP (127.0.0.1).
  // The login rate limit (Security: 5/min) is real and deliberately
  // strict — reset it between tests so one test's login attempts
  // never spuriously rate-limit an unrelated test. The limit's actual
  // enforcement is verified directly in the security test suite.
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

function randomCr(): string {
  return `CR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getActivePolicyIds(app: INestApplication): Promise<string[]> {
  // Fetched fresh, right before use — other E2E files sharing this same
  // database each publish their own mandatory test policy, so the set
  // of "currently mandatory" policies grows over the life of a full
  // E2E run. A registration payload must accept whatever is live RIGHT
  // NOW, not a value cached once in beforeAll.
  const res = await request(app.getHttpServer())
    .get("/api/v1/policies/active")
    .set("Origin", ORIGIN);
  return res.body.map((p: { id: string }) => p.id);
}

let testCityId: string;

async function baseRegistrationPayload(
  app: INestApplication,
  overrides: Record<string, unknown> = {}
) {
  const acceptedPolicyVersionIds = await getActivePolicyIds(app);
  return {
    crNumber: randomCr(),
    legalName: "Test Trading Co",
    email: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
    password: "correct-horse-battery-staple",
    primaryMobile1: "+966500000001",
    primaryMobile2: "+966500000002",
    cityId: testCityId,
    shortAddress: "Riyadh, King Fahd Rd",
    latitude: 24.7136,
    longitude: 46.6753,
    acceptedPolicyVersionIds,
    ...overrides,
  };
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
}

async function clearSetting(key: string): Promise<void> {
  await prisma.systemSetting.deleteMany({ where: { key } });
}

async function getRawToken(emailContains: string): Promise<string> {
  const emails = getCapturedEmails();
  const match = [...emails].reverse().find((m) => m.subject.toLowerCase().includes(emailContains));
  if (!match) throw new Error(`No captured email found matching "${emailContains}"`);
  const tokenMatch = match.htmlBody.match(/([a-f0-9]{64})/);
  if (!tokenMatch) throw new Error("Could not extract token from captured email body");
  return tokenMatch[1];
}

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let policy: { id: string; code: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useClass(CapturingEmailProvider)
      .compile();
    app = await createE2eApplication(moduleRef);

    policy = await publishTestPolicy(prisma);
    testCityId = await ensureTestCity(prisma);
    await clearSetting(SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED);
    await clearSetting(SETTINGS_KEYS.COMPANY_VERIFICATION_MODE);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  beforeEach(async () => {
    await resetThrottleCounters();
  });

  describe("Registration", () => {
    it("registers a trader, atomically creating company + owner user + contact + default location + policy acceptance, VERIFIED immediately", async () => {
      const payload = await baseRegistrationPayload(app);

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader").set("Origin", ORIGIN)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ accountType: "TRADER", verificationStatus: "VERIFIED" });

      const company = await prisma.company.findUnique({ where: { crNumber: payload.crNumber } });
      expect(company).not.toBeNull();
      expect(company?.verificationStatus).toBe("VERIFIED");

      const users = await prisma.user.findMany({ where: { companyId: company!.id } });
      expect(users).toHaveLength(1);
      expect(users[0].role).toBe("OWNER");
      expect(users[0].status).toBe("ACTIVE");

      const contacts = await prisma.companyContact.findMany({ where: { companyId: company!.id } });
      expect(contacts).toHaveLength(1);

      const locations = await prisma.companyLocation.findMany({ where: { companyId: company!.id } });
      expect(locations).toHaveLength(1);
      expect(locations[0].isDefault).toBe(true);

      const acceptances = await prisma.policyAcceptance.findMany({
        where: { companyId: company!.id },
      });
      expect(acceptances).toHaveLength(payload.acceptedPolicyVersionIds.length);
      expect(acceptances.map((a) => a.policyVersionId)).toContain(policy.id);
    });

    it("registers a supplier as PENDING_VERIFICATION when verification mode is MANUAL (default)", async () => {
      const payload = await baseRegistrationPayload(app);
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/register/supplier").set("Origin", ORIGIN)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        accountType: "SUPPLIER",
        verificationStatus: "PENDING_VERIFICATION",
      });
    });

    it("auto-verifies a supplier when verification mode is AUTOMATIC (Mock provider approves)", async () => {
      await setSetting(SETTINGS_KEYS.COMPANY_VERIFICATION_MODE, "AUTOMATIC");
      try {
        const payload = await baseRegistrationPayload(app);
        const res = await request(app.getHttpServer())
          .post("/api/v1/auth/register/supplier").set("Origin", ORIGIN)
          .send(payload);

        expect(res.status).toBe(201);
        expect(res.body.verificationStatus).toBe("VERIFIED");
      } finally {
        await clearSetting(SETTINGS_KEYS.COMPANY_VERIFICATION_MODE);
      }
    });

    it("rejects registration missing a mandatory policy acceptance", async () => {
      const payload = await baseRegistrationPayload(app, { acceptedPolicyVersionIds: [] });
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader").set("Origin", ORIGIN)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects a duplicate CR number with CONFLICT", async () => {
      const payload = await baseRegistrationPayload(app);
      await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payload);

      const dupe = { ...payload, email: `dupe-${Date.now()}@example.com` };
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader").set("Origin", ORIGIN)
        .send(dupe);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CR_ALREADY_REGISTERED");
    });
  });

  describe("Email verification ON/OFF at registration", () => {
    it("WAIVES email verification when the setting is OFF (never locks the account out later)", async () => {
      await clearSetting(SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED);
      const payload = await baseRegistrationPayload(app);
      await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payload);

      const user = await prisma.user.findUnique({ where: { email: payload.email } });
      expect(user?.emailVerificationStatus).toBe("WAIVED");
    });

    it("sets PENDING and blocks login until verified when the setting is ON", async () => {
      await setSetting(SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED, true);
      try {
        const payload = await baseRegistrationPayload(app);
        await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payload);

        const user = await prisma.user.findUnique({ where: { email: payload.email } });
        expect(user?.emailVerificationStatus).toBe("PENDING");

        const loginRes = await request(app.getHttpServer())
          .post("/api/v1/auth/login").set("Origin", ORIGIN)
          .send({ crNumber: payload.crNumber, password: payload.password });

        expect(loginRes.status).toBe(403);
        expect(loginRes.body.error.code).toBe("EMAIL_VERIFICATION_REQUIRED");

        const rawToken = await getRawToken("verify your email");
        const verifyRes = await request(app.getHttpServer())
          .post("/api/v1/auth/email/verify").set("Origin", ORIGIN)
          .send({ token: rawToken });
        expect(verifyRes.status).toBe(201);

        const loginRes2 = await request(app.getHttpServer())
          .post("/api/v1/auth/login").set("Origin", ORIGIN)
          .send({ crNumber: payload.crNumber, password: payload.password });
        expect(loginRes2.status).toBe(201);
      } finally {
        await clearSetting(SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED);
      }
    });
  });

  describe("Login / Logout", () => {
    it("logs in with correct credentials and sets an HttpOnly, SameSite=Lax session cookie", async () => {
      const payload = await baseRegistrationPayload(app);
      await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payload);

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/login").set("Origin", ORIGIN)
        .send({ crNumber: payload.crNumber, password: payload.password });

      expect(res.status).toBe(201);
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toMatch(/sid=/);
      expect(cookieStr.toLowerCase()).toMatch(/httponly/);
      expect(cookieStr.toLowerCase()).toMatch(/samesite=lax/);
    });

    it("rejects a wrong password with the same error as a nonexistent CR (no enumeration)", async () => {
      const payload = await baseRegistrationPayload(app);
      await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payload);

      const wrongPassword = await request(app.getHttpServer())
        .post("/api/v1/auth/login").set("Origin", ORIGIN)
        .send({ crNumber: payload.crNumber, password: "totally-wrong" });
      const nonexistentCr = await request(app.getHttpServer())
        .post("/api/v1/auth/login").set("Origin", ORIGIN)
        .send({ crNumber: "CR-DOES-NOT-EXIST", password: "totally-wrong" });

      expect(wrongPassword.status).toBe(401);
      expect(nonexistentCr.status).toBe(401);
      expect(wrongPassword.body.error.code).toBe(nonexistentCr.body.error.code);
      expect(wrongPassword.body.error.message).toBe(nonexistentCr.body.error.message);
    });

    it("logs out and the session cookie no longer authenticates /me", async () => {
      const payload = await baseRegistrationPayload(app);
      await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payload);

      const agent = request.agent(app.getHttpServer());
      await agent
        .post("/api/v1/auth/login")
        .set("Origin", ORIGIN)
        .send({ crNumber: payload.crNumber, password: payload.password });

      const meBefore = await agent.get("/api/v1/me").set("Origin", ORIGIN);
      expect(meBefore.status).toBe(200);

      await agent.post("/api/v1/auth/logout").set("Origin", ORIGIN);

      const meAfter = await agent.get("/api/v1/me").set("Origin", ORIGIN);
      expect(meAfter.status).toBe(401);
    });
  });

  describe("Password recovery", () => {
    it("resets the password and revokes all existing sessions", async () => {
      const payload = await baseRegistrationPayload(app);
      await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payload);

      const agent = request.agent(app.getHttpServer());
      await agent
        .post("/api/v1/auth/login")
        .set("Origin", ORIGIN)
        .send({ crNumber: payload.crNumber, password: payload.password });
      expect((await agent.get("/api/v1/me").set("Origin", ORIGIN)).status).toBe(200);

      await request(app.getHttpServer())
        .post("/api/v1/auth/password/forgot").set("Origin", ORIGIN)
        .send({ email: payload.email });

      const rawToken = await getRawToken("reset your password");

      const newPassword = "brand-new-password-123";
      const resetRes = await request(app.getHttpServer())
        .post("/api/v1/auth/password/reset").set("Origin", ORIGIN)
        .send({ token: rawToken, newPassword });
      expect(resetRes.status).toBe(201);

      const meAfterReset = await agent.get("/api/v1/me").set("Origin", ORIGIN);
      expect(meAfterReset.status).toBe(401);

      const oldPasswordLogin = await request(app.getHttpServer())
        .post("/api/v1/auth/login").set("Origin", ORIGIN)
        .send({ crNumber: payload.crNumber, password: payload.password });
      expect(oldPasswordLogin.status).toBe(401);

      const newPasswordLogin = await request(app.getHttpServer())
        .post("/api/v1/auth/login").set("Origin", ORIGIN)
        .send({ crNumber: payload.crNumber, password: newPassword });
      expect(newPasswordLogin.status).toBe(201);
    });

    it("gives an identical response for forgot-password whether or not the email exists", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/password/forgot").set("Origin", ORIGIN)
        .send({ email: "no-such-user@example.com" });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: "ok" });
    });

    it("a password reset token can only be used once", async () => {
      const payload = await baseRegistrationPayload(app);
      await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payload);
      await request(app.getHttpServer())
        .post("/api/v1/auth/password/forgot").set("Origin", ORIGIN)
        .send({ email: payload.email });

      const rawToken = await getRawToken("reset your password");

      const first = await request(app.getHttpServer())
        .post("/api/v1/auth/password/reset").set("Origin", ORIGIN)
        .send({ token: rawToken, newPassword: "first-new-password-1" });
      expect(first.status).toBe(201);

      const second = await request(app.getHttpServer())
        .post("/api/v1/auth/password/reset").set("Origin", ORIGIN)
        .send({ token: rawToken, newPassword: "second-new-password-2" });
      expect(second.status).toBe(400);
    });
  });

  describe("Default location partial unique index (via HTTP)", () => {
    it("switching default location atomically unsets the previous default", async () => {
      const payload = await baseRegistrationPayload(app);
      await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payload);

      const agent = request.agent(app.getHttpServer());
      await agent
        .post("/api/v1/auth/login")
        .set("Origin", ORIGIN)
        .send({ crNumber: payload.crNumber, password: payload.password });

      const secondLocation = await agent.post("/api/v1/companies/me/locations").set("Origin", ORIGIN).send({
        name: "Branch",
        cityId: testCityId,
        shortAddress: "Jeddah",
        latitude: 21.4858,
        longitude: 39.1925,
        contactName: "Branch Contact",
        contactPhone: "+966500000003",
      });
      expect(secondLocation.status).toBe(201);
      expect(secondLocation.body.isDefault).toBe(false);

      const setDefault = await agent
        .post(`/api/v1/companies/me/locations/${secondLocation.body.id}/set-default`)
        .set("Origin", ORIGIN);
      expect(setDefault.status).toBe(201);

      const locations = await agent.get("/api/v1/companies/me/locations").set("Origin", ORIGIN);
      const defaults = locations.body.filter((l: { isDefault: boolean }) => l.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].id).toBe(secondLocation.body.id);
    });
  });

  describe("Identity uniqueness (Founder decision: no two accounts may share the same identity)", () => {
    it("a second registration with the same CR number is rejected with CR_ALREADY_REGISTERED", async () => {
      const first = await baseRegistrationPayload(app);
      const firstRes = await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader").set("Origin", ORIGIN)
        .send(first);
      expect(firstRes.status).toBe(201);

      const second = await baseRegistrationPayload(app, { crNumber: first.crNumber });
      const secondRes = await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader").set("Origin", ORIGIN)
        .send(second);

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error.code).toBe("CR_ALREADY_REGISTERED");
    });

    it("a second registration with the same email is rejected with EMAIL_ALREADY_REGISTERED", async () => {
      const first = await baseRegistrationPayload(app);
      const firstRes = await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader").set("Origin", ORIGIN)
        .send(first);
      expect(firstRes.status).toBe(201);

      const second = await baseRegistrationPayload(app, { email: first.email });
      const secondRes = await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader").set("Origin", ORIGIN)
        .send(second);

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
    });

    it("a failed duplicate-CR registration leaves no partial company/user/contact/location/acceptance rows behind", async () => {
      const first = await baseRegistrationPayload(app);
      await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(first);

      const duplicateEmail = `partial-check-${Date.now()}@example.com`;
      const second = await baseRegistrationPayload(app, {
        crNumber: first.crNumber,
        email: duplicateEmail,
      });
      const secondRes = await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader").set("Origin", ORIGIN)
        .send(second);
      expect(secondRes.status).toBe(409);

      const orphanUser = await prisma.user.findUnique({ where: { email: duplicateEmail } });
      expect(orphanUser).toBeNull();

      const companies = await prisma.company.findMany({ where: { crNumber: first.crNumber } });
      expect(companies).toHaveLength(1);
    });

    it("exactly one of two concurrent registrations with the same CR succeeds; the other is rejected safely", async () => {
      const crNumber = randomCr();
      const payloadA = await baseRegistrationPayload(app, { crNumber });
      const payloadB = await baseRegistrationPayload(app, { crNumber });

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payloadA),
        request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payloadB),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const failed = resA.status === 409 ? resA : resB;
      expect(failed.body.error.code).toBe("CR_ALREADY_REGISTERED");

      const companies = await prisma.company.findMany({ where: { crNumber } });
      expect(companies).toHaveLength(1);
    });

    it("exactly one of two concurrent registrations with the same email succeeds; the other is rejected safely", async () => {
      const email = `concurrent-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
      const payloadA = await baseRegistrationPayload(app, { email });
      const payloadB = await baseRegistrationPayload(app, { email });

      const [resA, resB] = await Promise.all([
        request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payloadA),
        request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(payloadB),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 409]);

      const failed = resA.status === 409 ? resA : resB;
      expect(failed.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");

      const users = await prisma.user.findMany({ where: { email } });
      expect(users).toHaveLength(1);
    });

    it("a DISABLED user's CR and email still block a new registration — status never releases the identity", async () => {
      const first = await baseRegistrationPayload(app);
      await request(app.getHttpServer()).post("/api/v1/auth/register/trader").set("Origin", ORIGIN).send(first);

      await prisma.user.updateMany({
        where: { email: first.email },
        data: { status: "DISABLED" },
      });

      const second = await baseRegistrationPayload(app, { crNumber: first.crNumber });
      const secondRes = await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader").set("Origin", ORIGIN)
        .send(second);
      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error.code).toBe("CR_ALREADY_REGISTERED");

      const thirdSameEmail = await baseRegistrationPayload(app, { email: first.email });
      const thirdRes = await request(app.getHttpServer())
        .post("/api/v1/auth/register/trader").set("Origin", ORIGIN)
        .send(thirdSameEmail);
      expect(thirdRes.status).toBe(409);
      expect(thirdRes.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
    });
  });
});
