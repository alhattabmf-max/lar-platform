import { Prisma } from "@prisma/client";
import { OpportunityDiscoveryService } from "./opportunity-discovery.service";
import type { PrismaService } from "../database/prisma.service";
import type { OpportunitySettingsService } from "../settings/opportunity-settings.service";

/**
 * The public/trader boundary, asserted rather than assumed.
 *
 * That boundary MOVED, deliberately: a visitor now sees an offer's
 * price, target and remaining quantity, minimum order and progress, so
 * they can judge it before creating an account. Buying still requires
 * an authenticated trader.
 *
 * What did not move is what describes the PLATFORM rather than the
 * offer — how much has actually sold, share sizing, the supplier's
 * preparation commitment, and every internal identifier. A test is the
 * only thing that keeps the new line true as fields get added.
 */

/**
 * What a visitor must NEVER receive.
 *
 * The boundary moved on purpose: price, the three quantities and
 * progress are public now, so a visitor can judge an offer before
 * creating an account. This list is what did NOT move — the raw column
 * behind the price, the absolute amount sold, the share percentage, the
 * supplier's preparation commitment, and every internal identifier.
 */
const FORBIDDEN_ON_PUBLIC = [
  // The raw Decimal column. The public shape carries the rendered
  // string; handing over the column name would invite float parsing.
  "unitPriceAmount",
  // How much has actually sold, in absolute terms.
  "fundedQuantity",
  // Share sizing and the raw basis points behind it.
  "sharePercentage",
  "shareBasisPoints",
  // A supply commitment, which belongs with the trader terms.
  "expectedPreparationDays",
  // Internals.
  "productApprovalSnapshot",
  "taxSnapshotId",
  "commissionPolicyVersionId",
] as const;

/** What a visitor now DOES receive, by decision. */
const PUBLIC_TERMS = [
  "unitPriceInclTaxAmount",
  "currency",
  "targetQuantity",
  "unsoldQuantity",
  "progressPercentage",
  "shareQuantity",
] as const;

const MEDIA = [
  {
    objectKey: "products/p1/aaa.jpg",
    thumbnailObjectKey: "products/p1/aaa-thumb.jpg",
    isMain: true,
    sortOrder: 0,
  },
];

function publicRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    saleMode: "GROUP",
    fulfillmentCityNameAr: "الرياض",
    fulfillmentCityNameEn: "Riyadh",
    fulfillmentRegionNameAr: "منطقة الرياض",
    fulfillmentRegionNameEn: "Riyadh Region",
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    // The terms columns the public projection now reads. fundedQuantity
    // is READ to derive unsold and progress, and never returned.
    unitPriceAmount: new Prisma.Decimal("287.50"),
    currency: "SAR",
    targetQuantity: 100,
    fundedQuantity: 10,
    shareQuantity: 10,
    endAt: new Date("2026-09-01T00:00:00.000Z"),
    status: "ACTIVE",
    productApprovalSnapshot: {
      snapshot: { nameAr: "منتج", nameEn: "Product", media: MEDIA },
    },
    ...overrides,
  };
}

function traderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "o1",
    saleMode: "GROUP",
    unitPriceAmount: new Prisma.Decimal("115.00"),
    currency: "SAR",
    targetQuantity: 100,
    fundedQuantity: 25,
    shareQuantity: 5,
    shareBasisPoints: 1000,
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    fulfillmentCityNameAr: "الرياض",
    fulfillmentCityNameEn: "Riyadh",
    fulfillmentRegionNameAr: "الرياض",
    fulfillmentRegionNameEn: "Riyadh",
    startAt: new Date("2026-08-01T00:00:00.000Z"),
    endAt: new Date("2026-09-01T00:00:00.000Z"),
    expectedPreparationDays: 3,
    status: "ACTIVE",
    productApprovalSnapshot: {
      snapshot: { nameAr: "منتج", nameEn: "Product", media: MEDIA },
    },
    ...overrides,
  };
}

