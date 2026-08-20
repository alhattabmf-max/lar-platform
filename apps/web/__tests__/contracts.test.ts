import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  DEFAULT_BRAND_THEME,
  BRANDING_PUBLIC_KEYS,
  DEFAULT_PAGE_SIZE,
  EMPTY_BRANDING_PUBLIC,
  ERROR_CODES,
  MAX_PAGE_SIZE,
  CITY_ITEM_KEYS,
  DEFAULT_OPPORTUNITY_SORT,
  OPPORTUNITY_SORTS,
  PUBLIC_OPPORTUNITY_DETAIL_KEYS,
  PUBLIC_OPPORTUNITY_ITEM_KEYS,
  PUBLIC_OPPORTUNITY_STATUSES,
  PUBLIC_POLICY_VERSION_KEYS,
  TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS,
  TAXONOMY_FILTER_INCLUDES_DESCENDANTS,
  TAXONOMY_NODE_ITEM_KEYS,
  type BrandingPublic,
  type MeResponse,
  type Paginated,
  type TaxonomyNodeItem,
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
        "theme",
      ].sort()
    );
  });

  it("the empty branding fallback covers every key, with the default theme", () => {
    expect(Object.keys(EMPTY_BRANDING_PUBLIC).sort()).toEqual([...BRANDING_PUBLIC_KEYS].sort());

    // Text and asset fields are null when unconfigured; the theme never
    // is, because an unreadable theme would leave the UI unusable.
    const { theme, ...rest } = EMPTY_BRANDING_PUBLIC;
    expect(Object.values(rest).every((v) => v === null)).toBe(true);
    expect(theme.colors).toEqual(DEFAULT_BRAND_THEME);
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

describe("the public opportunity contract keeps commercial terms out", () => {
  it("lists exactly the keys an anonymous visitor receives", () => {
    expect([...PUBLIC_OPPORTUNITY_ITEM_KEYS].sort()).toEqual(
      [
        "id",
        "productNameAr",
        "productNameEn",
        "imageUrl",
        "thumbnailUrl",
        "fulfillmentCityNameAr",
        "fulfillmentCityNameEn",
        "salesUnitNameAr",
        "salesUnitNameEn",
        "endAt",
        "status",
      ].sort()
    );
  });

  it.each([
    "unitPriceInclTaxAmount",
    "targetQuantity",
    "fundedQuantity",
    "unsoldQuantity",
    "progressPercentage",
    "shareQuantity",
    "sharePercentage",
    "currency",
    "expectedPreparationDays",
  ])("keeps %s off both the list item and the detail", (field) => {
    expect(PUBLIC_OPPORTUNITY_ITEM_KEYS).not.toContain(field);
    expect(PUBLIC_OPPORTUNITY_DETAIL_KEYS).not.toContain(field);
  });

  it("makes the detail a superset of the list item, so the two cannot diverge", () => {
    for (const key of PUBLIC_OPPORTUNITY_ITEM_KEYS) {
      expect(PUBLIC_OPPORTUNITY_DETAIL_KEYS).toContain(key);
    }
  });

  it("adds only descriptive context on the detail", () => {
    const added = PUBLIC_OPPORTUNITY_DETAIL_KEYS.filter(
      (key) => !(PUBLIC_OPPORTUNITY_ITEM_KEYS as readonly string[]).includes(key)
    );

    expect([...added].sort()).toEqual(
      [
        "productDescriptionAr",
        "productDescriptionEn",
        "fulfillmentRegionNameAr",
        "fulfillmentRegionNameEn",
        "startAt",
      ].sort()
    );
  });

  it("exposes only the two statuses an anonymous visitor can observe", () => {
    expect([...PUBLIC_OPPORTUNITY_STATUSES]).toEqual(["ACTIVE", "SCHEDULED"]);
  });

  it("closes the sort vocabulary and defaults the WIRE to NEWEST", () => {
    expect([...OPPORTUNITY_SORTS]).toEqual(["NEWEST", "ENDING_SOON"]);
    expect(DEFAULT_OPPORTUNITY_SORT).toBe("NEWEST");
  });
});

describe("catalogue contracts describe the real endpoints", () => {
  it("records that taxonomy filtering does NOT include descendants", () => {
    // Verified against OpportunityDiscoveryService.buildQuery, which
    // compares the snapshot's taxonomyNodeId with `equals`.
    expect(TAXONOMY_FILTER_INCLUDES_DESCENDANTS).toBe(false);
  });

  it("records that products may be filed under a non-leaf node", () => {
    expect(TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS).toBe(true);
  });

  it("keeps the taxonomy wire shape flat, carrying parentId", () => {
    expect([...TAXONOMY_NODE_ITEM_KEYS].sort()).toEqual(
      ["id", "parentId", "nameAr", "nameEn", "iconUrl", "sortOrder"].sort()
    );

    const node: TaxonomyNodeItem = {
      id: "n",
      parentId: null,
      nameAr: "غذاء",
      nameEn: "Food",
      iconUrl: null,
      sortOrder: 0,
    };
    expect(node.parentId).toBeNull();
  });

  it("carries a city's region inline and no coordinates", () => {
    expect([...CITY_ITEM_KEYS].sort()).toEqual(["id", "nameAr", "nameEn", "region"].sort());
    expect(CITY_ITEM_KEYS).not.toContain("latitude");
    expect(CITY_ITEM_KEYS).not.toContain("longitude");
  });

  it("gives a policy version its document CODE, not an invented title", () => {
    expect(PUBLIC_POLICY_VERSION_KEYS).toContain("documentCode");
    expect(PUBLIC_POLICY_VERSION_KEYS).not.toContain("titleAr");
    expect(PUBLIC_POLICY_VERSION_KEYS).not.toContain("titleEn");
  });

  it("withholds the internal policy mechanics from the public shape", () => {
    for (const internal of [
      "isPublished",
      "requiresReacceptance",
      "policyDocumentId",
      "createdAt",
      "updatedAt",
    ]) {
      expect(PUBLIC_POLICY_VERSION_KEYS).not.toContain(internal);
    }
  });
});
