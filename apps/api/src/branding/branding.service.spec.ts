import { BRANDING_PUBLIC_KEYS, DEFAULT_BRAND_THEME, EMPTY_BRANDING_PUBLIC } from "@platform/types";
import { BrandingService } from "./branding.service";
import type { BrandThemeService } from "./brand-theme.service";
import type { PrismaService } from "../database/prisma.service";

/**
 * Runs without a database: the point of these tests is the SHAPE of what
 * leaves the service and the SHAPE of what it asks Prisma for â€” both of
 * which are the actual security boundary. The HTTP-level behaviour is
 * covered by test/branding-public.e2e-spec.ts.
 */

/**
 * The seven columns the public read is allowed to select from
 * BrandingSettings. `theme` is also part of BrandingPublic but does NOT
 * come from this table — it is resolved by BrandThemeService — so the
 * Prisma `select` must contain exactly these and never `theme`.
 */
const PUBLIC_DB_COLUMNS = [
  "nameAr",
  "nameEn",
  "shortDescriptionAr",
  "shortDescriptionEn",
  "logoMainUrl",
  "logoSmallUrl",
  "faviconUrl",
] as const;

const ADMIN_ONLY_FIELDS = [
  "invoiceLogoUrl",
  "emailLogoUrl",
  "headerFooterConfig",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "id",
  "singletonKey",
] as const;

function makePrisma(row: unknown) {
  const findUnique = jest.fn().mockResolvedValue(row);
  // The theme service is fail-safe in its own right and is unit-tested
  // separately; here it is stubbed so these cases stay about the
  // branding field allowlist and nothing else.
  const theme = {
    getActive: jest.fn().mockResolvedValue({ ...DEFAULT_BRAND_THEME }),
  } as unknown as BrandThemeService;

  return {
    prisma: { brandingSettings: { findUnique } } as unknown as PrismaService,
    theme,
    findUnique,
  };
}

function makeService(row: unknown) {
  const { prisma, theme, findUnique } = makePrisma(row);
  return { service: new BrandingService(prisma, theme), findUnique, theme };
}

describe("BrandingService.getPublic", () => {
  it("returns exactly the public contract keys, no more and no fewer", async () => {
    const { service } = makeService({
      nameAr: "ط§ط³ظ…",
      nameEn: "Name",
      shortDescriptionAr: "ظˆطµظپ",
      shortDescriptionEn: "Description",
      logoMainUrl: "https://cdn.example.com/main.png",
      logoSmallUrl: "https://cdn.example.com/small.png",
      faviconUrl: "https://cdn.example.com/fav.ico",
    });

    const result = await service.getPublic();

    expect(Object.keys(result).sort()).toEqual([...BRANDING_PUBLIC_KEYS].sort());
  });

  it("never returns an admin-only or internal field, even when Prisma hands one back", async () => {
    // Simulates the dangerous case: a future `select` change (or a raw
    // query) returning more columns than intended. The explicit mapping
    // must still drop them.
    const { service } = makeService({
      nameAr: "ط§ط³ظ…",
      nameEn: "Name",
      shortDescriptionAr: null,
      shortDescriptionEn: null,
      logoMainUrl: null,
      logoSmallUrl: null,
      faviconUrl: null,
      id: "11111111-1111-1111-1111-111111111111",
      singletonKey: "default",
      invoiceLogoUrl: "https://cdn.example.com/invoice.png",
      emailLogoUrl: "https://cdn.example.com/email.png",
      headerFooterConfig: { secret: "internal" },
      updatedBy: "22222222-2222-2222-2222-222222222222",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.getPublic();
    const serialised = JSON.stringify(result);

    for (const field of ADMIN_ONLY_FIELDS) {
      expect(result).not.toHaveProperty(field);
    }
    expect(serialised).not.toContain("invoice.png");
    expect(serialised).not.toContain("email.png");
    expect(serialised).not.toContain("internal");
    expect(serialised).not.toContain("22222222-2222-2222-2222-222222222222");
  });

  it("asks Prisma for the seven public columns only, and never for the theme", async () => {
    const { service, findUnique } = makeService(null);

    await service.getPublic();

    const args = findUnique.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(Object.keys(args.select).sort()).toEqual([...PUBLIC_DB_COLUMNS].sort());
    expect(Object.values(args.select).every((v) => v === true)).toBe(true);
    expect(args.select).not.toHaveProperty("theme");
  });

  it("falls back to null text/assets plus the default theme when no branding row exists", async () => {
    const { service } = makeService(null);

    const result = await service.getPublic();

    expect(result).toEqual(EMPTY_BRANDING_PUBLIC);
    // Every DB-backed field is null; the theme is never null, because an
    // unreadable theme would leave the interface unusable.
    for (const column of PUBLIC_DB_COLUMNS) {
      expect(result[column]).toBeNull();
    }
    expect(result.theme.colors).toEqual(DEFAULT_BRAND_THEME);
  });

  it("carries the ACTIVE theme from BrandThemeService, never a draft", async () => {
    const { service, theme } = makeService(null);

    const result = await service.getPublic();

    expect(theme.getActive).toHaveBeenCalledTimes(1);
    expect(Object.keys(result.theme)).toEqual(["colors"]);
    expect(JSON.stringify(result)).not.toContain("draft");
    expect(JSON.stringify(result)).not.toContain("validation");
  });

  it("returns a copy of the fallback, so a caller cannot mutate the shared constant", async () => {
    const { service } = makeService(null);

    const first = await service.getPublic();
    (first as { nameAr: string | null }).nameAr = "mutated";
    const second = await service.getPublic();

    expect(second.nameAr).toBeNull();
    expect(EMPTY_BRANDING_PUBLIC.nameAr).toBeNull();
  });
});
