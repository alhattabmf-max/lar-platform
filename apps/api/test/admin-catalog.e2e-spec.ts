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

describe("Admin Catalog Management (e2e)", () => {
  let app: INestApplication;
  let agent: request.Agent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();

    const email = `admin-catalog-${Date.now()}@example.com`;
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

  describe("Taxonomy", () => {
    it("creates a node, updates it, toggles it, and it appears in /taxonomy/active only while active", async () => {
      const create = await agent
        .post("/api/v1/admin/taxonomy")
        .set("Origin", ORIGIN)
        .send({ nameAr: "قطاع", nameEn: "Sector" });
      expect(create.status).toBe(201);
      const id = create.body.id;

      const activeBefore = await request(app.getHttpServer()).get("/api/v1/taxonomy/active");
      expect(activeBefore.body.map((n: { id: string }) => n.id)).toContain(id);

      const update = await agent
        .patch(`/api/v1/admin/taxonomy/${id}`)
        .set("Origin", ORIGIN)
        .send({ nameEn: "Sector Updated" });
      expect(update.status).toBe(200);
      expect(update.body.nameEn).toBe("Sector Updated");

      const toggle = await agent.post(`/api/v1/admin/taxonomy/${id}/toggle`).set("Origin", ORIGIN);
      expect(toggle.status).toBe(201);
      expect(toggle.body.isActive).toBe(false);

      const activeAfter = await request(app.getHttpServer()).get("/api/v1/taxonomy/active");
      expect(activeAfter.body.map((n: { id: string }) => n.id)).not.toContain(id);
    });

    it("rejects a cycle at the HTTP level: a node cannot be moved under its own descendant", async () => {
      const a = await agent
        .post("/api/v1/admin/taxonomy")
        .set("Origin", ORIGIN)
        .send({ nameAr: "a", nameEn: "a" });
      const b = await agent
        .post("/api/v1/admin/taxonomy")
        .set("Origin", ORIGIN)
        .send({ nameAr: "b", nameEn: "b", parentId: a.body.id });

      const moveResult = await agent
        .post(`/api/v1/admin/taxonomy/${a.body.id}/move`)
        .set("Origin", ORIGIN)
        .send({ newParentId: b.body.id });

      expect(moveResult.status).toBe(400);
      expect(moveResult.body.error.code).toBe("TAXONOMY_CYCLE_DETECTED");
    });

    it("rejects a node becoming its own parent at the HTTP level", async () => {
      const a = await agent
        .post("/api/v1/admin/taxonomy")
        .set("Origin", ORIGIN)
        .send({ nameAr: "self", nameEn: "self" });

      const moveResult = await agent
        .post(`/api/v1/admin/taxonomy/${a.body.id}/move`)
        .set("Origin", ORIGIN)
        .send({ newParentId: a.body.id });

      expect(moveResult.status).toBe(400);
      expect(moveResult.body.error.code).toBe("TAXONOMY_CYCLE_DETECTED");
    });

    it("requires an admin session", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/admin/taxonomy")
        .set("Origin", ORIGIN)
        .send({ nameAr: "x", nameEn: "x" });
      expect(res.status).toBe(401);
    });
  });

  describe("Sales Units", () => {
    it("creates, updates, toggles a sales unit", async () => {
      const create = await agent
        .post("/api/v1/admin/sales-units")
        .set("Origin", ORIGIN)
        .send({ nameAr: "حبة", nameEn: "Piece" });
      expect(create.status).toBe(201);

      const toggle = await agent
        .post(`/api/v1/admin/sales-units/${create.body.id}/toggle`)
        .set("Origin", ORIGIN);
      expect(toggle.status).toBe(201);
      expect(toggle.body.isActive).toBe(false);
    });
  });

  describe("Media Policy", () => {
    it("reads the default policy and updates it within bounds", async () => {
      const get = await agent.get("/api/v1/admin/settings/media-policy").set("Origin", ORIGIN);
      expect(get.status).toBe(200);
      expect(get.body.maxSizeBytes).toBeGreaterThan(0);

      const set = await agent
        .put("/api/v1/admin/settings/media-policy")
        .set("Origin", ORIGIN)
        .send({
          maxSizeBytes: 2 * 1024 * 1024,
          maxImagesPerProduct: 5,
          allowedTypes: ["image/jpeg"],
          maxPixels: 10_000_000,
        });
      expect(set.status).toBe(200);

      const getAfter = await agent.get("/api/v1/admin/settings/media-policy").set("Origin", ORIGIN);
      expect(getAfter.body.maxImagesPerProduct).toBe(5);
    });

    it("rejects a maxSizeBytes above the infrastructure hard ceiling", async () => {
      const res = await agent
        .put("/api/v1/admin/settings/media-policy")
        .set("Origin", ORIGIN)
        .send({
          maxSizeBytes: 999_999_999,
          maxImagesPerProduct: 5,
          allowedTypes: ["image/jpeg"],
          maxPixels: 10_000_000,
        });
      expect(res.status).toBe(400);
    });

    it("rejects a disallowed image type", async () => {
      const res = await agent
        .put("/api/v1/admin/settings/media-policy")
        .set("Origin", ORIGIN)
        .send({
          maxSizeBytes: 1024 * 1024,
          maxImagesPerProduct: 5,
          allowedTypes: ["image/gif"],
          maxPixels: 10_000_000,
        });
      expect(res.status).toBe(400);
    });
  });
});