function makeService(rows: unknown[]) {
  const prisma = {
    opportunity: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
      findFirst: jest.fn().mockResolvedValue(rows[0] ?? null),
    },
    // NOTHING IS LOCKED IN THESE FIXTURES. The trader projection asks
    // how much of each listing is held in live baskets so it can
    // publish a ceiling a quantity picker may offer; with no sessions
    // the answer is an empty result, and `availableQuantity` falls back
    // to target minus funded. The lock arithmetic itself is proved
    // against a real database, where locks can actually exist.
    $queryRaw: jest.fn().mockResolvedValue([]),
  } as unknown as PrismaService;

  const settings = {
    getConfig: jest
      .fn()
      .mockResolvedValue({ showScheduledPubliclyEnabled: false }),
  } as unknown as OpportunitySettingsService;

  return new OpportunityDiscoveryService(prisma, settings);
}

describe("public view exposes offer terms and nothing more", () => {
  it("exposes exactly the agreed public keys", async () => {
    const service = makeService([publicRow()]);

    const result = await service.listPublic({});

    expect(Object.keys(result.items[0]).sort()).toEqual(
      [
        // THE LIST ITEM IS NOT THE DETAIL. The product's physical facts
        // and the gallery were widened on the DETAIL alone: a card shows
        // one picture and no dimensions, and carrying them on every row
        // of a paginated list is payload nobody reads.
        "currency",
        "endAt",
        "fulfillmentCityNameAr",
        "fulfillmentCityNameEn",
        "fulfillmentRegionNameAr",
        "fulfillmentRegionNameEn",
        "id",
        "imageUrl",
        "productNameAr",
        "productNameEn",
        "progressPercentage",
        // WHICH OF THE TWO SALES PATHS. A card cannot render an offer
        // without it: it decides whether the numbers are progress
        // toward a target or stock on a shelf, and whether `endAt` and
        // `shareQuantity` mean anything at all. Public by necessity —
        // a visitor is looking at the same two kinds of card.
        "saleMode",
        "salesUnitNameAr",
        "salesUnitNameEn",
        "shareQuantity",
        "status",
        "targetQuantity",
        "thumbnailUrl",
        "unitPriceInclTaxAmount",
        "unsoldQuantity",
      ].sort(),
    );
  });

  it.each(PUBLIC_TERMS)(
    "exposes %s to a visitor, by decision",
    async (field) => {
      const service = makeService([publicRow()]);

      const result = await service.listPublic({});

      expect(result.items[0]).toHaveProperty(field);
    },
  );

  it("renders the price as a two-place decimal string, never a number", async () => {
    const service = makeService([publicRow()]);

    const result = await service.listPublic({});

    // A JSON number cannot hold 287.50 exactly, and this figure is
    // reconciled against a bank statement further down the line.
    expect(result.items[0].unitPriceInclTaxAmount).toBe("287.50");
    expect(typeof result.items[0].unitPriceInclTaxAmount).toBe("string");
  });

  it("derives unsold and progress from funded without exposing it", async () => {
    const service = makeService([
      publicRow({ targetQuantity: 100, fundedQuantity: 10 }),
    ]);

    const result = await service.listPublic({});

    expect(result.items[0].unsoldQuantity).toBe(90);
    expect(result.items[0].progressPercentage).toBe(10);
    expect(result.items[0]).not.toHaveProperty("fundedQuantity");
  });

  it.each(FORBIDDEN_ON_PUBLIC)("never exposes %s", async (field) => {
    const service = makeService([publicRow()]);

    const result = await service.listPublic({});

    expect(result.items[0]).not.toHaveProperty(field);
  });

  it("never exposes a storage key or any snapshot metadata", async () => {
    const service = makeService([publicRow()]);

    const serialised = JSON.stringify(await service.listPublic({}));

    expect(serialised).not.toContain("objectKey");
    expect(serialised).not.toContain("thumbnailObjectKey");
    expect(serialised).not.toContain("products/p1/");
    expect(serialised).not.toContain("media");
    expect(serialised).not.toContain("snapshot");
    expect(serialised).not.toContain("isMain");
  });

  it("exposes image ROUTES, not keys", async () => {
    const service = makeService([publicRow()]);

    const item = (await service.listPublic({})).items[0];

    expect(item.imageUrl).toBe("/api/v1/opportunities/o1/image");
    expect(item.thumbnailUrl).toBe(
      "/api/v1/opportunities/o1/image?variant=thumb",
    );
  });
});

