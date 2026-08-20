import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";

describe("GET /ready (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 with all three dependency checks when PostgreSQL is up", async () => {
    const response = await request(app.getHttpServer()).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.checks.postgres).toMatchObject({ status: "ok", blocking: true });
    expect(response.body.checks.redis.blocking).toBe(false);
    expect(response.body.checks.storage.blocking).toBe(false);
  });

  it("carries the request id on the readiness response too", async () => {
    const response = await request(app.getHttpServer())
      .get("/ready")
      .set("X-Request-ID", "ready-test-id");

    expect(response.headers["x-request-id"]).toBe("ready-test-id");
  });
});
