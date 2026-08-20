import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import {
  BRAND_THEME_COLOR_KEYS,
  BRANDING_PUBLIC_KEYS,
  DEFAULT_BRAND_THEME,
} from "@platform/types";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";
import {
  ACTIVE_THEME_KEY,
  DRAFT_THEME_KEY,
} from "../src/branding/brand-theme.service";

const prisma = new PrismaClient();

const CUSTOM_ACTIVE_THEME = {
  primary: "#123456",
  secondary: "#0F766E",
  accent: "#F59E0B",
  accentInteractive: "#B45309",
};

/** Deliberately unreadable accent — must never reach the public surface. */
const DRAFT_ONLY_THEME = {
  primary: "#654321",
  secondary: "#0F766E",
  accent: "#1E293B",
  accentInteractive: "#B45309",
};

/**
 * `GET /api/v1/branding` is the only unauthenticated read of
 * BrandingSettings. These tests pin the two properties that matter:
 * it works with no session at all, and it exposes exactly seven keys —
 * never the admin-only or internal columns that live on the same row.
 */
describe("Public branding (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.brandingSettings.deleteMany({ where: { singletonKey: "default" } });
    await prisma.systemSetting.deleteMany({
      where: { key: { in: [ACTIVE_THEME_KEY, DRAFT_THEME_KEY] } },
    });
  });

  it("returns 200 with no session and no cookies", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/branding");

    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("falls back to an all-null contract when no branding row exists", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/branding");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...BRANDING_PUBLIC_KEYS].sort());
    expect(Object.values(res.body).every((v) => v === null)).toBe(true);
  });

  it("returns exactly the seven public keys when branding is configured", async () => {
    await prisma.brandingSettings.create({
      data: {
        singletonKey: "default",
        nameAr: "منصة فرصة",
        nameEn: "FORSA Platform",
        shortDescriptionAr: "منصة B2B",
        shortDescriptionEn: "A B2B platform",
        logoMainUrl: "https://cdn.example.com/main.png",
        logoSmallUrl: "https://cdn.example.com/small.png",
        faviconUrl: "https://cdn.example.com/favicon.ico",
      },
    });

    const res = await request(app.getHttpServer()).get("/api/v1/branding");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...BRANDING_PUBLIC_KEYS].sort());
    expect(res.body.nameAr).toBe("منصة فرصة");
    expect(res.body.nameEn).toBe("FORSA Platform");
  });

  it("never exposes admin-only, internal, or audit fields", async () => {
    await prisma.brandingSettings.create({
      data: {
        singletonKey: "default",
        nameAr: "منصة فرصة",
        nameEn: "FORSA Platform",
        invoiceLogoUrl: "https://cdn.example.com/INVOICE-ONLY.png",
        emailLogoUrl: "https://cdn.example.com/EMAIL-ONLY.png",
        headerFooterConfig: { internalNote: "ADMIN-ONLY-VALUE" },
        updatedBy: "33333333-3333-3333-3333-333333333333",
      },
    });

    const res = await request(app.getHttpServer()).get("/api/v1/branding");
    const serialised = JSON.stringify(res.body);

    for (const forbidden of [
      "id",
      "singletonKey",
      "invoiceLogoUrl",
      "emailLogoUrl",
      "headerFooterConfig",
      "updatedBy",
      "createdAt",
      "updatedAt",
    ]) {
      expect(res.body).not.toHaveProperty(forbidden);
    }

    // Value-level assertions too: a field could leak under a renamed key.
    expect(serialised).not.toContain("INVOICE-ONLY");
    expect(serialised).not.toContain("EMAIL-ONLY");
    expect(serialised).not.toContain("ADMIN-ONLY-VALUE");
    expect(serialised).not.toContain("33333333-3333-3333-3333-333333333333");
  });

  it("does not require or accept a CSRF origin for the public read", async () => {
    const withoutOrigin = await request(app.getHttpServer()).get("/api/v1/branding");
    const withForeignOrigin = await request(app.getHttpServer())
      .get("/api/v1/branding")
      .set("Origin", "https://attacker.example.com");

    expect(withoutOrigin.status).toBe(200);
    expect(withForeignOrigin.status).toBe(200);
  });

  it("rejects writes on the public route", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/branding").send({ nameEn: "x" });

    expect(res.status).toBe(404);
  });

  describe("brand theme", () => {
    it("serves the default theme when none is configured", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/branding");

      expect(res.status).toBe(200);
      expect(res.body.theme.colors).toEqual(DEFAULT_BRAND_THEME);
    });

    it("serves the ACTIVE theme once published", async () => {
      await prisma.systemSetting.create({
        data: { key: ACTIVE_THEME_KEY, value: CUSTOM_ACTIVE_THEME },
      });

      const res = await request(app.getHttpServer()).get("/api/v1/branding");

      expect(res.body.theme.colors).toEqual(CUSTOM_ACTIVE_THEME);
    });

    it("NEVER serves the draft, even when one exists", async () => {
      await prisma.systemSetting.createMany({
        data: [
          { key: ACTIVE_THEME_KEY, value: CUSTOM_ACTIVE_THEME },
          { key: DRAFT_THEME_KEY, value: DRAFT_ONLY_THEME },
        ],
      });

      const res = await request(app.getHttpServer()).get("/api/v1/branding");
      const serialised = JSON.stringify(res.body);

      expect(res.body.theme.colors).toEqual(CUSTOM_ACTIVE_THEME);
      expect(serialised).not.toContain(DRAFT_ONLY_THEME.primary);
      expect(serialised).not.toContain(DRAFT_ONLY_THEME.accent);
      expect(serialised).not.toContain("draft");
    });

    it("serves the draft-free default when only a draft exists", async () => {
      await prisma.systemSetting.create({
        data: { key: DRAFT_THEME_KEY, value: DRAFT_ONLY_THEME },
      });

      const res = await request(app.getHttpServer()).get("/api/v1/branding");

      expect(res.body.theme.colors).toEqual(DEFAULT_BRAND_THEME);
    });

    it("falls back to the defaults when the stored theme is corrupt", async () => {
      await prisma.systemSetting.create({
        data: { key: ACTIVE_THEME_KEY, value: { primary: "var(--evil)", nope: true } },
      });

      const res = await request(app.getHttpServer()).get("/api/v1/branding");

      expect(res.status).toBe(200);
      expect(res.body.theme.colors).toEqual(DEFAULT_BRAND_THEME);
      expect(JSON.stringify(res.body)).not.toContain("var(--evil)");
    });

    it("exposes only the four colour keys, with no admin or validation metadata", async () => {
      await prisma.systemSetting.create({
        data: { key: ACTIVE_THEME_KEY, value: CUSTOM_ACTIVE_THEME },
      });

      const res = await request(app.getHttpServer()).get("/api/v1/branding");

      expect(Object.keys(res.body.theme)).toEqual(["colors"]);
      expect(Object.keys(res.body.theme.colors).sort()).toEqual(
        [...BRAND_THEME_COLOR_KEYS].sort()
      );
      for (const forbidden of ["validation", "issues", "updatedBy", "updatedAt", "defaults"]) {
        expect(JSON.stringify(res.body)).not.toContain(forbidden);
      }
    });

    it("keeps the full public key set including theme", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/branding");

      expect(Object.keys(res.body).sort()).toEqual([...BRANDING_PUBLIC_KEYS].sort());
    });
  });
});

