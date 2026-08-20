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

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

describe("Admin Integration Center (e2e)", () => {
  let app: INestApplication;
  let agent: request.Agent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();

    const email = `admin-integ-${Date.now()}@example.com`;
    const password = "a-genuinely-strong-passphrase-2026";
    await prisma.adminUser.create({ data: { email, passwordHash: await hashPassword(password) } });

    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("Origin", ORIGIN)
      .send({ email, password });
    const setupRes = await request(app.getHttpServer())
      .post("/api/v1/admin/auth/2fa/setup")
      .set("Origin", ORIGIN)
      .send({ ticket: loginRes.body.ticket });

    agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/admin/auth/2fa/setup/confirm")
      .set("Origin", ORIGIN)
      .send({ ticket: loginRes.body.ticket, code: authenticator.generate(setupRes.body.secret) });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  it("lists Email and Maps providers with configState set, but NEVER a fabricated HEALTHY", async () => {
    const res = await agent.get("/api/v1/admin/integrations").set("Origin", ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);

    for (const integration of res.body) {
      expect(["ENABLED", "DISABLED"]).toContain(integration.configState);
      expect(integration.healthState).not.toBe("HEALTHY");
      expect(["UNKNOWN", "NOT_CHECKED"]).toContain(integration.healthState);
    }
  });
});
