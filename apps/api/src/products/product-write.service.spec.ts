/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { Prisma } from "@prisma/client";
import {
  PRODUCT_DETAIL_KEYS,
  PRODUCT_TECHNICAL_CHECK_CODES,
  PRODUCT_TECHNICAL_CHECK_FIELDS,
  SALES_UNIT_ITEM_KEYS,
  isProductTechnicalCheckCode,
  readFailedChecks,
} from "@platform/types";
import { ProductsService } from "./products.service";
import { ProductMediaService } from "./product-media.service";
import { SalesUnitsService } from "../sales-units/sales-units.service";
import { runProductTechnicalChecks } from "./product-technical-checks";
import { PRODUCT_DETAIL_SELECT, toProductDetail } from "./product.view";

/**
 * The write paths, after 8E.5a.
 *
 * Three defects closed here: `undefined` and `null` meant the same thing
 * so an optional field could be set but never cleared; the reorder guard
 * accepted a duplicated id and produced a partial reorder that reported
 * success; and a failed technical check was sent as joined English
 * sentences no client could map to a field.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "77777777-7777-4777-8777-777777777777";
const CTX = { userId: "u-1", companyId: COMPANY, requestId: "req-1" };

function productRow(overrides: Record<string, any> = {}) {
  return {
    id: PRODUCT,
    companyId: COMPANY,
    approvalStatus: "DRAFT",
    archivedAt: null,
    packageContentQuantity: new Prisma.Decimal("6"),
    packageContentUnitNameAr: "علبة",
    packageContentUnitNameEn: "Box",
    descriptionAr: "وصف",
    descriptionEn: "Description",
    salesUnitId: "22222222-2222-4222-8222-222222222222",
    ...overrides,
  };
}

function buildProducts(row: Record<string, any> | null = productRow()) {
  const update = jest.fn(async (args: any) => ({ ...row, ...args.data }));
  const prisma = {
    product: { findFirst: jest.fn(async () => row), update },
    productMedia: { findMany: jest.fn(async () => []) },
    taxonomyNode: { findUnique: jest.fn(async () => ({ id: "n", isActive: true })) },
    salesUnit: { findUnique: jest.fn(async () => ({ id: "u", isActive: true })) },
    $transaction: jest.fn(async (fn: any) =>
      fn({
        product: { update },
        productMedia: { findMany: jest.fn(async () => []) },
        // NO PUBLISHED OFFER, which is the state every case below was
        // written in. A product a buyer can reach is not editable at all
        // — «إذا نشره خلاص ما يقدر يعدل عليه» — and the case that proves
        // that refusal sets its own count.
        opportunity: { count: jest.fn(async () => 0) },
      }),
    ),
  };
  const service = new ProductsService(prisma as any, { log: jest.fn() } as any);
  return { service, prisma, update };
}

// -------------------------------------------------- clear vs omit

describe("an update writes null to clear, and nothing to omit", () => {
  it("passes an explicit null straight through to Prisma", async () => {
    const { service, update } = buildProducts();

    await service.update(PRODUCT, { descriptionAr: null } as never, CTX);

    expect(update.mock.calls[0][0].data.descriptionAr).toBeNull();
  });

  it("passes undefined for an omitted field, so the column is untouched", async () => {
    const { service, update } = buildProducts();

    await service.update(PRODUCT, { nameAr: "جديد" } as never, CTX);

    const data = update.mock.calls[0][0].data;
    expect(data.nameAr).toBe("جديد");
    expect(data.descriptionAr).toBeUndefined();
    expect(data.descriptionEn).toBeUndefined();
  });

  it("never coerces a null into an undefined on the way to the write", async () => {
    // A `??` anywhere in that data block would collapse the two and make
    // clearing impossible — which is the state this replaces.
    const { service, update } = buildProducts();

    await service.update(
      PRODUCT,
      { descriptionAr: null, descriptionEn: null, salesUnitId: null } as never,
      CTX
    );

    const data = update.mock.calls[0][0].data;
    expect(data.descriptionAr).toBeNull();
    expect(data.descriptionEn).toBeNull();
    expect(data.salesUnitId).toBeNull();
  });

  it("does not look up a sales unit that is being cleared", async () => {
    const { service, prisma } = buildProducts();

    await service.update(PRODUCT, { salesUnitId: null } as never, CTX);

    expect(prisma.salesUnit.findUnique).not.toHaveBeenCalled();
  });

  it("still validates a sales unit that is being SET", async () => {
    const { service, prisma } = buildProducts();

    await service.update(PRODUCT, { salesUnitId: "u-1" } as never, CTX);

    expect(prisma.salesUnit.findUnique).toHaveBeenCalled();
  });
});

describe("the package-content group clears as a unit", () => {
  it("accepts all three as null and writes three nulls", async () => {
    const { service, update } = buildProducts();

    await service.update(
      PRODUCT,
      {
        packageContentQuantity: null,
        packageContentUnitNameAr: null,
        packageContentUnitNameEn: null,
      } as never,
      CTX
    );

    const data = update.mock.calls[0][0].data;
    expect(data.packageContentQuantity).toBeNull();
    expect(data.packageContentUnitNameAr).toBeNull();
    expect(data.packageContentUnitNameEn).toBeNull();
  });

  it.each([
    [{ packageContentQuantity: null }],
    [{ packageContentQuantity: null, packageContentUnitNameAr: null }],
    [{ packageContentQuantity: null, packageContentUnitNameAr: "علبة", packageContentUnitNameEn: null }],
    [{ packageContentQuantity: 6, packageContentUnitNameAr: null, packageContentUnitNameEn: null }],
  ])("refuses a mixed clear: %j", async (body) => {
    const { service, update } = buildProducts();

    await expect(service.update(PRODUCT, body as never, CTX)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
    // Nothing was written — the check runs before the transaction opens.
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a partial SET against a row that has no group", async () => {
    const { service, update } = buildProducts(
      productRow({
        packageContentQuantity: null,
        packageContentUnitNameAr: null,
        packageContentUnitNameEn: null,
      })
    );

    await expect(
      service.update(PRODUCT, { packageContentQuantity: 6 } as never, CTX)
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    expect(update).not.toHaveBeenCalled();
  });

  it("accepts changing ONE field of a group the row already has complete", async () => {
    const { service, update } = buildProducts();

    await service.update(PRODUCT, { packageContentQuantity: 12 } as never, CTX);

    expect(update.mock.calls[0][0].data.packageContentQuantity).toBe(12);
  });
});

// ---------------------------------------------------------- reorder

describe("reorder requires exactly the current media, each once", () => {
  function buildMedia(existing: { id: string }[]) {
    const update = jest.fn(async (..._args: any[]) => ({}));
    const prisma = {
      productMedia: { findMany: jest.fn(async () => existing), update },
      $transaction: jest.fn(async (fn: any) =>
        fn({ product: { findUniqueOrThrow: jest.fn(async () => productRow()) }, productMedia: { update, findMany: jest.fn(async () => existing) } })
      ),
    };
    const products = {
      getOwnedProduct: jest.fn(async () => productRow()),
      assertEditableTx: jest.fn(async () => ({ requiresReapproval: false })),
      reapproveIfNeededTx: jest.fn(async () => false),
    };
    const service = new ProductMediaService(
      prisma as any,
      { log: jest.fn() } as any,
      {} as any,
      {} as any,
      products as any
    );
    return { service, update };
  }

  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  it("accepts a true permutation", async () => {
    const { service, update } = buildMedia([{ id: A }, { id: B }]);

    await service.reorder(PRODUCT, [B, A], CTX);

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][0]).toMatchObject({ where: { id: B }, data: { sortOrder: 0 } });
    expect(update.mock.calls[1][0]).toMatchObject({ where: { id: A }, data: { sortOrder: 1 } });
  });

  it("refuses a DUPLICATED id, and writes nothing", async () => {
    // The defect: the old guard compared length and membership only, so
    // [A, A] passed against [A, B] — A was written twice and B kept a
    // stale order, reported as success.
    const { service, update } = buildMedia([{ id: A }, { id: B }]);

    await expect(service.reorder(PRODUCT, [A, A], CTX)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a SHORT list", async () => {
    const { service, update } = buildMedia([{ id: A }, { id: B }]);

    await expect(service.reorder(PRODUCT, [A], CTX)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a LONG list", async () => {
    const { service, update } = buildMedia([{ id: A }, { id: B }]);

    await expect(service.reorder(PRODUCT, [A, B, C], CTX)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a FOREIGN id even when the count matches", async () => {
    const { service, update } = buildMedia([{ id: A }, { id: B }]);

    await expect(service.reorder(PRODUCT, [A, C], CTX)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an out-of-order duplicate too, not just an adjacent one", async () => {
    const { service, update } = buildMedia([{ id: A }, { id: B }, { id: C }]);

    await expect(service.reorder(PRODUCT, [A, B, A], CTX)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("writes sortOrder in the submitted order, and only once per id", async () => {
    const { service, update } = buildMedia([{ id: A }, { id: B }, { id: C }]);

    await service.reorder(PRODUCT, [C, A, B], CTX);

    expect(update.mock.calls.map((call) => (call[0] as any).where.id)).toEqual([C, A, B]);
    expect(update.mock.calls.map((call) => (call[0] as any).data.sortOrder)).toEqual([0, 1, 2]);
  });
});

// ------------------------------------------- closed technical checks

describe("technical-check failures are codes, never sentences", () => {
  it("returns only codes from the closed vocabulary", () => {
    const failures = runProductTechnicalChecks({
      nameAr: "",
      nameEn: "",
      salesUnitNameAr: "",
      salesUnitNameEn: "",
      packageContentQuantity: -1,
      packageContentUnitNameAr: null,
      packageContentUnitNameEn: null,
      weightPerUnit: 0,
      lengthCm: 0,
      widthCm: 0,
      heightCm: 0,
      hasMainImage: false,
    });

    expect(failures.length).toBeGreaterThan(0);
    for (const code of failures) {
      expect([code, isProductTechnicalCheckCode(code)]).toEqual([code, true]);
    }
  });

  it("returns nothing for a complete product", () => {
    expect(
      runProductTechnicalChecks({
        nameAr: "زيت",
        nameEn: "Oil",
        salesUnitNameAr: "كرتون",
        salesUnitNameEn: "Carton",
        packageContentQuantity: null,
        packageContentUnitNameAr: null,
        packageContentUnitNameEn: null,
        weightPerUnit: 1,
        lengthCm: 1,
        widthCm: 1,
        heightCm: 1,
        hasMainImage: true,
      })
    ).toEqual([]);
  });

  it("emits no English prose anywhere", () => {
    const failures = runProductTechnicalChecks({
      nameAr: "",
      nameEn: "Oil",
      salesUnitNameAr: "كرتون",
      salesUnitNameEn: "Carton",
      packageContentQuantity: null,
      packageContentUnitNameAr: null,
      packageContentUnitNameEn: null,
      weightPerUnit: 1,
      lengthCm: 1,
      widthCm: 1,
      heightCm: 1,
      hasMainImage: false,
    });

    expect(failures).toEqual(["NAME_AR_REQUIRED", "MAIN_IMAGE_REQUIRED"]);
    for (const code of failures) {
      expect(code).not.toMatch(/\s/);
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });

  it("maps every code to a form field", () => {
    for (const code of PRODUCT_TECHNICAL_CHECK_CODES) {
      expect([code, PRODUCT_TECHNICAL_CHECK_FIELDS[code]]).toEqual([
        code,
        expect.any(String),
      ]);
    }
    expect(Object.keys(PRODUCT_TECHNICAL_CHECK_FIELDS).sort()).toEqual(
      [...PRODUCT_TECHNICAL_CHECK_CODES].sort()
    );
  });

  it("carries the codes as details, with a fixed message that interpolates nothing", async () => {
    const { service } = buildProducts(
      productRow({ approvalStatus: "DRAFT", nameAr: "", nameEn: "", salesUnitNameAr: "", salesUnitNameEn: "", weightPerUnit: new Prisma.Decimal(0), lengthCm: new Prisma.Decimal(0), widthCm: new Prisma.Decimal(0), heightCm: new Prisma.Decimal(0) })
    );
    (service as any).prisma.company = {
      findUniqueOrThrow: jest.fn(async () => ({ verificationStatus: "VERIFIED" })),
    };

    let thrown: any;
    try {
      await service.submit(PRODUCT, CTX);
    } catch (err) {
      thrown = err;
    }

    expect(thrown.response.code).toBe("PRODUCT_TECHNICAL_CHECK_FAILED");
    expect(thrown.response.details.failedChecks).toContain("NAME_AR_REQUIRED");
    // Nothing from the checks is interpolated into the message.
    expect(thrown.response.message).toBe("Product cannot be auto-approved yet");
    for (const code of PRODUCT_TECHNICAL_CHECK_CODES) {
      expect(thrown.response.message).not.toContain(code);
    }
  });
});

describe("readFailedChecks opens for exactly one shape", () => {
  const good = {
    error: {
      code: "PRODUCT_TECHNICAL_CHECK_FAILED",
      message: "x",
      details: { failedChecks: ["NAME_AR_REQUIRED", "MAIN_IMAGE_REQUIRED"] },
    },
    requestId: "r",
  };

  it("reads the codes when everything matches", () => {
    expect(readFailedChecks(good)).toEqual(["NAME_AR_REQUIRED", "MAIN_IMAGE_REQUIRED"]);
  });

  it.each([
    ["a different error code", { ...good, error: { ...good.error, code: "VALIDATION_FAILED" } }],
    ["details as a string", { ...good, error: { ...good.error, details: "boom" } }],
    ["failedChecks as an object", { ...good, error: { ...good.error, details: { failedChecks: {} } } }],
    ["an empty array", { ...good, error: { ...good.error, details: { failedChecks: [] } } }],
    [
      "one unrecognised code",
      { ...good, error: { ...good.error, details: { failedChecks: ["NAME_AR_REQUIRED", "SOMETHING_ELSE"] } } },
    ],
    [
      "a raw sentence",
      { ...good, error: { ...good.error, details: { failedChecks: ["nameAr is required"] } } },
    ],
    ["no details at all", { ...good, error: { code: good.error.code, message: "x" } }],
    ["not an envelope", { hello: "world" }],
    ["null", null],
  ])("returns null for %s", (_label, body) => {
    expect(readFailedChecks(body)).toBeNull();
  });

  it("never surfaces an arbitrary details payload", () => {
    const leaky = {
      error: {
        code: "PRODUCT_TECHNICAL_CHECK_FAILED",
        message: "x",
        details: { failedChecks: ["NAME_AR_REQUIRED"], internalPath: "/srv/app/products.ts" },
      },
      requestId: "r",
    };

    // Only the codes come back; the sibling key is not read.
    expect(readFailedChecks(leaky)).toEqual(["NAME_AR_REQUIRED"]);
  });
});

// ------------------------------------------------ contract additions

describe("ProductDetail carries the sales-unit reference", () => {
  it("declares it on the key list", () => {
    expect([...PRODUCT_DETAIL_KEYS]).toContain("salesUnitId");
  });

  it("selects it, so an edit form can pre-select the picker", () => {
    expect(JSON.stringify(PRODUCT_DETAIL_SELECT)).toContain("salesUnitId");
  });

  it("returns it, and null when there is none", () => {
    const base = {
      id: PRODUCT,
      nameAr: "زيت",
      nameEn: "Oil",
      approvalStatus: "DRAFT",
      rejectionReason: null,
      salesUnitNameAr: "كرتون",
      salesUnitNameEn: "Carton",
      archivedAt: null,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      media: [],
      descriptionAr: null,
      descriptionEn: null,
      taxonomyNodeId: "n-1",
      weightPerUnit: new Prisma.Decimal("1"),
      lengthCm: new Prisma.Decimal("1"),
      widthCm: new Prisma.Decimal("1"),
      heightCm: new Prisma.Decimal("1"),
      packageContentQuantity: null,
      packageContentUnitNameAr: null,
      packageContentUnitNameEn: null,
    };

    expect(toProductDetail({ ...base, salesUnitId: "u-1" } as never).salesUnitId).toBe("u-1");
    expect(toProductDetail({ ...base, salesUnitId: null } as never).salesUnitId).toBeNull();
  });

  it("still returns exactly the declared keys", () => {
    const detail = toProductDetail({
      id: PRODUCT,
      nameAr: "زيت",
      nameEn: "Oil",
      approvalStatus: "DRAFT",
      rejectionReason: null,
      salesUnitNameAr: "كرتون",
      salesUnitNameEn: "Carton",
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      media: [],
      descriptionAr: null,
      descriptionEn: null,
      taxonomyNodeId: "n-1",
      salesUnitId: null,
      weightPerUnit: new Prisma.Decimal("1"),
      lengthCm: new Prisma.Decimal("1"),
      widthCm: new Prisma.Decimal("1"),
      heightCm: new Prisma.Decimal("1"),
      packageContentQuantity: null,
      packageContentUnitNameAr: null,
      packageContentUnitNameEn: null,
    } as never);

    expect(Object.keys(detail).sort()).toEqual([...PRODUCT_DETAIL_KEYS].sort());
  });
});

describe("the sales-unit list is projected, not a raw row", () => {
  it("selects exactly the contract's keys", async () => {
    const findMany = jest.fn(async (..._args: any[]) => []);
    const service = new SalesUnitsService({ salesUnit: { findMany } } as any, { log: jest.fn() } as any);

    await service.listActiveProjected();

    const args = findMany.mock.calls[0][0] as any;
    expect(Object.keys(args.select).sort()).toEqual([...SALES_UNIT_ITEM_KEYS].sort());
  });

  it("leaks no isActive or timestamp", async () => {
    const findMany = jest.fn(async (..._args: any[]) => []);
    const service = new SalesUnitsService({ salesUnit: { findMany } } as any, { log: jest.fn() } as any);

    await service.listActiveProjected();

    const select = JSON.stringify((findMany.mock.calls[0][0] as any).select);
    for (const forbidden of ["isActive", "createdAt", "updatedAt"]) {
      expect([forbidden, select.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("orders deterministically, terminating in the id", async () => {
    // `sortOrder` defaults to 0 for every unit and `createdAt` can tie,
    // so without `id` a picker could reorder itself between requests.
    const findMany = jest.fn(async (..._args: any[]) => []);
    const service = new SalesUnitsService({ salesUnit: { findMany } } as any, { log: jest.fn() } as any);

    await service.listActiveProjected();

    expect((findMany.mock.calls[0][0] as any).orderBy).toEqual([
      { sortOrder: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  it("returns only active units", async () => {
    const findMany = jest.fn(async (..._args: any[]) => []);
    const service = new SalesUnitsService({ salesUnit: { findMany } } as any, { log: jest.fn() } as any);

    await service.listActiveProjected();

    expect((findMany.mock.calls[0][0] as any).where).toEqual({ isActive: true });
  });
});
