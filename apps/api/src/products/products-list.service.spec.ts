/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { Prisma } from "@prisma/client";
import { PRODUCT_SUMMARY_KEYS } from "@platform/types";
import { ProductsService } from "./products.service";

/**
 * The supplier's catalogue list, projected.
 *
 * The defect this replaces: `listMine` returned raw Prisma rows with
 * `include: { media: true }`, so every response carried each image's
 * `objectKey` and `thumbnailObjectKey` — the internal storage addresses —
 * plus Decimal instances that serialise as JSON numbers.
 *
 * `PRODUCT_SUMMARY_SELECT` and `toProductSummary` were written in 8E.2 and
 * wired to `getOwned` only; the list was missed.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "77777777-7777-4777-8777-777777777777";
const MEDIA = "88888888-8888-4888-8888-888888888888";

function summaryRow(overrides: Record<string, any> = {}) {
  return {
    id: PRODUCT,
    nameAr: "زيت زيتون",
    nameEn: "Olive oil",
    approvalStatus: "APPROVED",
    rejectionReason: null,
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    archivedAt: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    media: [{ id: MEDIA }],
    ...overrides,
  };
}

function build(rows: unknown[]) {
  const findMany = jest.fn(async (..._args: any[]) => rows);
  const service = new ProductsService({ product: { findMany } } as any, {} as any);
  return { service, findMany };
}

describe("the catalogue list carries exactly its contract", () => {
  it("returns the declared summary keys — no more, no less", async () => {
    const { service } = build([summaryRow()]);

    const products = await service.listMine(COMPANY);

    expect(Object.keys(products[0]).sort()).toEqual([...PRODUCT_SUMMARY_KEYS].sort());
  });

  it("never selects a storage key", async () => {
    // Not selecting is stronger than not mapping: a later refactor that
    // spreads a media row cannot leak a column the query never read.
    const { service, findMany } = build([summaryRow()]);

    await service.listMine(COMPANY);

    const select = JSON.stringify((findMany.mock.calls[0][0] as any).select);
    expect(select).not.toContain("objectKey");
    expect(select).not.toContain("thumbnailObjectKey");
    expect(select).not.toContain("snapshot");
  });

  it("serialises no storage key, bucket or presigned URL", async () => {
    const { service } = build([summaryRow()]);

    const serialised = JSON.stringify(await service.listMine(COMPANY));

    for (const forbidden of ["objectKey", "bucket", "X-Amz", "Signature", ".jpg"]) {
      expect([forbidden, serialised.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("addresses the thumbnail by route, built from ids", async () => {
    const { service } = build([summaryRow()]);

    const [product] = await service.listMine(COMPANY);

    expect(product.thumbnailUrl).toBe(
      `/api/v1/companies/me/products/${PRODUCT}/media/${MEDIA}/image?variant=thumb`
    );
    expect(product.mediaCount).toBe(1);
  });

  it("reports no media as a null thumbnail and a zero count", async () => {
    // Null and zero agree, so a UI cannot render a broken image for a
    // product with no pictures.
    const { service } = build([summaryRow({ media: [] })]);

    const [product] = await service.listMine(COMPANY);

    expect(product.thumbnailUrl).toBeNull();
    expect(product.mediaCount).toBe(0);
  });

  it("carries the reviewer's rejection reason, which was written for the supplier", async () => {
    const { service } = build([
      summaryRow({ approvalStatus: "REJECTED", rejectionReason: "الصور غير واضحة" }),
    ]);

    const [product] = await service.listMine(COMPANY);

    expect(product.approvalStatus).toBe("REJECTED");
    expect(product.rejectionReason).toBe("الصور غير واضحة");
  });

  it("returns ISO strings, never Date or Decimal instances", async () => {
    const { service } = build([summaryRow({ archivedAt: new Date("2026-08-03T00:00:00.000Z") })]);

    const [product] = await service.listMine(COMPANY);

    expect(product.createdAt).toBe("2026-08-01T00:00:00.000Z");
    expect(product.archivedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(product.createdAt).not.toBeInstanceOf(Date);
    expect(product.createdAt).not.toBeInstanceOf(Prisma.Decimal);
  });
});

describe("ownership lives in the query", () => {
  it("scopes the list to the caller's company", async () => {
    const { service, findMany } = build([summaryRow()]);

    await service.listMine(COMPANY);

    expect((findMany.mock.calls[0][0] as any).where).toEqual({ companyId: COMPANY });
  });

  it("orders deterministically, terminating in the id", async () => {
    // Two products created in the same millisecond must not swap places
    // between requests.
    const { service, findMany } = build([summaryRow()]);

    await service.listMine(COMPANY);

    expect((findMany.mock.calls[0][0] as any).orderBy).toEqual([
      { createdAt: "desc" },
      { id: "asc" },
    ]);
  });

  it("returns an empty list rather than throwing when there is nothing", async () => {
    const { service } = build([]);

    expect(await service.listMine(COMPANY)).toEqual([]);
  });
});
