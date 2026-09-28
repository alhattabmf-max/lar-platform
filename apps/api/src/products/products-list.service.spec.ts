/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { Prisma } from "@prisma/client";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PRODUCT_SUMMARY_KEYS } from "@platform/types";
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
    // THE CARD'S OWN FIELDS, on the summary. They used to be fetched
    // per row from the detail endpoint — one HTTP request per product.
    descriptionAr: "وصف",
    descriptionEn: "Description",
    weightPerUnit: new Prisma.Decimal("12.5"),
    lengthCm: new Prisma.Decimal("30"),
    widthCm: new Prisma.Decimal("20"),
    heightCm: new Prisma.Decimal("15"),
    packageContentQuantity: new Prisma.Decimal("6"),
    packageContentUnitNameAr: "علبة",
    packageContentUnitNameEn: "Box",
    media: [{ id: MEDIA }],
    ...overrides,
  };
}

function build(rows: unknown[]) {
  const findMany = jest.fn(async (..._args: any[]) => rows);
  const count = jest.fn(async (..._args: any[]) => rows.length);
  const service = new ProductsService({ product: { findMany, count } } as any, {} as any);
  return { service, findMany, count };
}

/** The first row of the page, for the assertions that want one product. */
async function first(service: ProductsService, query = {}) {
  const page = await service.listMine(COMPANY, query as never);
  return page.items[0];
}

describe("the catalogue list carries exactly its contract", () => {
  it("returns the declared summary keys — no more, no less", async () => {
    const { service } = build([summaryRow()]);

    const page = await service.listMine(COMPANY);

    expect(Object.keys(page.items[0]).sort()).toEqual([...PRODUCT_SUMMARY_KEYS].sort());
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

    const product = await first(service);

    expect(product.thumbnailUrl).toBe(
      `/api/v1/companies/me/products/${PRODUCT}/media/${MEDIA}/image?variant=thumb`
    );
    expect(product.mediaCount).toBe(1);
  });

  it("reports no media as a null thumbnail and a zero count", async () => {
    // Null and zero agree, so a UI cannot render a broken image for a
    // product with no pictures.
    const { service } = build([summaryRow({ media: [] })]);

    const product = await first(service);

    expect(product.thumbnailUrl).toBeNull();
    expect(product.mediaCount).toBe(0);
  });

  it("carries the reviewer's rejection reason, which was written for the supplier", async () => {
    const { service } = build([
      summaryRow({ approvalStatus: "REJECTED", rejectionReason: "الصور غير واضحة" }),
    ]);

    const product = await first(service);

    expect(product.approvalStatus).toBe("REJECTED");
    expect(product.rejectionReason).toBe("الصور غير واضحة");
  });

  it("returns ISO strings, never Date or Decimal instances", async () => {
    const { service } = build([summaryRow({ archivedAt: new Date("2026-08-03T00:00:00.000Z") })]);

    const product = await first(service);

    expect(product.createdAt).toBe("2026-08-01T00:00:00.000Z");
    expect(product.archivedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(product.createdAt).not.toBeInstanceOf(Date);
    expect(product.createdAt).not.toBeInstanceOf(Prisma.Decimal);
  });
});

describe("ownership lives in the query", () => {
  it("scopes the list to the caller's company", async () => {
    const { service, findMany, count } = build([summaryRow()]);

    await service.listMine(COMPANY);

    expect((findMany.mock.calls[0][0] as any).where).toEqual({ companyId: COMPANY });
    // And the count that drives the pager is scoped the same way: a
    // total taken over a wider predicate than the rows is a pager that
    // offers pages with nothing on them.
    expect((count.mock.calls[0][0] as any).where).toEqual({ companyId: COMPANY });
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

    expect(await service.listMine(COMPANY)).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
  });
});

describe("the catalogue is paged, not ceilinged", () => {
  // THE DEFECT THIS REPLACES: the list answered with the most recent
  // five hundred products and nothing said so. A supplier past that
  // never saw their oldest, and the screen still drew every row it was
  // given — 6.4 MB of HTML at the limit.

  it("asks for one page, and the page size is clamped however large the ask", async () => {
    const { service, findMany } = build([summaryRow()]);

    await service.listMine(COMPANY, { page: 3, pageSize: 5000 } as never);

    const args = findMany.mock.calls[0][0] as any;
    expect(args.take).toBe(MAX_PAGE_SIZE);
    expect(args.skip).toBe(2 * MAX_PAGE_SIZE);
  });

  it("defaults to the first page at the default size", async () => {
    const { service, findMany } = build([summaryRow()]);

    await service.listMine(COMPANY);

    const args = findMany.mock.calls[0][0] as any;
    expect([args.skip, args.take]).toEqual([0, DEFAULT_PAGE_SIZE]);
  });

  it("carries no `take` ceiling of its own — the page IS the bound", async () => {
    // Guarding against the ceiling coming back as a floor under the
    // pager, which would silently cap the last page.
    const { service, findMany } = build([summaryRow()]);

    await service.listMine(COMPANY, { pageSize: 50 } as never);

    expect((findMany.mock.calls[0][0] as any).take).toBe(50);
  });

  it("reports the TOTAL, not the page length, so the pager knows how far it goes", async () => {
    const { service, count } = build([summaryRow()]);
    count.mockResolvedValueOnce(4321 as never);

    const page = await service.listMine(COMPANY);

    expect(page.total).toBe(4321);
    expect(page.items).toHaveLength(1);
  });

  it("searches the name in BOTH languages, case-insensitively, on the server", async () => {
    const { service, findMany } = build([summaryRow()]);

    await service.listMine(COMPANY, { search: "  زيت  " } as never);

    expect((findMany.mock.calls[0][0] as any).where).toEqual({
      companyId: COMPANY,
      OR: [
        { nameAr: { contains: "زيت", mode: "insensitive" } },
        { nameEn: { contains: "زيت", mode: "insensitive" } },
      ],
    });
  });

  it("splits the catalogue into what needs acting on and what does not", async () => {
    const attention = ["DRAFT", "REJECTED", "SUSPENDED"];
    const { service, findMany } = build([summaryRow()]);

    await service.listMine(COMPANY, { needsAttention: true } as never);
    await service.listMine(COMPANY, { needsAttention: false } as never);

    expect((findMany.mock.calls[0][0] as any).where.approvalStatus).toEqual({ in: attention });
    expect((findMany.mock.calls[1][0] as any).where.approvalStatus).toEqual({ notIn: attention });
  });

  it("asks for the whole catalogue when neither half is named", async () => {
    const { service, findMany } = build([summaryRow()]);

    await service.listMine(COMPANY);

    expect((findMany.mock.calls[0][0] as any).where.approvalStatus).toBeUndefined();
  });

  it("narrows to what an offer can be published on, in the query", async () => {
    // The listing form used to be handed the catalogue and filter it in
    // the browser.
    const { service, findMany } = build([summaryRow()]);

    await service.listMine(COMPANY, { publishable: true } as never);

    const where = (findMany.mock.calls[0][0] as any).where;
    expect(where.approvalStatus).toBe("APPROVED");
    expect(where.archivedAt).toBeNull();
  });
});
