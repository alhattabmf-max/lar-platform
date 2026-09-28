import { NotFoundException } from "@nestjs/common";
import { AdminProductsService } from "./admin-products.service";
import type { AdminUpdateProductDto } from "./dto/admin-update-product.dto";

/**
 * The administrative edit — «تعديل بصلاحية كاملة، مسجَّل في التدقيق».
 *
 * WHAT THESE TESTS ARE ACTUALLY GUARDING is the difference between this
 * path and the supplier's own: the supplier is refused an edit while a
 * buyer can reach the product, and support exists for exactly the cases
 * the supplier cannot fix. If someone later "tidies" the admin edit by
 * routing it through `assertEditableTx`, the first test here fails —
 * which is the point of writing it down.
 *
 * And the second half of the permission is the record. An edit that
 * commits without an audit entry naming who made it, with the value
 * before and the value after, is an anonymous change to somebody else's
 * property; three of these tests are about that entry.
 */

const ctx = { requestId: "req-1", ipAddress: "10.0.0.1", userAgent: "jest" };

const decimal = (value: number) => ({ toNumber: () => value }) as never;

const PRODUCT = {
  id: "p1",
  companyId: "c1",
  approvalStatus: "APPROVED",
  taxonomyNodeId: "node-1",
  salesUnitId: null,
  salesUnitNameAr: "حبة",
  salesUnitNameEn: "Piece",
  packageContentQuantity: null,
  packageContentUnitNameAr: null,
  packageContentUnitNameEn: null,
  nameAr: "زيت",
  nameEn: "Oil",
  descriptionAr: null,
  descriptionEn: null,
  weightPerUnit: decimal(1.5),
  lengthCm: decimal(10),
  widthCm: decimal(10),
  heightCm: decimal(10),
};

function build(
  overrides: {
    product?: Record<string, unknown> | null;
    reapproved?: boolean;
    products?: Record<string, unknown>;
  } = {},
) {
  const product =
    overrides.product === undefined ? PRODUCT : overrides.product;
  const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    ...product,
    ...data,
  }));
  const tx = { product: { update } };

  const prisma = {
    product: { findUnique: jest.fn().mockResolvedValue(product) },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  } as never;

  const log = jest.fn();
  const products = {
    requireActiveTaxonomyNode: jest.fn(),
    requireActiveSalesUnit: jest.fn(),
    requirePackageContentGroupComplete: jest.fn(),
    requirePackageContentClearIsWholeGroup: jest.fn(),
    reapproveIfNeededTx: jest.fn().mockResolvedValue(overrides.reapproved ?? false),
    ...overrides.products,
  };

  return {
    service: new AdminProductsService(prisma, { log } as never, products as never),
    log,
    update,
    products,
  };
}

const edit = (dto: Partial<AdminUpdateProductDto>) => dto as AdminUpdateProductDto;