describe("legacy and image-less snapshots", () => {
  it("returns null image URLs for a pre-7A snapshot with no media", async () => {
    const service = makeService([
      publicRow({
        productApprovalSnapshot: {
          snapshot: {
            salesUnitId: "11111111-1111-1111-1111-111111111111",
            nameAr: "م",
            nameEn: "P",
          },
        },
      }),
    ]);

    const item = (await service.listPublic({})).items[0];

    expect(item.imageUrl).toBeNull();
    expect(item.thumbnailUrl).toBeNull();
    expect(item.productNameAr).toBe("م");
  });

  it("does not crash when the snapshot is missing entirely", async () => {
    const service = makeService([publicRow({ productApprovalSnapshot: null })]);

    const item = (await service.listPublic({})).items[0];

    expect(item.imageUrl).toBeNull();
    expect(item.productNameAr).toBe("");
  });

  it.each([
    ["media as a string", "none"],
    ["media as an object", { objectKey: "x" }],
    ["entries missing keys", [{ isMain: true }]],
  ])("survives %s", async (_label, media) => {
    const service = makeService([
      publicRow({
        productApprovalSnapshot: {
          snapshot: { nameAr: "م", nameEn: "P", media },
        },
      }),
    ]);

    const item = (await service.listPublic({})).items[0];
    expect(item.imageUrl).toBeNull();
  });
});

describe("publish-time invariants are asserted, not papered over", () => {
  it("throws rather than emitting an empty city name", async () => {
    const service = makeService([publicRow({ fulfillmentCityNameAr: null })]);

    await expect(service.listPublic({})).rejects.toThrow(
      /null fulfillmentCityNameAr/,
    );
  });

  it("names the offending opportunity in the error", async () => {
    const service = makeService([
      publicRow({ id: "opp-42", fulfillmentCityNameEn: null }),
    ]);

    await expect(service.listPublic({})).rejects.toThrow(/opp-42/);
  });

  it("leaves genuinely optional fields nullable instead of coercing them", async () => {
    const service = makeService([
      publicRow({ salesUnitNameAr: null, salesUnitNameEn: null }),
    ]);

    const item = (await service.listPublic({})).items[0];

    expect(item.salesUnitNameAr).toBeNull();
    expect(item.salesUnitNameEn).toBeNull();
  });
});

