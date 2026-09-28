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
  PUBLIC_OPPORTUNITY_FORBIDDEN_FIELDS,
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
        // ONE header mark, already resolved for the page's language.
        // The two per-language URL columns are gone: they were
        // free-text addresses, and the mark is now bytes this API
        // stores and serves from a route of its own.
        "headerLogo",
        "logoMainUrl",
        "logoSmallUrl",
        "nameAr",
        "nameEn",
        "shortDescriptionAr",
        "shortDescriptionEn",
        "theme",
      ].sort(),
    );
  });

  it("the empty branding fallback covers every key, with the default theme", () => {
    expect(Object.keys(EMPTY_BRANDING_PUBLIC).sort()).toEqual(
      [...BRANDING_PUBLIC_KEYS].sort(),
    );

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
    const page: Paginated<string> = {
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    };
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
      // What the company's record still needs, by name. Part of the
      // contract, so the compiler refuses a MeResponse without it.
      profile: { complete: true, missing: [] },
    };

    expect(branding.nameAr).toBeNull();
    expect(page.items).toEqual([]);
    expect(me.company.accountType).toBe("TRADER");
  });
});

/**
 * The public boundary MOVED, on purpose.
 *
 * Price, the three quantities and progress are now shown to a visitor,
 * so they can judge an offer before creating an account. This block used
 * to assert the opposite; it is rewritten rather than deleted, because
 * what matters is not "no terms are public" but "exactly these are, and
 * nothing else has crept in beside them".
 */
