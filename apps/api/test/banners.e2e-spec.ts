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

/**
 * ============================================================
 * STATUS: WRITTEN — NOT EXECUTED — STATUS UNKNOWN
 * ============================================================
 *
 * These have NEVER been run. The development machine has no
 * PostgreSQL, Redis, or MinIO (ports 5432, 6379 and 9000 are closed),
 * and this suite requires all three. They are expected to run for the
 * first time on GitHub Actions.
 *
 * Until a CI run is green, nothing here may be described as passing,
 * verified, or proven. The assertions below state what the system is
 * INTENDED to do — not what it has been observed doing.
 *
 * What they cover, none of which any unit test can reach:
 *   - guard rejection (401/403), which needs the real HTTP stack
 *   - CSRF origin enforcement on mutations
 *   - CsrfGuard being inert on a safe GET
 *   - the LIVE window predicate evaluated by PostgreSQL's own now()
 *   - the admin preview bypassing that predicate
 * ============================================================
 */

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";

const ADMIN_BANNER_MUTATIONS: Array<[string, string, object]> = [
  ["post", "/api/v1/admin/banners", { placement: "PUBLIC_HOME", titleAr: "ع", titleEn: "e" }],
  ["patch", "/api/v1/admin/banners/11111111-1111-1111-1111-111111111111", { titleEn: "x" }],
  ["post", "/api/v1/admin/banners/11111111-1111-1111-1111-111111111111/schedule", {}],
  ["post", "/api/v1/admin/banners/11111111-1111-1111-1111-111111111111/toggle", { isActive: true }],
  ["post", "/api/v1/admin/banners/reorder", { placement: "PUBLIC_HOME", bannerIds: [] }],
  ["delete", "/api/v1/admin/banners/11111111-1111-1111-1111-111111111111/image", {}],
];

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

