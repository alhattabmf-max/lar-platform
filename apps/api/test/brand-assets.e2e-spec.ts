import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { authenticator } from "otplib";
import sharp from "sharp";
import { BRAND_LOGO_LIMITS, ERROR_CODES } from "@platform/types";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import { hashPassword } from "../src/common/security/argon2.util";

/**
 * The header logo, over the real HTTP stack.
 *
 * The unit suite already pins the ordering and the refusals. What only
 * a running app can show is the part the browser actually meets:
 *
 *   - 401 with no admin session, on every route including the preview
 *   - the two-stage life — uploaded, then published — and a public
 *     route that serves ONLY the published state
 *   - "both languages or neither" refused by the server, not just by a
 *     disabled button
 *   - the delivery headers a browser needs to cache the mark, and the
 *     304 that follows from them
 *   - no storage key in any response body, on any route
 *
 * Each case uses its OWN language pair state, and the table is cleared
 * between them, so nothing here depends on the order they run in.
 */

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const ORIGIN = "http://localhost:3001";

/** The verbs these tables index by — a closed set, so no cast is needed. */
type Verb = "get" | "post" | "delete";

const AR = "ar-SA";
const EN = "en-SA";

/** A real PNG, decoded by the same processor the route uses. */
function logo(width = 480, height = 128): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 11, g: 31, b: 51, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

/**
 * A PNG that is genuinely over the byte ceiling.
 *
 * Random pixels rather than a flat colour: PNG is lossless, and a solid
 * fill compresses to a few kilobytes no matter how large the canvas, so
 * a flat image can never test a SIZE limit.
 */