/**
 * Admin theme routes: authorisation only. The storage, validation and
 * publish semantics are covered without a database by
 * src/branding/brand-theme.service.spec.ts and
 * src/branding/brand-theme.validation.spec.ts.
 */
describe("Admin brand theme authorisation (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await createE2eApplication(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ["GET", "/api/v1/admin/branding/theme"],
    ["PUT", "/api/v1/admin/branding/theme/draft"],
    ["POST", "/api/v1/admin/branding/theme/publish"],
    ["POST", "/api/v1/admin/branding/theme/reset"],
  ])("%s %s requires an admin session", async (method, path) => {
    const res = await request(app.getHttpServer())
      [method.toLowerCase() as "get" | "put" | "post"](path)
      .set("Origin", "http://localhost:3001")
      .send({});

    expect(res.status).toBe(401);
  });

  it.each([
    ["PUT", "/api/v1/admin/branding/theme/draft"],
    ["POST", "/api/v1/admin/branding/theme/publish"],
    ["POST", "/api/v1/admin/branding/theme/reset"],
  ])("%s %s is rejected without a CSRF origin", async (method, path) => {
    const res = await request(app.getHttpServer())
      [method.toLowerCase() as "put" | "post"](path)
      .send({});

    // Either guard may fire first; both are a refusal, never a success.
    expect([401, 403]).toContain(res.status);
  });

  it("exposes no trader or supplier route to the theme", async () => {
    for (const path of [
      "/api/v1/trader/branding/theme",
      "/api/v1/supplier/branding/theme",
      "/api/v1/branding/theme",
    ]) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(404);
    }
  });
});