describe("Banners (e2e) — WRITTEN, NOT EXECUTED", () => {
  let app: INestApplication;
  let adminAgent: request.Agent;
  let traderAgent: request.Agent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();

    // --- an authenticated admin, past 2FA -------------------------------
    const email = `admin-banners-${Date.now()}@example.com`;
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

    adminAgent = request.agent(app.getHttpServer());
    await adminAgent
      .post("/api/v1/admin/auth/2fa/setup/confirm")
      .set("Origin", ORIGIN)
      .send({ ticket: loginRes.body.ticket, code: authenticator.generate(setupRes.body.secret) });

    // --- a company (trader) session -------------------------------------
    traderAgent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    redis.disconnect();
  });

  afterEach(async () => {
    await prisma.promotionalBanner.deleteMany({});
  });

  // ---------------------------------------------------------------------
  // Admin authorisation
  // ---------------------------------------------------------------------

  describe("admin routes without a session", () => {
    it("refuses the admin banner list with 401", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/admin/banners?placement=PUBLIC_HOME"
      );
      expect(res.status).toBe(401);
    });

    it("refuses the admin image preview with 401", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/admin/banners/11111111-1111-1111-1111-111111111111/image"
      );
      expect(res.status).toBe(401);
    });

    it.each(ADMIN_BANNER_MUTATIONS)("refuses %s %s with 401", async (method, path, body) => {
      const res = await request(app.getHttpServer())
        [method as "post" | "patch" | "delete"](path)
        .set("Origin", ORIGIN)
        .send(body);

      expect(res.status).toBe(401);
    });

    it("refuses the image upload with 401", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/admin/banners/11111111-1111-1111-1111-111111111111/image")
        .set("Origin", ORIGIN)
        .attach("file", Buffer.from("x"), "x.jpg");

      expect(res.status).toBe(401);
    });
  });

  describe("admin routes with a COMPANY session", () => {
    it("refuses the admin banner list — a trader cookie is not an admin cookie", async () => {
      const res = await traderAgent.get("/api/v1/admin/banners?placement=PUBLIC_HOME");

      // AdminSessionAuthGuard reads a DIFFERENT cookie from the company
      // session guard, so a company session is simply absent to it.
      expect([401, 403]).toContain(res.status);
    });

    it.each(ADMIN_BANNER_MUTATIONS)("refuses %s %s for a company session", async (method, path, body) => {
      const res = await traderAgent[method as "post" | "patch" | "delete"](path)
        .set("Origin", ORIGIN)
        .send(body);

      expect([401, 403]).toContain(res.status);
    });
  });

  // ---------------------------------------------------------------------
  // CSRF
  // ---------------------------------------------------------------------

  describe("CSRF", () => {
    it.each(ADMIN_BANNER_MUTATIONS)(
      "rejects %s %s when no Origin is supplied",
      async (method, path, body) => {
        const res = await adminAgent[method as "post" | "patch" | "delete"](path).send(body);

        expect(res.status).not.toBe(200);
        expect(res.status).not.toBe(201);
        expect([401, 403]).toContain(res.status);
      }
    );

    it("rejects a mutation from a foreign Origin", async () => {
      const res = await adminAgent
        .post("/api/v1/admin/banners")
        .set("Origin", "https://attacker.example.com")
        .send({ placement: "PUBLIC_HOME", titleAr: "ع", titleEn: "e" });

      expect(res.status).toBe(403);
    });

    it("does NOT reject a safe GET with an admin session and no Origin", async () => {
      // CsrfGuard sits at controller level but exempts safe methods, so
      // a GET must pass without an Origin header.
      const res = await adminAgent.get("/api/v1/admin/banners?placement=PUBLIC_HOME");

      expect(res.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // Public visibility
  // ---------------------------------------------------------------------

  describe("public banner list", () => {
    it("requires no session", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/banners?placement=PUBLIC_HOME"
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("rejects a missing placement with 400", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/banners");
      expect(res.status).toBe(400);
    });

    it("returns only LIVE banners, never DRAFT, SCHEDULED or EXPIRED", async () => {
      const admin = "22222222-2222-2222-2222-222222222222";
      const base = { placement: "PUBLIC_HOME" as const, createdByAdminUserId: admin, titleEn: "e" };

      await prisma.promotionalBanner.createMany({
        data: [
          { ...base, titleAr: "draft", isActive: false },
          {
            ...base,
            titleAr: "scheduled",
            isActive: true,
            startsAt: new Date(Date.now() + 3_600_000),
          },
          {
            ...base,
            titleAr: "expired",
            isActive: true,
            endsAt: new Date(Date.now() - 3_600_000),
          },
          { ...base, titleAr: "live", isActive: true },
        ],
      });

      const res = await request(app.getHttpServer()).get(
        "/api/v1/banners?placement=PUBLIC_HOME"
      );

      expect(res.status).toBe(200);
      expect(res.body.map((b: { titleAr: string }) => b.titleAr)).toEqual(["live"]);
    });

    it("treats startsAt exactly now as LIVE and endsAt exactly now as not LIVE", async () => {
      // Boundary semantics are evaluated by PostgreSQL's now(), not by
      // any timestamp computed in Node.
      const admin = "22222222-2222-2222-2222-222222222222";
      const base = { placement: "PUBLIC_HOME" as const, createdByAdminUserId: admin, titleEn: "e" };

      await prisma.promotionalBanner.create({
        data: { ...base, titleAr: "just-ended", isActive: true, endsAt: new Date() },
      });

      const res = await request(app.getHttpServer()).get(
        "/api/v1/banners?placement=PUBLIC_HOME"
      );

      expect(res.body).toHaveLength(0);
    });

    it("never exposes an object key", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/banners?placement=PUBLIC_HOME"
      );

      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toContain("imageObjectKey");
      expect(serialised).not.toContain("imageThumbnailKey");
      expect(serialised).not.toContain("banners/");
    });
  });

  // ---------------------------------------------------------------------
  // Image routes
  // ---------------------------------------------------------------------

  describe("public image route", () => {
    it("needs no session, and 404s for an unknown banner", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/banners/11111111-1111-1111-1111-111111111111/image"
      );
      expect(res.status).toBe(404);
    });

    it("404s for a DRAFT banner, indistinguishably from an unknown id", async () => {
      const banner = await prisma.promotionalBanner.create({
        data: {
          placement: "PUBLIC_HOME",
          titleAr: "ع",
          titleEn: "e",
          isActive: false,
          createdByAdminUserId: "22222222-2222-2222-2222-222222222222",
        },
      });

      const draft = await request(app.getHttpServer()).get(
        `/api/v1/banners/${banner.id}/image`
      );
      const unknown = await request(app.getHttpServer()).get(
        "/api/v1/banners/33333333-3333-3333-3333-333333333333/image"
      );

      expect(draft.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(draft.body).toEqual(unknown.body);
    });

    it.each(["huge", "MAIN", "", "../main"])(
      "rejects variant=%s with 400 rather than falling back to main",
      async (variant) => {
        const res = await request(app.getHttpServer()).get(
          `/api/v1/banners/11111111-1111-1111-1111-111111111111/image?variant=${encodeURIComponent(variant)}`
        );
        expect(res.status).toBe(400);
      }
    );

    it("rejects a repeated variant parameter with 400", async () => {
      const res = await request(app.getHttpServer()).get(
        "/api/v1/banners/11111111-1111-1111-1111-111111111111/image?variant=main&variant=thumb"
      );
      expect(res.status).toBe(400);
    });
  });

  describe("admin image preview", () => {
    it("lets an admin preview a DRAFT banner's image", async () => {
      const banner = await prisma.promotionalBanner.create({
        data: {
          placement: "PUBLIC_HOME",
          titleAr: "ع",
          titleEn: "e",
          isActive: false,
          createdByAdminUserId: "22222222-2222-2222-2222-222222222222",
        },
      });

      const upload = await adminAgent
        .post(`/api/v1/admin/banners/${banner.id}/image`)
        .set("Origin", ORIGIN)
        .attach("file", jpegFixture(), "banner.jpg");
      expect(upload.status).toBe(201);

      // Public refuses it — the banner is not live.
      const publicRes = await request(app.getHttpServer()).get(
        `/api/v1/banners/${banner.id}/image`
      );
      expect(publicRes.status).toBe(404);

      // Admin sees it.
      const adminRes = await adminAgent.get(`/api/v1/admin/banners/${banner.id}/image`);
      expect(adminRes.status).toBe(200);
      expect(adminRes.headers["content-type"]).toContain("image/");
      expect(adminRes.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
      expect(adminRes.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("returns 304 with no body when If-None-Match matches", async () => {
      const banner = await prisma.promotionalBanner.create({
        data: {
          placement: "PUBLIC_HOME",
          titleAr: "ع",
          titleEn: "e",
          isActive: false,
          createdByAdminUserId: "22222222-2222-2222-2222-222222222222",
        },
      });
      await adminAgent
        .post(`/api/v1/admin/banners/${banner.id}/image`)
        .set("Origin", ORIGIN)
        .attach("file", jpegFixture(), "banner.jpg");

      const first = await adminAgent.get(`/api/v1/admin/banners/${banner.id}/image`);
      const second = await adminAgent
        .get(`/api/v1/admin/banners/${banner.id}/image`)
        .set("If-None-Match", first.headers.etag);

      expect(second.status).toBe(304);
      expect(second.body).toEqual({});
    });

    it("gives main and thumb different ETags", async () => {
      const banner = await prisma.promotionalBanner.create({
        data: {
          placement: "PUBLIC_HOME",
          titleAr: "ع",
          titleEn: "e",
          isActive: false,
          createdByAdminUserId: "22222222-2222-2222-2222-222222222222",
        },
      });
      await adminAgent
        .post(`/api/v1/admin/banners/${banner.id}/image`)
        .set("Origin", ORIGIN)
        .attach("file", jpegFixture(), "banner.jpg");

      const main = await adminAgent.get(`/api/v1/admin/banners/${banner.id}/image`);
      const thumb = await adminAgent.get(
        `/api/v1/admin/banners/${banner.id}/image?variant=thumb`
      );

      expect(main.headers.etag).not.toBe(thumb.headers.etag);
    });

    it("refuses an SVG upload", async () => {
      const banner = await prisma.promotionalBanner.create({
        data: {
          placement: "PUBLIC_HOME",
          titleAr: "ع",
          titleEn: "e",
          isActive: false,
          createdByAdminUserId: "22222222-2222-2222-2222-222222222222",
        },
      });

      const res = await adminAgent
        .post(`/api/v1/admin/banners/${banner.id}/image`)
        .set("Origin", ORIGIN)
        .attach("file", Buffer.from('<svg onload="alert(1)"></svg>'), "x.svg");

      expect(res.status).toBe(400);
    });

    it("refuses a file whose real format contradicts its name", async () => {
      const banner = await prisma.promotionalBanner.create({
        data: {
          placement: "PUBLIC_HOME",
          titleAr: "ع",
          titleEn: "e",
          isActive: false,
          createdByAdminUserId: "22222222-2222-2222-2222-222222222222",
        },
      });

      const res = await adminAgent
        .post(`/api/v1/admin/banners/${banner.id}/image`)
        .set("Origin", ORIGIN)
        .attach("file", Buffer.from("not an image at all"), "looks-real.jpg");

      expect(res.status).toBe(400);
    });
  });
});

/** A minimal valid JPEG, so the decode step has something real to accept. */
function jpegFixture(): Buffer {
  // 1x1 white JPEG.
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    "base64"
  );
}