describe("AdminProductsService.updateAsAdmin", () => {
  it("edits a product a buyer can reach — the supplier's live-offer lock is not applied", async () => {
    // `assertEditableTx` is the supplier's refusal and is deliberately
    // never called here. Were it called, this edit would throw 409
    // PRODUCT_HAS_LIVE_OFFER regardless of what the fakes returned.
    const assertEditableTx = jest.fn();
    const { service, update } = build({ products: { assertEditableTx } });

    await service.updateAsAdmin("p1", edit({ nameAr: "زيت ذرة" }), "admin-1", ctx);

    expect(assertEditableTx).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nameAr: "زيت ذرة" }) }),
    );
  });

  it("records ONLY the fields that changed, with the value before and after", async () => {
    const { service, log } = build();

    await service.updateAsAdmin(
      "p1",
      edit({ nameAr: "زيت ذرة", nameEn: "Oil", weightPerUnit: 2.25 }),
      "admin-1",
      ctx,
    );

    const entry = log.mock.calls[0][0];
    expect(entry).toMatchObject({
      actorType: "ADMIN",
      actorId: "admin-1",
      companyId: "c1",
      action: "PRODUCT_EDITED_BY_ADMIN",
      entityType: "product",
      entityId: "p1",
    });
    // `nameEn` was sent unchanged and must not appear on either side.
    expect(entry.before).toEqual({ nameAr: "زيت", weightPerUnit: 1.5 });
    expect(entry.after).toEqual({ nameAr: "زيت ذرة", weightPerUnit: 2.25 });
  });

  it("writes the audit entry in the SAME transaction as the change", async () => {
    const { service, log } = build();

    await service.updateAsAdmin("p1", edit({ nameAr: "زيت ذرة" }), "admin-1", ctx);

    // The second argument is the transaction client. Without it the row
    // could commit while the entry naming its author is lost.
    expect(log.mock.calls[0][1]).toBeDefined();
  });

  it("keeps an optional note on the entry, and accepts none", async () => {
    const withNote = build();
    await withNote.service.updateAsAdmin(
      "p1",
      edit({ nameAr: "زيت ذرة", reason: "بلاغ مشتري رقم ٤" }),
      "admin-1",
      ctx,
    );
    expect(withNote.log.mock.calls[0][0].reason).toBe("بلاغ مشتري رقم ٤");
    // The note is not a column — it must never reach the product row.
    expect(withNote.update.mock.calls[0][0].data).not.toHaveProperty("reason");

    const without = build();
    await without.service.updateAsAdmin("p1", edit({ nameAr: "زيت ذرة" }), "admin-1", ctx);
    expect(without.log.mock.calls[0][0].reason).toBeUndefined();
  });

  it("writes nothing and records nothing when no value actually changes", async () => {
    const { service, log, update } = build();

    const result = await service.updateAsAdmin(
      "p1",
      edit({ nameAr: "زيت", weightPerUnit: 1.5, descriptionAr: null }),
      "admin-1",
      ctx,
    );

    expect(update).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(result).toBe(PRODUCT);
  });

  it("clearing a nullable field IS a change, and is recorded as null", async () => {
    const { service, log } = build({
      product: { ...PRODUCT, descriptionAr: "وصف قديم" },
    });

    await service.updateAsAdmin("p1", edit({ descriptionAr: null }), "admin-1", ctx);

    expect(log.mock.calls[0][0].before).toEqual({ descriptionAr: "وصف قديم" });
    expect(log.mock.calls[0][0].after).toEqual({ descriptionAr: null });
  });

  it("enforces the supplier's own validity rules rather than restating them", async () => {
    const { service, products } = build();

    await service.updateAsAdmin(
      "p1",
      edit({ taxonomyNodeId: "node-2", salesUnitId: "unit-2" }),
      "admin-1",
      ctx,
    );

    expect(products.requireActiveTaxonomyNode).toHaveBeenCalledWith("node-2");
    expect(products.requireActiveSalesUnit).toHaveBeenCalledWith("unit-2");
    expect(products.requirePackageContentClearIsWholeGroup).toHaveBeenCalled();
    expect(products.requirePackageContentGroupComplete).toHaveBeenCalled();
  });

  it("re-approves an APPROVED product through the supplier's own path, and says so", async () => {
    const { service, log, products } = build({ reapproved: true });

    await service.updateAsAdmin("p1", edit({ nameAr: "زيت ذرة" }), "admin-1", ctx);

    expect(products.reapproveIfNeededTx).toHaveBeenCalledWith(
      expect.anything(),
      "p1",
      true,
    );
    expect(log.mock.calls[1][0]).toMatchObject({
      actorType: "SYSTEM",
      action: "PRODUCT_AUTO_REAPPROVED_ON_EDIT",
      entityId: "p1",
    });
  });

  it("does not re-approve a product that is not APPROVED", async () => {
    const { service, products } = build({
      product: { ...PRODUCT, approvalStatus: "SUSPENDED" },
    });

    await service.updateAsAdmin("p1", edit({ nameAr: "زيت ذرة" }), "admin-1", ctx);

    expect(products.reapproveIfNeededTx).toHaveBeenCalledWith(
      expect.anything(),
      "p1",
      false,
    );
  });

  it("404s on an unknown product before touching anything", async () => {
    const { service, update } = build({ product: null });

    await expect(
      service.updateAsAdmin("missing", edit({ nameAr: "x" }), "admin-1", ctx),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });
});
