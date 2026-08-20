import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { BRANDING_PUBLIC_KEYS } from "@platform/types";
import { AppModule } from "../src/app.module";
import { createE2eApplication } from "./support/create-e2e-application";

const prisma = new PrismaClient();

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
});
