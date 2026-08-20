import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";

/**
 * ============================================================
 * STATUS: WRITTEN — NOT EXECUTED — STATUS UNKNOWN
 * ============================================================
 *
 * Never run. No PostgreSQL, Redis, or MinIO on the development machine
 * (ports 5432, 6379, 9000 closed). First execution will be on CI.
 *
 * Nothing here may be called passing or verified until a CI run is
 * green. These assertions state INTENT, not observed behaviour.
 *
 * They cover what no unit test can reach: the HTTP surface of the
 * public opportunity image route, the 400 produced by the global
 * ValidationPipe for a bad variant, real 304 negotiation, and the
 * indistinguishability of "not visible" from "does not exist".
 * ============================================================
 */

const prisma = new PrismaClient();

describe("Public opportunity image (e2e) — WRITTEN, NOT EXECUTED", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const UNKNOWN_ID = "11111111-1111-1111-1111-111111111111";

  describe("access", () => {
    it("requires no session", async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/${UNKNOWN_ID}/image`
      );

      // No session needed — the refusal is a 404, never a 401.
      expect(res.status).toBe(404);
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("404s identically for an unknown id and a non-visible opportunity", async () => {
      // A DRAFT opportunity is not publicly visible.
      const draft = await prisma.opportunity.findFirst({ where: { status: "DRAFT" } });

      const unknown = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/${UNKNOWN_ID}/image`
      );

      expect(unknown.status).toBe(404);

      if (draft) {
        const hidden = await request(app.getHttpServer()).get(
          `/api/v1/opportunities/${draft.id}/image`
        );
        expect(hidden.status).toBe(404);
        expect(hidden.body).toEqual(unknown.body);
      }
    });

    it("404s for a legacy snapshot that carries no media", async () => {
      const legacy = await prisma.opportunity.findFirst({
        where: { status: "ACTIVE", productApprovalSnapshot: { is: null } },
      });

      if (legacy) {
        const res = await request(app.getHttpServer()).get(
          `/api/v1/opportunities/${legacy.id}/image`
        );
        expect(res.status).toBe(404);
      }
    });
  });

  describe("variant validation", () => {
    it.each(["huge", "MAIN", "Thumb", "", "../main", "products/p1/x.jpg"])(
      "rejects variant=%s with 400",
      async (variant) => {
        const res = await request(app.getHttpServer()).get(
          `/api/v1/opportunities/${UNKNOWN_ID}/image?variant=${encodeURIComponent(variant)}`
        );

        // Validation runs before the lookup, so this is a 400 even for
        // an id that would otherwise 404.
        expect(res.status).toBe(400);
      }
    );

    it("rejects a repeated variant parameter with 400", async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/${UNKNOWN_ID}/image?variant=main&variant=thumb`
      );

      expect(res.status).toBe(400);
    });

    it.each(["main", "thumb"])("accepts variant=%s", async (variant) => {
      const res = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/${UNKNOWN_ID}/image?variant=${variant}`
      );

      // Valid variant, unknown id — a 404, never a 400.
      expect(res.status).toBe(404);
    });
  });

  describe("a visible opportunity with an image", () => {
    async function findServable() {
      return prisma.opportunity.findFirst({
        where: { status: "ACTIVE", productApprovalSnapshotId: { not: null } },
        select: { id: true },
      });
    }

    it("serves the image with full cache headers", async () => {
      const opportunity = await findServable();
      if (!opportunity) return;

      const res = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/${opportunity.id}/image`
      );

      if (res.status === 404) return; // snapshot carried no media
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^image\/(jpeg|png|webp)/);
      expect(res.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
      expect(res.headers["cache-control"]).toContain("max-age");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["accept-ranges"]).toBe("none");
    });

    it("returns 304 with no body when If-None-Match matches", async () => {
      const opportunity = await findServable();
      if (!opportunity) return;

      const first = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/${opportunity.id}/image`
      );
      if (first.status !== 200) return;

      const second = await request(app.getHttpServer())
        .get(`/api/v1/opportunities/${opportunity.id}/image`)
        .set("If-None-Match", first.headers.etag);

      expect(second.status).toBe(304);
      expect(second.body).toEqual({});
    });

    it("ignores If-Modified-Since when If-None-Match is present", async () => {
      const opportunity = await findServable();
      if (!opportunity) return;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/opportunities/${opportunity.id}/image`)
        .set("If-None-Match", '"definitely-stale"')
        .set("If-Modified-Since", new Date(Date.now() + 86_400_000).toUTCString());

      // The tag says modified; the date says not. RFC 9110 makes the
      // tag authoritative.
      expect([200, 404]).toContain(res.status);
      expect(res.status).not.toBe(304);
    });

    it("gives main and thumb different ETags", async () => {
      const opportunity = await findServable();
      if (!opportunity) return;

      const main = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/${opportunity.id}/image`
      );
      if (main.status !== 200) return;

      const thumb = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/${opportunity.id}/image?variant=thumb`
      );

      expect(thumb.status).toBe(200);
      expect(thumb.headers.etag).not.toBe(main.headers.etag);
    });

    it("never exposes a storage key in a header", async () => {
      const opportunity = await findServable();
      if (!opportunity) return;

      const res = await request(app.getHttpServer()).get(
        `/api/v1/opportunities/${opportunity.id}/image`
      );

      expect(JSON.stringify(res.headers)).not.toContain("products/");
    });
  });

  describe("the public listing keeps commercial terms out", () => {
    it("exposes image routes and no price or quantity", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/opportunities/active");

      expect(res.status).toBe(200);
      const serialised = JSON.stringify(res.body);

      for (const commercial of [
        "unitPriceAmount",
        "targetQuantity",
        "fundedQuantity",
        "unsoldQuantity",
        "progressPercentage",
        "shareQuantity",
        "sharePercentage",
      ]) {
        expect(serialised).not.toContain(commercial);
      }
      expect(serialised).not.toContain("objectKey");
      expect(serialised).not.toContain("products/");
    });
  });
});
