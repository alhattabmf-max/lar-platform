import {
  PRODUCT_DETAIL_KEYS,
  PRODUCT_MEDIA_VIEW_KEYS,
  PRODUCT_SUMMARY_KEYS,
} from "@platform/types";
import { Prisma } from "@prisma/client";
import {
  PRODUCT_DETAIL_SELECT,
  PRODUCT_SUMMARY_SELECT,
  ownedProductWhere,
  toProductDetail,
  toProductSummary,
} from "./product.view";

/**
 * A supplier's own products.
 *
 * This withholds less than the order or settlement projections — a product is
 * largely the supplier's own record. What it does withhold is the platform's
 * machinery: the approval SNAPSHOTS published opportunities are built from,
 * each carrying storage keys, and the media storage keys themselves.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "77777777-7777-4777-8777-777777777777";
const MEDIA = "88888888-8888-4888-8888-888888888888";

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT,
    nameAr: "منتج",
    nameEn: "Product",
    approvalStatus: "APPROVED",
    rejectionReason: null,
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    archivedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    media: [{ id: MEDIA }],
    ...overrides,
  } as never;
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    ...(summaryRow() as object),
    descriptionAr: "وصف",
    descriptionEn: "Description",
    taxonomyNodeId: "99999999-9999-4999-8999-999999999999",
    weightPerUnit: new Prisma.Decimal("12.5"),
    lengthCm: new Prisma.Decimal("30"),
    widthCm: new Prisma.Decimal("20"),
    heightCm: new Prisma.Decimal("15"),
    packageContentQuantity: new Prisma.Decimal("6"),
    packageContentUnitNameAr: "علبة",
    packageContentUnitNameEn: "Box",
    media: [
      {
        id: MEDIA,
        contentType: "image/jpeg",
        sizeBytes: 204800,
        isMain: true,
        sortOrder: 0,
      },
    ],
    ...overrides,
  } as never;
}

describe("the projected product carries exactly its contract", () => {
  it("returns the declared summary keys", () => {
    expect(Object.keys(toProductSummary(summaryRow())).sort()).toEqual(
      [...PRODUCT_SUMMARY_KEYS].sort()
    );
  });

  it("returns the declared detail and media keys", () => {
    const detail = toProductDetail(detailRow());

    expect(Object.keys(detail).sort()).toEqual([...PRODUCT_DETAIL_KEYS].sort());
    expect(Object.keys(detail.media[0]).sort()).toEqual([...PRODUCT_MEDIA_VIEW_KEYS].sort());
  });

  it("tells a rejected supplier why — that is correspondence written for them", () => {
    const summary = toProductSummary(
      summaryRow({ approvalStatus: "REJECTED", rejectionReason: "الصور غير واضحة" })
    );

    expect(summary.approvalStatus).toBe("REJECTED");
    expect(summary.rejectionReason).toBe("الصور غير واضحة");
  });
});

describe("storage keys never cross the wire", () => {
  it("selects neither objectKey nor thumbnailObjectKey", () => {
    // Not selecting is stronger than not mapping: a later refactor that
    // spreads a media row cannot leak a column the query never asked for.
    for (const select of [
      JSON.stringify(PRODUCT_SUMMARY_SELECT),
      JSON.stringify(PRODUCT_DETAIL_SELECT),
    ]) {
      expect(select).not.toContain("objectKey");
      expect(select).not.toContain("thumbnailObjectKey");
    }
  });

  it("selects no approval snapshot", () => {
    // The snapshots are frozen copies published opportunities are built from,
    // and each one carries storage keys of its own.
    for (const select of [
      JSON.stringify(PRODUCT_SUMMARY_SELECT),
      JSON.stringify(PRODUCT_DETAIL_SELECT),
    ]) {
      expect(select).not.toContain("Snapshot");
      expect(select).not.toContain("snapshot");
    }
  });

  it("serialises no key, no bucket and no presigned URL", () => {
    const serialised = JSON.stringify(toProductDetail(detailRow()));

    for (const forbidden of [
      "objectKey",
      "storageObjectKey",
      "bucket",
      "X-Amz",
      "Signature",
      "expires",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("addresses an image by route, built from ids", () => {
    const media = toProductDetail(detailRow()).media[0];

    expect(media.url).toBe(`/api/v1/companies/me/products/${PRODUCT}/media/${MEDIA}/image`);
    expect(media.thumbnailUrl).toBe(
      `/api/v1/companies/me/products/${PRODUCT}/media/${MEDIA}/image?variant=thumb`
    );
  });

  it("gives a thumbnail on the summary too, or null when there is no media", () => {
    // Null and zero agree, so a UI cannot render a broken image for an empty
    // product.
    expect(toProductSummary(summaryRow()).thumbnailUrl).toBe(
      `/api/v1/companies/me/products/${PRODUCT}/media/${MEDIA}/image?variant=thumb`
    );

    const empty = toProductSummary(summaryRow({ media: [] }));
    expect(empty.thumbnailUrl).toBeNull();
    expect(empty.mediaCount).toBe(0);
  });
});

describe("measurements are decimal strings at their own precision", () => {
  it("keeps weight at three places and dimensions at two", () => {
    // Not money — but a float would change the value, and a 0.005 kg
    // difference can decide a shipping tier.
    const detail = toProductDetail(detailRow());

    expect(detail.weightPerUnit).toBe("12.500");
    expect(detail.lengthCm).toBe("30.00");
    expect(detail.widthCm).toBe("20.00");
    expect(detail.heightCm).toBe("15.00");
    expect(detail.packageContentQuantity).toBe("6.000");

    for (const value of [detail.weightPerUnit, detail.lengthCm, detail.packageContentQuantity]) {
      expect(typeof value).toBe("string");
    }
  });

  it("passes an absent package content through as null", () => {
    expect(toProductDetail(detailRow({ packageContentQuantity: null })).packageContentQuantity)
      .toBeNull();
  });
});

describe("media order is the order it is displayed in", () => {
  it("orders main first, then by sort order, terminating in the id", () => {
    // Terminating in the primary key, so two images sharing a sort order
    // cannot swap places between requests.
    for (const select of [PRODUCT_SUMMARY_SELECT, PRODUCT_DETAIL_SELECT]) {
      expect(select.media.orderBy).toEqual([
        { isMain: "desc" },
        { sortOrder: "asc" },
        { id: "asc" },
      ]);
    }
  });

  it("takes the summary thumbnail from the first row of that order", () => {
    const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const summary = toProductSummary(summaryRow({ media: [{ id: first }, { id: MEDIA }] }));

    expect(summary.thumbnailUrl).toContain(first);
    expect(summary.mediaCount).toBe(2);
  });
});

describe("ownership lives in the query", () => {
  it("filters by the caller's company", () => {
    expect(ownedProductWhere(COMPANY)).toEqual({ companyId: COMPANY });
  });
});
