import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import Redis from "ioredis";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";

const ORIGIN = "http://localhost:3001";
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

describe("Security (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);

    const keys = await redis.keys("throttle:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    await app.close();
    redis.disconnect();
  });

  it("enforces the login rate limit centrally (Throttler + Redis) — the 6th rapid attempt is rejected with 429", async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post("/api/v1/auth/login")
        .set("Origin", ORIGIN)
        .send({ crNumber: "CR-RATE-LIMIT-TEST", password: "wrong" });

    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await attempt());
    }

    const statuses = results.map((r) => r.status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
