import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";

describe("GET /health (e2e)", () => {
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

  it("returns 200 with status ok regardless of dependency state", async () => {
    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok" });
    expect(typeof response.body.timestamp).toBe("string");
  });

  it("echoes back a caller-supplied X-Request-ID", async () => {
    const response = await request(app.getHttpServer())
      .get("/health")
      .set("X-Request-ID", "test-fixed-id-123");

    expect(response.headers["x-request-id"]).toBe("test-fixed-id-123");
  });

  it("generates an X-Request-ID when the caller does not supply one", async () => {
    const response = await request(app.getHttpServer()).get("/health");
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("returns an Error Envelope with the same X-Request-ID on a 404", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/does-not-exist")
      .set("X-Request-ID", "test-404-id");

    expect(response.status).toBe(404);
    expect(response.headers["x-request-id"]).toBe("test-404-id");
    expect(response.body).toMatchObject({
      error: { code: "NOT_FOUND" },
      requestId: "test-404-id",
    });
    expect(typeof response.body.timestamp).toBe("string");
  });
});