describe("public DETAIL widens context without widening the boundary", () => {
  function detailRow(overrides: Record<string, unknown> = {}) {
    return publicRow({
      fulfillmentRegionNameAr: "منطقة الرياض",
      fulfillmentRegionNameEn: "Riyadh Region",
      startAt: new Date("2026-08-01T00:00:00.000Z"),
      productApprovalSnapshot: {
        snapshot: {
          nameAr: "منتج",
          nameEn: "Product",
          descriptionAr: "وصف",
          descriptionEn: "Description",
          media: MEDIA,
        },
      },
      ...overrides,
    });
  }

  it("exposes exactly the agreed detail keys", async () => {
    const service = makeService([detailRow()]);

    const detail = await service.getPublicDetail("o1");

    expect(Object.keys(detail!).sort()).toEqual(
      [
        "currency",
        "endAt",
        "fulfillmentCityNameAr",
        "fulfillmentCityNameEn",
        "fulfillmentRegionNameAr",
        "fulfillmentRegionNameEn",
        "id",
        "imageUrl",
        "productDescriptionAr",
        "productDescriptionEn",
        "productNameAr",
        "productNameEn",
        "progressPercentage",
        // WHICH OF THE TWO SALES PATHS. A card cannot render an offer
        // without it: it decides whether the numbers are progress
        // toward a target or stock on a shelf, and whether `endAt` and
        // `shareQuantity` mean anything at all. Public by necessity —
        // a visitor is looking at the same two kinds of card.
        "saleMode",
        "salesUnitNameAr",
        "salesUnitNameEn",
        "shareQuantity",
        "startAt",
        "status",
        "targetQuantity",
        "thumbnailUrl",
        "unitPriceInclTaxAmount",
        "unsoldQuantity",
        // THE PRODUCT S OWN FACTS, widened in this batch. Every one was
        // already frozen in the snapshot; the parser read four of its
        // fourteen keys. No migration and no new column — only the read.
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
  });

  it.each(FORBIDDEN_ON_PUBLIC)(
    "never exposes %s on the detail either",
    async (field) => {
      const service = makeService([detailRow()]);

      const detail = await service.getPublicDetail("o1");

      expect(detail).not.toHaveProperty(field);
    },
  );

  it("carries every list-item key, so the two views cannot drift", async () => {
    const service = makeService([detailRow()]);

    const listed = (await service.listPublic({})).items[0];
    const detail = await service.getPublicDetail("o1");

    for (const key of Object.keys(listed)) {
      expect(detail).toHaveProperty(key);
    }
  });

  it("returns the description from the FROZEN snapshot", async () => {
    const service = makeService([detailRow()]);

    const detail = await service.getPublicDetail("o1");

    expect(detail!.productDescriptionAr).toBe("وصف");
    expect(detail!.productDescriptionEn).toBe("Description");
  });

  it("leaves a missing description null rather than blank", async () => {
    const service = makeService([
      detailRow({
        productApprovalSnapshot: {
          snapshot: { nameAr: "م", nameEn: "P", media: MEDIA },
        },
      }),
    ]);

    const detail = await service.getPublicDetail("o1");

    expect(detail!.productDescriptionAr).toBeNull();
    expect(detail!.productDescriptionEn).toBeNull();
  });

  it("leaves an absent region null rather than blank", async () => {
    const service = makeService([
      detailRow({
        fulfillmentRegionNameAr: null,
        fulfillmentRegionNameEn: null,
      }),
    ]);

    const detail = await service.getPublicDetail("o1");

    expect(detail!.fulfillmentRegionNameAr).toBeNull();
    expect(detail!.fulfillmentRegionNameEn).toBeNull();
  });

  it("never leaks a storage key or the raw snapshot on the detail", async () => {
    const service = makeService([detailRow()]);

    const serialised = JSON.stringify(await service.getPublicDetail("o1"));

    expect(serialised).not.toContain("objectKey");
    expect(serialised).not.toContain("products/p1/");
    expect(serialised).not.toContain("snapshot");
  });

  it("restricts the detail read to publicly visible statuses", async () => {
    const service = makeService([detailRow()]);

    await service.getPublicDetail("o1");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findFirst = (service as any).prisma.opportunity
      .findFirst as jest.Mock;
    expect(findFirst.mock.calls[0][0].where.status.in).toEqual(["ACTIVE"]);
  });

  it("returns null for an unknown id, with no other observable difference", async () => {
    const service = makeService([]);

    expect(await service.getPublicDetail("missing")).toBeNull();
  });
});

describe("trader view", () => {
  it("exposes unsoldQuantity, not remainingQuantity", async () => {
    const service = makeService([traderRow()]);

    const item = (await service.listForTrader({})).items[0];

    expect(item).toHaveProperty("unsoldQuantity");
    expect(item).not.toHaveProperty("remainingQuantity");
    expect(item.unsoldQuantity).toBe(75);
  });

  it("clamps unsoldQuantity at zero when funded exceeds the cap", async () => {
    const service = makeService([
      traderRow({ targetQuantity: 10, fundedQuantity: 25 }),
    ]);

    const item = (await service.listForTrader({})).items[0];

    expect(item.unsoldQuantity).toBe(0);
  });

  it("reports progressPercentage as the share of the cap SOLD", async () => {
    const service = makeService([
      traderRow({ targetQuantity: 200, fundedQuantity: 50 }),
    ]);

    const item = (await service.listForTrader({})).items[0];

    expect(item.progressPercentage).toBe(25);
    expect(item.unsoldQuantity).toBe(150);
  });

  it("handles a zero cap without dividing by zero", async () => {
    const service = makeService([
      traderRow({ targetQuantity: 0, fundedQuantity: 0 }),
    ]);

    const item = (await service.listForTrader({})).items[0];

    expect(item.progressPercentage).toBe(0);
    expect(item.unsoldQuantity).toBe(0);
  });

  it("still carries the commercial terms the public view withholds", async () => {
    const service = makeService([traderRow()]);

    const item = (await service.listForTrader({})).items[0];

    // A decimal STRING, at the scale of the Decimal(12,2) column.
    // A JSON number cannot hold 125.50 exactly, and this figure is
    // reconciled against a bank statement.
    expect(item.unitPriceInclTaxAmount).toBe("115.00");
    expect(item.shareQuantity).toBe(5);
    expect(item.sharePercentage).toBe(10);
  });

  it("never leaks raw basis points or storage keys", async () => {
    const service = makeService([traderRow()]);

    const serialised = JSON.stringify(await service.listForTrader({}));

    expect(serialised).not.toContain("shareBasisPoints");
    expect(serialised).not.toContain("objectKey");
    expect(serialised).not.toContain("products/p1/");
  });
});