describe("the public opportunity contract exposes offer terms and nothing more", () => {
  it("lists exactly the keys an anonymous visitor receives", () => {
    expect([...PUBLIC_OPPORTUNITY_ITEM_KEYS].sort()).toEqual(
      [
        "id",
        // WHICH OF THE TWO SALES PATHS. Public by necessity: a card
        // cannot be drawn without it — it decides whether the numbers
        // are progress toward a target or stock on a shelf, and whether
        // `endAt` and `shareQuantity` mean anything at all. It reveals
        // nothing commercial that the price and quantities beside it do
        // not already.
        "saleMode",
        "productNameAr",
        "productNameEn",
        "imageUrl",
        "thumbnailUrl",
        "fulfillmentCityNameAr",
        "fulfillmentCityNameEn",
        "fulfillmentRegionNameAr",
        "fulfillmentRegionNameEn",
        "salesUnitNameAr",
        "salesUnitNameEn",
        "unitPriceInclTaxAmount",
        "currency",
        "targetQuantity",
        "unsoldQuantity",
        "progressPercentage",
        "shareQuantity",
        "endAt",
        "status",
      ].sort(),
    );
  });

  it.each([...PUBLIC_OPPORTUNITY_FORBIDDEN_FIELDS])(
    "keeps %s off both the list item and the detail",
    (field) => {
      expect(PUBLIC_OPPORTUNITY_ITEM_KEYS).not.toContain(field);
      expect(PUBLIC_OPPORTUNITY_DETAIL_KEYS).not.toContain(field);
    },
  );

  it.each([
    // The two trader figures that did NOT move with the rest.
    "fundedQuantity",
    "sharePercentage",
  ])("keeps the trader-only figure %s off both public shapes", (field) => {
    expect(PUBLIC_OPPORTUNITY_ITEM_KEYS).not.toContain(field);
    expect(PUBLIC_OPPORTUNITY_DETAIL_KEYS).not.toContain(field);
  });

  it("names every forbidden field explicitly, so the list cannot quietly empty", () => {
    // A guard driven by a list is only as good as the list; an empty or
    // truncated one would make every assertion above vacuous.
    expect(PUBLIC_OPPORTUNITY_FORBIDDEN_FIELDS.length).toBeGreaterThanOrEqual(
      15,
    );
    expect(PUBLIC_OPPORTUNITY_FORBIDDEN_FIELDS).toContain(
      "expectedPreparationDays",
    );
    expect(PUBLIC_OPPORTUNITY_FORBIDDEN_FIELDS).toContain("supplierCompanyId");
  });

  it("shares no field between the public shape and the forbidden list", () => {
    const publicKeys = new Set<string>([
      ...PUBLIC_OPPORTUNITY_ITEM_KEYS,
      ...PUBLIC_OPPORTUNITY_DETAIL_KEYS,
    ]);
    for (const forbidden of PUBLIC_OPPORTUNITY_FORBIDDEN_FIELDS) {
      expect(publicKeys.has(forbidden)).toBe(false);
    }
  });

  it("makes the detail a superset of the list item, so the two cannot diverge", () => {
    for (const key of PUBLIC_OPPORTUNITY_ITEM_KEYS) {
      expect(PUBLIC_OPPORTUNITY_DETAIL_KEYS).toContain(key);
    }
  });

  it("adds only descriptive context on the detail", () => {
    const added = PUBLIC_OPPORTUNITY_DETAIL_KEYS.filter(
      (key) =>
        !(PUBLIC_OPPORTUNITY_ITEM_KEYS as readonly string[]).includes(key),
    );

    // THE DETAIL ADDS DESCRIPTIVE CONTEXT AND THE PRODUCT'S OWN FACTS,
    // and nothing commercial. The region moved up to the list item —
    // the card shows it — and the physical facts were widened when the
    // buyer's detail page grew a package-specification card.
    //
    // NOTHING HERE IS NEW DATA. Every one of these was already frozen
    // in the product approval snapshot at approval time; the parser
    // read four of its fourteen keys, and now reads the rest. No
    // migration and no new column.
    //
    // AND NONE OF IT IS COMMERCIAL. A weight and a box size say nothing
    // about margin, about who is selling, or about how fast they work —
    // the forbidden list below is untouched, and the boundary test that
    // walks it still passes.
    expect([...added].sort()).toEqual(
      [
        "productDescriptionAr",
        "productDescriptionEn",
        "startAt",
        "taxonomyNodeId",
        "weightPerUnit",
        "lengthCm",
        "widthCm",
        "heightCm",
        "packageContentQuantity",
        "packageContentUnitNameAr",
        "packageContentUnitNameEn",
        "imageUrls",
        "thumbnailUrls",
      ].sort(),
    );

    // THE LIST ITEM IS NOT WIDENED WITH IT. A card shows one picture and
    // no dimensions, and carrying them on every row of a paginated list
    // is payload nobody reads.
    for (const key of ["weightPerUnit", "lengthCm", "imageUrls", "taxonomyNodeId"]) {
      expect([...(PUBLIC_OPPORTUNITY_ITEM_KEYS as readonly string[])]).not.toContain(key);
    }
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
  it("records the two halves of ONE decision, which must not disagree", () => {
    // A product may no longer be filed on a node that has children —
    // the owner's rule: «التصنيف إجباري، واختيار الفرع إجباري إذا كان
    // للتصنيف فروع». Nothing then sits on a parent, so a parent filter
    // MUST reach the leaves or every category in the bar becomes an
    // empty page.
    //
    // Asserted together rather than in two tests, because the failure
    // that matters is them drifting apart.
    expect(TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS).toBe(false);
    expect(TAXONOMY_FILTER_INCLUDES_DESCENDANTS).toBe(true);
    expect(TAXONOMY_FILTER_INCLUDES_DESCENDANTS).toBe(!TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS);
  });

  it("keeps the taxonomy wire shape flat, carrying parentId", () => {
    expect([...TAXONOMY_NODE_ITEM_KEYS].sort()).toEqual(
      ["id", "parentId", "nameAr", "nameEn", "iconUrl", "sortOrder"].sort(),
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
    expect([...CITY_ITEM_KEYS].sort()).toEqual(
      ["id", "nameAr", "nameEn", "region"].sort(),
    );
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
