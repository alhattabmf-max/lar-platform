import { BRANDING_PUBLIC_KEYS, EMPTY_BRANDING_PUBLIC } from "@platform/types";
import { BrandingService } from "./branding.service";
import type { PrismaService } from "../database/prisma.service";

/**
 * Runs without a database: the point of these tests is the SHAPE of what
 * leaves the service and the SHAPE of what it asks Prisma for — both of
 * which are the actual security boundary. The HTTP-level behaviour is
 * covered by test/branding-public.e2e-spec.ts.
 */

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
  return {
    prisma: { brandingSettings: { findUnique } } as unknown as PrismaService,
    findUnique,
  };
}

describe("BrandingService.getPublic", () => {
  it("returns exactly the seven public keys — no more, no fewer", async () => {
    const { prisma } = makePrisma({
      nameAr: "اسم",
      nameEn: "Name",
      shortDescriptionAr: "وصف",
      shortDescriptionEn: "Description",
      logoMainUrl: "https://cdn.example.com/main.png",
      logoSmallUrl: "https://cdn.example.com/small.png",
      faviconUrl: "https://cdn.example.com/fav.ico",
    });

    const result = await new BrandingService(prisma).getPublic();

    expect(Object.keys(result).sort()).toEqual([...BRANDING_PUBLIC_KEYS].sort());
  });

  it("never returns an admin-only or internal field, even when Prisma hands one back", async () => {
    // Simulates the dangerous case: a future `select` change (or a raw
    // query) returning more columns than intended. The explicit mapping
    // must still drop them.
    const { prisma } = makePrisma({
      nameAr: "اسم",
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

    const result = await new BrandingService(prisma).getPublic();
    const serialised = JSON.stringify(result);

    for (const field of ADMIN_ONLY_FIELDS) {
      expect(result).not.toHaveProperty(field);
    }
    expect(serialised).not.toContain("invoice.png");
    expect(serialised).not.toContain("email.png");
    expect(serialised).not.toContain("internal");
    expect(serialised).not.toContain("22222222-2222-2222-2222-222222222222");
  });

  it("asks Prisma for the seven public columns only", async () => {
    const { prisma, findUnique } = makePrisma(null);

    await new BrandingService(prisma).getPublic();

    const args = findUnique.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(Object.keys(args.select).sort()).toEqual([...BRANDING_PUBLIC_KEYS].sort());
    expect(Object.values(args.select).every((v) => v === true)).toBe(true);
  });

  it("falls back to an all-null contract when no branding row exists", async () => {
    const { prisma } = makePrisma(null);

    const result = await new BrandingService(prisma).getPublic();

    expect(result).toEqual(EMPTY_BRANDING_PUBLIC);
    expect(Object.values(result).every((v) => v === null)).toBe(true);
  });

  it("returns a copy of the fallback, so a caller cannot mutate the shared constant", async () => {
    const { prisma } = makePrisma(null);
    const service = new BrandingService(prisma);

    const first = await service.getPublic();
    (first as { nameAr: string | null }).nameAr = "mutated";
    const second = await service.getPublic();

    expect(second.nameAr).toBeNull();
    expect(EMPTY_BRANDING_PUBLIC.nameAr).toBeNull();
  });
});
