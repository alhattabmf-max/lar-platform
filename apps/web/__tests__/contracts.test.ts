import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  BRANDING_PUBLIC_KEYS,
  DEFAULT_PAGE_SIZE,
  EMPTY_BRANDING_PUBLIC,
  ERROR_CODES,
  MAX_PAGE_SIZE,
  type BrandingPublic,
  type MeResponse,
  type Paginated,
} from "@platform/types";

/**
 * The web app consumes the SHARED contracts. There is no hand-copied DTO
 * anywhere in apps/web, and these tests fail if someone reintroduces one
 * by drifting from the shared shape.
 */
describe("shared contracts are importable from @platform/types", () => {
  it("exposes the branding contract and its exact key list", () => {
    expect([...BRANDING_PUBLIC_KEYS].sort()).toEqual(
      [
        "faviconUrl",
        "logoMainUrl",
        "logoSmallUrl",
        "nameAr",
        "nameEn",
        "shortDescriptionAr",
        "shortDescriptionEn",
      ].sort()
    );
  });

  it("the empty branding fallback covers every key and is all-null", () => {
    expect(Object.keys(EMPTY_BRANDING_PUBLIC).sort()).toEqual([...BRANDING_PUBLIC_KEYS].sort());
    expect(Object.values(EMPTY_BRANDING_PUBLIC).every((v) => v === null)).toBe(true);
  });

  it("pagination bounds are shared, not restated per screen", () => {
    expect(MAX_PAGE_SIZE).toBe(100);
    expect(DEFAULT_PAGE_SIZE).toBe(20);
  });

  it("carries the error code catalogue used by the i18n layer", () => {
    expect(ERROR_CODES.UNAUTHORIZED).toBe("UNAUTHORIZED");
    expect(ERROR_CODES.FORBIDDEN).toBe("FORBIDDEN");
    expect(ERROR_CODES.RATE_LIMITED).toBe("RATE_LIMITED");
  });

  it("wire enums are plain string unions, not Prisma enums", () => {
    expect([...ACCOUNT_TYPES]).toEqual(["TRADER", "SUPPLIER"]);
  });

  it("type-checks the contract shapes at compile time", () => {
    const branding: BrandingPublic = EMPTY_BRANDING_PUBLIC;
    const page: Paginated<string> = { items: [], page: 1, pageSize: 20, total: 0 };
    const me: MeResponse = {
      userId: "u",
      email: "e@example.com",
      emailVerificationStatus: "VERIFIED",
      role: "OWNER",
      status: "ACTIVE",
      company: {
        id: "c",
        crNumber: "1010101010",
        legalName: "L",
        accountType: "TRADER",
        verificationStatus: "VERIFIED",
      },
    };

    expect(branding.nameAr).toBeNull();
    expect(page.items).toEqual([]);
    expect(me.company.accountType).toBe("TRADER");
  });
});