async function oversizedLogo(): Promise<Buffer> {
  const side = 1200;
  const noise = Buffer.alloc(side * side * 3);
  for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) % 256;

  const buffer = await sharp(noise, { raw: { width: side, height: side, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();

  if (buffer.byteLength <= BRAND_LOGO_LIMITS.maxSizeBytes) {
    throw new Error(
      `fixture is only ${buffer.byteLength} bytes — it cannot test a ` +
        `${BRAND_LOGO_LIMITS.maxSizeBytes} byte ceiling`
    );
  }
  return buffer;
}

async function resetThrottleCounters(): Promise<void> {
  const keys = await redis.keys("throttle:*");
  if (keys.length > 0) await redis.del(...keys);
}

describe("the header logo, end to end", () => {
  let app: INestApplication;
  let admin: request.Agent;
  let png: Buffer;
  let adminId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
    await resetThrottleCounters();
    png = await logo();

    const email = `admin-logos-${Date.now()}@example.com`;
    const password = "a-genuinely-strong-passphrase-2026";
    const created = await prisma.adminUser.create({
      data: { email, passwordHash: await hashPassword(password) },
    });
    adminId = created.id;

    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/admin/auth/login")
      .set("Origin", ORIGIN)
      .send({ email, password });
    const setupRes = await request(app.getHttpServer())
      .post("/api/v1/admin/auth/2fa/setup")
      .set("Origin", ORIGIN)
      .send({ ticket: loginRes.body.ticket });

    admin = request.agent(app.getHttpServer());
    await admin
      .post("/api/v1/admin/auth/2fa/setup/confirm")
      .set("Origin", ORIGIN)
      .send({ ticket: loginRes.body.ticket, code: authenticator.generate(setupRes.body.secret) });
  });

  afterAll(async () => {
    await app.close();
    // The throwaway identity this file made, removed by the file that
    // made it. A test that leaves a working admin account behind has
    // added a credential nobody decided to create.
    await prisma.brandAsset.deleteMany({});
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } });
    await prisma.adminRecoveryCode.deleteMany({ where: { adminUserId: adminId } });
    await prisma.adminUser.delete({ where: { id: adminId } }).catch(() => undefined);
    await prisma.$disconnect();
    redis.disconnect();
  });

  afterEach(async () => {
    await prisma.brandAsset.deleteMany({});
  });

  const upload = (locale: string) =>
    admin
      .post(`/api/v1/admin/branding/logo?locale=${encodeURIComponent(locale)}`)
      .set("Origin", ORIGIN)
      .attach("file", png, { filename: "logo.png", contentType: "image/png" });

  // -------------------------------------------------------------------
  // Who may touch it
  // -------------------------------------------------------------------

  describe("without an admin session", () => {
    it.each<[Verb, string]>([
      ["get", "/api/v1/admin/branding/logo"],
      ["get", `/api/v1/admin/branding/logo/image?locale=${AR}`],
      ["post", `/api/v1/admin/branding/logo?locale=${AR}`],
      ["post", "/api/v1/admin/branding/logo/publish"],
      ["delete", "/api/v1/admin/branding/logo"],
    ])("refuses %s %s with 401", async (method, path) => {
      const res = await request(app.getHttpServer())[method](path).set("Origin", ORIGIN);

      expect(res.status).toBe(401);
    });

    it("refuses the PREVIEW too, not just the writes", async () => {
      // An unpublished logo is a brand change nobody has announced. A
      // readable preview route would leak it before it goes live.
      await upload(AR);

      const res = await request(app.getHttpServer()).get(
        `/api/v1/admin/branding/logo/image?locale=${AR}`
      );
      expect(res.status).toBe(401);
    });
  });

  describe("with a session but a foreign origin", () => {
    it.each<[Verb, string]>([
      ["post", `/api/v1/admin/branding/logo?locale=${AR}`],
      ["post", "/api/v1/admin/branding/logo/publish"],
      ["delete", "/api/v1/admin/branding/logo"],
    ])("refuses %s %s", async (method, path) => {
      const res = await admin[method](path).set("Origin", "https://evil.example.com");

      // The admin session rides in a cookie, so a mutation without an
      // origin check is forgeable by any page the operator has open.
      expect(res.status).toBe(403);
    });

    it("still allows the safe read, because CSRF is about writes", async () => {
      const res = await admin
        .get("/api/v1/admin/branding/logo")
        .set("Origin", "https://evil.example.com");

      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------
  // Uploading, and what an upload is allowed to be
  // -------------------------------------------------------------------

  describe("uploading one language", () => {
    it("stores it and reports its real dimensions", async () => {
      const res = await upload(AR);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ locale: AR, width: 480, height: 128 });
    });

    it("leaves the set incomplete and unpublished", async () => {
      await upload(AR);

      const res = await admin.get("/api/v1/admin/branding/logo").set("Origin", ORIGIN);
      expect(res.body).toMatchObject({ complete: false, published: false });
      expect(res.body.assets).toHaveLength(1);
    });

    it("names NO storage key in the admin view", async () => {
      await upload(AR);
      await upload(EN);

      const res = await admin.get("/api/v1/admin/branding/logo").set("Origin", ORIGIN);
      expect(JSON.stringify(res.body)).not.toContain("brand/logo/");
      expect(res.body.assets[0].objectKey).toBeUndefined();
      expect(res.body.assets[0].thumbnailKey).toBeUndefined();
    });

    it("refuses a file that is not an image", async () => {
      const res = await admin
        .post(`/api/v1/admin/branding/logo?locale=${AR}`)
        .set("Origin", ORIGIN)
        .attach("file", Buffer.from("this is not a picture"), {
          // A truthful-looking content type, which is exactly why the
          // server decodes the bytes instead of believing it.
          filename: "logo.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(400);
    });

    it("refuses a language it does not have", async () => {
      const res = await admin
        .post("/api/v1/admin/branding/logo?locale=fr-FR")
        .set("Origin", ORIGIN)
        .attach("file", png, { filename: "logo.png", contentType: "image/png" });

      expect(res.status).toBe(400);
    });

    it("REPLACES rather than accumulating", async () => {
      await upload(AR);
      await upload(AR);

      const rows = await prisma.brandAsset.findMany();
      expect(rows).toHaveLength(1);
    });

    it("previews an unpublished logo for an admin", async () => {
      await upload(AR);

      const res = await admin
        .get(`/api/v1/admin/branding/logo/image?locale=${AR}`)
        .set("Origin", ORIGIN);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("image/png");
    });
  });

  // -------------------------------------------------------------------
  // Publishing takes the pair
  // -------------------------------------------------------------------

  describe("publishing", () => {
    it("is refused by the SERVER while a language is missing", async () => {
      await upload(AR);

      const res = await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);

      // Not merely a disabled button: a client that posts anyway is
      // still told no.
      expect(res.status).toBe(400);
    });

    it("is refused on an empty set", async () => {
      const res = await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);
      expect(res.status).toBe(400);
    });

    it("takes both languages at once", async () => {
      await upload(AR);
      await upload(EN);

      const res = await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);
      expect(res.status).toBe(201);

      const view = await admin.get("/api/v1/admin/branding/logo").set("Origin", ORIGIN);
      expect(view.body).toMatchObject({ complete: true, published: true });
    });
  });

  // -------------------------------------------------------------------
  // What a visitor sees
  // -------------------------------------------------------------------

  describe("the public route", () => {
    it("has nothing to serve before anything is published", async () => {
      const res = await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${AR}`);
      expect(res.status).toBe(404);
    });

    it("STILL has nothing while the logo is uploaded but not published", async () => {
      await upload(AR);
      await upload(EN);

      const res = await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${AR}`);
      // This is what makes preparing a new identity safe.
      expect(res.status).toBe(404);
    });

    it("serves the image once published, with no session at all", async () => {
      await upload(AR);
      await upload(EN);
      await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);

      const res = await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${AR}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("image/png");
      expect(res.headers.etag).toBeDefined();
      expect(res.headers["cache-control"]).toBeDefined();
    });

    it("answers 304 to a browser that already has it", async () => {
      await upload(AR);
      await upload(EN);
      await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);

      const first = await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${AR}`);
      const again = await request(app.getHttpServer())
        .get(`/api/v1/branding/logo?locale=${AR}`)
        .set("If-None-Match", first.headers.etag);

      // The mark is on every page, so re-sending it on every navigation
      // is the difference between one request and hundreds.
      expect(again.status).toBe(304);
    });

    it("is READ-ONLY — no method other than GET reaches it", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/branding/logo?locale=${AR}`)
        .set("Origin", ORIGIN)
        .send({});

      expect([404, 405]).toContain(res.status);
    });

    it("hands the branding read a ROUTE, never a storage key", async () => {
      await upload(AR);
      await upload(EN);
      await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);

      const res = await request(app.getHttpServer()).get(`/api/v1/branding?locale=${AR}`);

      expect(res.body.headerLogo).toBe(`/api/v1/branding/logo?locale=${AR}`);
      expect(JSON.stringify(res.body)).not.toContain("brand/logo/");
    });

    it("does NOT fall back to the other language", async () => {
      // Published English only — which the publish route cannot produce,
      // so it is written directly to prove the READ has no fallback of
      // its own.
      await upload(EN);
      await prisma.brandAsset.updateMany({ data: { publishedAt: new Date() } });

      const branding = await request(app.getHttpServer()).get(`/api/v1/branding?locale=${AR}`);
      expect(branding.body.headerLogo).toBeNull();

      const image = await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${AR}`);
      expect(image.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // Removing it
  // -------------------------------------------------------------------

  describe("deleting", () => {
    it("removes both languages and takes the mark off the public route", async () => {
      await upload(AR);
      await upload(EN);
      await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);

      const res = await admin.delete("/api/v1/admin/branding/logo").set("Origin", ORIGIN);
      expect(res.status).toBe(200);

      expect(await prisma.brandAsset.count()).toBe(0);
      const image = await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${EN}`);
      expect(image.status).toBe(404);
    });

    it("reports 404 when there is nothing to remove", async () => {
      const res = await admin.delete("/api/v1/admin/branding/logo").set("Origin", ORIGIN);
      expect(res.status).toBe(404);
    });

    it("leaves the branding read on its blank state rather than erroring", async () => {
      await upload(AR);
      await upload(EN);
      await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);
      await admin.delete("/api/v1/admin/branding/logo").set("Origin", ORIGIN);

      const res = await request(app.getHttpServer()).get(`/api/v1/branding?locale=${AR}`);
      expect(res.status).toBe(200);
      expect(res.body.headerLogo).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // The trail it leaves
  // -------------------------------------------------------------------

  describe("the audit trail", () => {
    it("records upload, replace, publish and delete — and no storage key", async () => {
      // Every case above wrote to this table, so the rows they left are
      // cleared first. `afterAll` removes this identity's rows anyway;
      // doing it here as well is what lets the sequence below be read
      // as a sequence rather than as a tail of one.
      await prisma.auditLog.deleteMany({ where: { entityType: "brand_asset" } });

      await upload(AR);
      await upload(AR);
      await upload(EN);
      await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);
      await admin.delete("/api/v1/admin/branding/logo").set("Origin", ORIGIN);

      const entries = await prisma.auditLog.findMany({
        where: { entityType: "brand_asset" },
        orderBy: { createdAt: "asc" },
      });

      expect(entries.map((entry) => entry.action)).toEqual([
        "BRAND_LOGO_UPLOADED",
        "BRAND_LOGO_REPLACED",
        "BRAND_LOGO_UPLOADED",
        "BRAND_LOGO_PUBLISHED",
        "BRAND_LOGO_DELETED",
      ]);

      // A warning stream or an audit table carrying storage keys becomes
      // an index of them.
      expect(JSON.stringify(entries)).not.toContain("brand/logo/");
    });
  });

  // -------------------------------------------------------------------
  // Why a refusal was refused
  // -------------------------------------------------------------------

  describe("a refused upload names its cause", () => {
    /**
     * The defect this reproduces, from request
     * 1f4d4bc2-7cb5-4ce1-b2a6-1c909d323f1a and the two beside it.
     *
     * Three uploads of ordinary logo PNGs — 1,120,225 and 883,992 bytes
     * — were refused with 400 VALIDATION_FAILED and nothing else, and
     * the identity screen could only render "the submitted data is not
     * valid". Both language slots stayed empty and the operator had
     * nothing to act on.
     *
     * Two things were wrong, and each has a case here: the code was the
     * same for every cause, and the ceiling was too low for a file that
     * size to begin with.
     */
    const codeOf = (res: request.Response) => res.body?.error?.code;

    it("accepts a logo the size a designer actually exports", async () => {
      // 863KB was refused. A PNG wordmark with an alpha channel at that
      // size is unremarkable, and the stored file is re-encoded and
      // capped at 2000px regardless of what came in.
      const realistic = await logo(1400, 400);
      expect(realistic.byteLength).toBeLessThanOrEqual(BRAND_LOGO_LIMITS.maxSizeBytes);

      const res = await admin
        .post(`/api/v1/admin/branding/logo?locale=${AR}`)
        .set("Origin", ORIGIN)
        .attach("file", realistic, { filename: "logo.png", contentType: "image/png" });

      expect(res.status).toBe(201);
    });

    it("says TOO LARGE, not just invalid, when the bytes are over the ceiling", async () => {
      const res = await admin
        .post(`/api/v1/admin/branding/logo?locale=${AR}`)
        .set("Origin", ORIGIN)
        .attach("file", await oversizedLogo(), { filename: "logo.png", contentType: "image/png" });

      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe(ERROR_CODES.BRAND_LOGO_TOO_LARGE);
      // The one code that told the operator nothing.
      expect(codeOf(res)).not.toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it("says UNSUPPORTED TYPE for a format it does not take", async () => {
      // A real, valid JPEG — refused for its FORMAT, not for being
      // unreadable, which is a different fix for the operator.
      const jpeg = await sharp({
        create: { width: 480, height: 128, channels: 3, background: { r: 9, g: 9, b: 9 } },
      })
        .jpeg()
        .toBuffer();

      const res = await admin
        .post(`/api/v1/admin/branding/logo?locale=${AR}`)
        .set("Origin", ORIGIN)
        .attach("file", jpeg, { filename: "logo.jpg", contentType: "image/jpeg" });

      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe(ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED);
    });

    it("says UNSUPPORTED TYPE for bytes that are not an image at all", async () => {
      const res = await admin
        .post(`/api/v1/admin/branding/logo?locale=${AR}`)
        .set("Origin", ORIGIN)
        .attach("file", Buffer.from("this is not a picture"), {
          filename: "logo.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe(ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED);
    });

    it("says TOO SMALL for artwork under the minimum", async () => {
      const tiny = await logo(BRAND_LOGO_LIMITS.minWidth - 1, BRAND_LOGO_LIMITS.minHeight);

      const res = await admin
        .post(`/api/v1/admin/branding/logo?locale=${AR}`)
        .set("Origin", ORIGIN)
        .attach("file", tiny, { filename: "logo.png", contentType: "image/png" });

      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe(ERROR_CODES.BRAND_LOGO_TOO_SMALL);
    });

    it("gives the three causes three DIFFERENT codes", async () => {
      // The property the panel depends on: `code` is the only field the
      // web app may key a message off, so one code for several causes
      // can only ever produce one message.
      const jpeg = await sharp({
        create: { width: 480, height: 128, channels: 3, background: { r: 9, g: 9, b: 9 } },
      })
        .jpeg()
        .toBuffer();

      const attempts = [
        await oversizedLogo(),
        jpeg,
        await logo(BRAND_LOGO_LIMITS.minWidth - 1, BRAND_LOGO_LIMITS.minHeight),
      ];

      const codes = new Set<string>();
      for (const bytes of attempts) {
        const res = await admin
          .post(`/api/v1/admin/branding/logo?locale=${AR}`)
          .set("Origin", ORIGIN)
          .attach("file", bytes, { filename: "logo.png", contentType: "image/png" });
        codes.add(codeOf(res));
      }

      expect(codes.size).toBe(3);
    });

    it("leaves the slot untouched when a file is refused", async () => {
      await upload(AR);

      await admin
        .post(`/api/v1/admin/branding/logo?locale=${AR}`)
        .set("Origin", ORIGIN)
        .attach("file", await oversizedLogo(), { filename: "logo.png", contentType: "image/png" });

      // The previous logo is still the one on file: a refusal must not
      // cost an operator the artwork that was already working.
      const view = await admin.get("/api/v1/admin/branding/logo").set("Origin", ORIGIN);
      expect(view.body.assets).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------
  // The whole job, in the order an operator does it
  // -------------------------------------------------------------------

  describe("the sequence an operator actually performs", () => {
    it("uploads both, previews both, publishes, then replaces one", async () => {
      // Deliberately ONE test rather than six. Each step here depends on
      // the state the previous one left, and splitting them would let
      // the suite pass while the JOURNEY was broken — which is the only
      // thing an operator experiences.

      // 1. Both languages, uploaded separately.
      const arabic = await logo(1400, 400);
      const english = await logo(1200, 360);

      const first = await admin
        .post(`/api/v1/admin/branding/logo?locale=${AR}`)
        .set("Origin", ORIGIN)
        .attach("file", arabic, { filename: "ar.png", contentType: "image/png" });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ locale: AR, width: 1400, height: 400 });

      const second = await admin
        .post(`/api/v1/admin/branding/logo?locale=${EN}`)
        .set("Origin", ORIGIN)
        .attach("file", english, { filename: "en.png", contentType: "image/png" });
      expect(second.status).toBe(201);
      expect(second.body).toMatchObject({ locale: EN, width: 1200, height: 360 });

      // 2. The screen now shows a complete, unpublished set.
      const staged = await admin.get("/api/v1/admin/branding/logo").set("Origin", ORIGIN);
      expect(staged.body).toMatchObject({ complete: true, published: false });

      // 3. Both previews render — full size and the thumbnail the panel
      //    actually requests.
      for (const locale of [AR, EN]) {
        for (const variant of ["", "&variant=thumb"]) {
          const preview = await admin
            .get(`/api/v1/admin/branding/logo/image?locale=${locale}${variant}`)
            .set("Origin", ORIGIN);

          expect([locale, variant, preview.status]).toEqual([locale, variant, 200]);
          expect(preview.headers["content-type"]).toContain("image/png");
          expect(preview.body.byteLength).toBeGreaterThan(0);
        }
      }

      // 4. And a visitor still sees nothing, because nothing is live.
      expect((await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${AR}`)).status)
        .toBe(404);

      // 5. Publish takes the pair.
      expect(
        (await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN)).status
      ).toBe(201);

      const live: Record<string, string> = {};
      for (const locale of [AR, EN]) {
        const served = await request(app.getHttpServer()).get(
          `/api/v1/branding/logo?locale=${locale}`
        );
        expect([locale, served.status]).toEqual([locale, 200]);
        live[locale] = served.headers.etag;
      }
      // Different artwork, different bytes, different ETag — so a
      // browser caching one cannot be served the other.
      expect(live[AR]).not.toBe(live[EN]);

      // 6. Replace the Arabic mark. It goes live with the set, because
      //    the set was already published.
      const redrawn = await logo(1600, 420);
      const replaced = await admin
        .post(`/api/v1/admin/branding/logo?locale=${AR}`)
        .set("Origin", ORIGIN)
        .attach("file", redrawn, { filename: "ar-v2.png", contentType: "image/png" });
      expect(replaced.status).toBe(201);
      expect(replaced.body).toMatchObject({ width: 1600, height: 420 });

      // Still two rows — replaced, not accumulated.
      const after = await admin.get("/api/v1/admin/branding/logo").set("Origin", ORIGIN);
      expect(after.body.assets).toHaveLength(2);
      expect(after.body).toMatchObject({ complete: true, published: true });

      // New bytes on the public route, and the ENGLISH mark untouched.
      const arAfter = await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${AR}`);
      const enAfter = await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${EN}`);
      expect(arAfter.status).toBe(200);
      expect(arAfter.headers.etag).not.toBe(live[AR]);
      expect(enAfter.headers.etag).toBe(live[EN]);

      // 7. And the header's branding read points at both routes.
      for (const locale of [AR, EN]) {
        const branding = await request(app.getHttpServer()).get(
          `/api/v1/branding?locale=${locale}`
        );
        expect(branding.body.headerLogo).toBe(`/api/v1/branding/logo?locale=${locale}`);
      }
    });
  });

  // -------------------------------------------------------------------
  // The headers a browser needs before it will render the bytes
  // -------------------------------------------------------------------

  describe("the bytes are embeddable by this deployment's own pages", () => {
    /**
     * What this reproduces.
     *
     * Both logos uploaded, both published, every request answered 200 —
     * and a broken image in the header and in both admin previews. The
     * responses carried `Cross-Origin-Resource-Policy: same-origin`,
     * which is helmet's default and correct for JSON, and a browser
     * DISCARDS a subresource it fetched successfully when that header
     * says the fetching origin may not have it. The web app is served
     * from a different origin than the API on purpose, so every logo
     * request landed in that hole.
     *
     * Nothing in the request or the response body was wrong, which is
     * why the API log showed nothing but 200s.
     */
    it("serves the PUBLIC logo with a CORP header a first-party page can use", async () => {
      await upload(AR);
      await upload(EN);
      await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);

      const res = await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${AR}`);

      expect(res.status).toBe(200);
      expect(res.headers["cross-origin-resource-policy"]).toBe("same-site");
      // NOT the default. Under it the browser refuses to render this.
      expect(res.headers["cross-origin-resource-policy"]).not.toBe("same-origin");
    });

    it("serves the ADMIN preview with the same header", async () => {
      await upload(AR);

      const res = await admin
        .get(`/api/v1/admin/branding/logo/image?locale=${AR}&variant=thumb`)
        .set("Origin", ORIGIN);

      expect(res.status).toBe(200);
      expect(res.headers["cross-origin-resource-policy"]).toBe("same-site");
    });

    it("keeps the header on a 304, which is a rendered response too", async () => {
      await upload(AR);
      await upload(EN);
      await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);

      const first = await request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${AR}`);
      const again = await request(app.getHttpServer())
        .get(`/api/v1/branding/logo?locale=${AR}`)
        .set("If-None-Match", first.headers.etag);

      expect(again.status).toBe(304);
      expect(again.headers["cross-origin-resource-policy"]).toBe("same-site");
    });

    it("does NOT relax the JSON routes beside them", async () => {
      // The allowlist is anchored at both ends. One segment away from an
      // embeddable image is a JSON body no page embeds, and relaxing it
      // would let another site read it.
      const admins = await admin.get("/api/v1/admin/branding/logo").set("Origin", ORIGIN);
      const publicBranding = await request(app.getHttpServer()).get(
        `/api/v1/branding?locale=${AR}`
      );

      expect(admins.headers["cross-origin-resource-policy"]).toBe("same-origin");
      expect(publicBranding.headers["cross-origin-resource-policy"]).toBe("same-origin");
    });

    it("returns IMAGE BYTES, never JSON or HTML, on both image routes", async () => {
      await upload(AR);
      await upload(EN);
      await admin.post("/api/v1/admin/branding/logo/publish").set("Origin", ORIGIN);

      // Each request is BUILT and sent one at a time. Supertest binds an
      // ephemeral port per request, and holding two unsent Test objects
      // races that binding.
      const send = [
        () => request(app.getHttpServer()).get(`/api/v1/branding/logo?locale=${AR}`),
        () => admin.get(`/api/v1/admin/branding/logo/image?locale=${AR}`).set("Origin", ORIGIN),
      ];

      for (const start of send) {
        const res = await start();
        expect(res.headers["content-type"]).toMatch(/^image\/(png|webp)/);
        expect(res.headers["content-type"]).not.toContain("json");
        expect(res.headers["content-type"]).not.toContain("html");
        // A real PNG signature, not a body that merely claims to be one.
        expect(res.body.subarray(0, 4).toString("hex")).toBe("89504e47");
      }
    });
  });
});
