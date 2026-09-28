import { ListingsService } from "../listings/listings.service";
import { ProductsService } from "../products/products.service";
import { removalVerdict } from "./removal";

/**
 * ONE RULE, FOUR DOORS — and the defect that made it necessary.
 *
 * «عندي مشكلة في المنتجات: إذا حذفت العرض الموجود وهو مسودة ما يجيني حذف
 *  المنتج في صفحة المورّد… منتجين انحذفوا من صفحات الإدارة لكنهم باقين
 *  في صفحة المورّد.»
 *
 * WHAT ACTUALLY HAPPENED, from the audit log: deleting a DRAFT offer
 * nobody had ever seen ARCHIVED the product under it. The old rule
 * deleted both rows when the product carried no approval snapshot and
 * archived the product when it did — and a snapshot is written the
 * moment a product is APPROVED, not when it is published, so every real
 * product carried one and the archive branch was the only branch that
 * ever ran. Archiving is a one-way door: no edit, no offer, no submit,
 * no unarchive. Two products ended up there.
 *
 * SO THESE TESTS ARE ABOUT WHAT IS NOT TOUCHED as much as what is.
 */

const ctx = {
  userId: "user-1",
  companyId: "company-1",
  requestId: "req-1",
};

/** Nobody has been near this offer. */
const untouched = () => ({
  checkoutSession: { count: jest.fn().mockResolvedValue(0) },
  masterOrder: { count: jest.fn().mockResolvedValue(0) },
  opportunity: { count: jest.fn().mockResolvedValue(0) },
});

describe("removalVerdict — three witnesses to a payment", () => {
  it("says nothing happened when nothing happened", async () => {
    const db = untouched();
    await expect(removalVerdict(db as never, ["o1"])).resolves.toEqual({
      liveCheckout: false,
      paid: false,
    });
  });

  it("asks nothing at all when there are no offers to ask about", async () => {
    // A product with no offers cannot have been bought, and four counts
    // against an empty `IN ()` is four round trips for a known answer.
    const db = untouched();
    await expect(removalVerdict(db as never, [])).resolves.toEqual({
      liveCheckout: false,
      paid: false,
    });
    expect(db.checkoutSession.count).not.toHaveBeenCalled();
  });

  it("sees a live basket, and does not call it a payment", async () => {
    // The two are different answers: this one stops being true on its
    // own when the lock expires.
    const db = untouched();
    db.checkoutSession.count = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    await expect(removalVerdict(db as never, ["o1"])).resolves.toEqual({
      liveCheckout: true,
      paid: false,
    });
  });

  it.each([
    ["a paid basket", { paidSessions: 1 }],
    ["a master order", { orders: 1 }],
    ["the offer's own funded quantity", { funded: 1 }],
  ])("sees a payment through %s", async (_name, counts) => {
    const db = untouched();
    db.checkoutSession.count = jest
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce((counts as { paidSessions?: number }).paidSessions ?? 0);
    db.masterOrder.count = jest
      .fn()
      .mockResolvedValue((counts as { orders?: number }).orders ?? 0);
    db.opportunity.count = jest
      .fn()
      .mockResolvedValue((counts as { funded?: number }).funded ?? 0);

    await expect(removalVerdict(db as never, ["o1"])).resolves.toMatchObject({
      paid: true,
    });
  });
});

describe("ListingsService.remove — the offer, and only the offer", () => {
  const LISTING = {
    id: "opp-1",
    productId: "p1",
    status: "DRAFT",
  };

  function build(tx: Record<string, unknown>) {
    const prisma = {
      opportunity: { findFirst: jest.fn().mockResolvedValue(LISTING) },
      $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
    };
    const products = { archive: jest.fn() };
    const service = new ListingsService(
      prisma as never,
      products as never,
      {} as never,
      {} as never,
      { log: jest.fn() } as never
    );
    return { service, prisma, products };
  }

  const deleteTx = (counts: { live?: number; paid?: number; funded?: number } = {}) => ({
    ...untouched(),
    checkoutSession: {
      count: jest
        .fn()
        .mockResolvedValueOnce(counts.live ?? 0)
        .mockResolvedValueOnce(counts.paid ?? 0),
      findMany: jest.fn().mockResolvedValue([{ id: "dead-1" }]),
      deleteMany: jest.fn(),
    },
    masterOrder: { count: jest.fn().mockResolvedValue(0) },
    opportunity: {
      count: jest.fn().mockResolvedValue(counts.funded ?? 0),
      deleteMany: jest.fn(),
    },
    checkoutLocationAllocation: { deleteMany: jest.fn() },
    quoteSnapshot: { deleteMany: jest.fn() },
    paymentAttempt: { deleteMany: jest.fn() },
  });

  it("NEVER archives the product — the defect this replaces", async () => {
    const tx = deleteTx();
    const { service, products } = build(tx);

    await expect(service.remove("opp-1", ctx)).resolves.toEqual({
      removed: "DELETED",
    });

    // THE WHOLE POINT. A product is a record of its own; it outlives any
    // one offer, and it has its own delete now.
    expect(products.archive).not.toHaveBeenCalled();
    expect(tx.opportunity.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["opp-1"] } },
    });
  });

  it("takes the abandoned baskets with it, deepest first", async () => {
    const tx = deleteTx();
    const { service } = build(tx);

    await service.remove("opp-1", ctx);

    expect(tx.checkoutLocationAllocation.deleteMany).toHaveBeenCalled();
    expect(tx.quoteSnapshot.deleteMany).toHaveBeenCalled();
    expect(
      tx.checkoutLocationAllocation.deleteMany.mock.invocationCallOrder[0]
    ).toBeLessThan(tx.checkoutSession.deleteMany.mock.invocationCallOrder[0]);
    expect(
      tx.checkoutSession.deleteMany.mock.invocationCallOrder[0]
    ).toBeLessThan(tx.opportunity.deleteMany.mock.invocationCallOrder[0]);
  });

  it("refuses, permanently, once a buyer has paid", async () => {
    const tx = deleteTx({ paid: 1 });
    const { service } = build(tx);

    await expect(service.remove("opp-1", ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "BUYER_ALREADY_PAID" }),
    });
    expect(tx.opportunity.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses, temporarily, while a buyer is checking out", async () => {
    const tx = deleteTx({ live: 1 });
    const { service } = build(tx);

    await expect(service.remove("opp-1", ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "BUYER_CHECKOUT_IN_PROGRESS" }),
    });
    expect(tx.opportunity.deleteMany).not.toHaveBeenCalled();
  });
});

describe("ProductsService.remove — the supplier's own delete", () => {
  const PRODUCT = {
    id: "p1",
    companyId: "company-1",
    nameAr: "منظمات رفوف",
    nameEn: "Shelf organisers",
    approvalStatus: "APPROVED",
    archivedAt: new Date("2026-09-06T04:01:25.172Z"),
  };

  const deleteTx = (
    counts: { live?: number; paid?: number } = {},
    offers: string[] = []
  ) => ({
    checkoutSession: {
      count: jest
        .fn()
        .mockResolvedValueOnce(counts.live ?? 0)
        .mockResolvedValueOnce(counts.paid ?? 0),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    },
    masterOrder: { count: jest.fn().mockResolvedValue(0) },
    opportunity: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue(offers.map((id) => ({ id }))),
      deleteMany: jest.fn(),
    },
    checkoutLocationAllocation: { deleteMany: jest.fn() },
    quoteSnapshot: { deleteMany: jest.fn() },
    paymentAttempt: { deleteMany: jest.fn() },
    productReport: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    productReportEvidence: { deleteMany: jest.fn() },
    productApprovalSnapshot: { deleteMany: jest.fn() },
    productMedia: { deleteMany: jest.fn() },
    product: { delete: jest.fn() },
    auditLog: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
  });

  function build(tx: Record<string, unknown>) {
    const prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(PRODUCT) },
      $transaction: jest.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
    };
    return new ProductsService(prisma as never, { log: jest.fn() } as never);
  }

  it("erases an ARCHIVED product — the way out of the one-way door", async () => {
    // THE TWO ROWS THAT STARTED THIS. Archived, APPROVED, no offers, and
    // no action available anywhere: not on the supplier's page, because
    // every write is refused, and not in the console, because nobody
    // knew they were there.
    const tx = deleteTx();
    const service = build(tx);

    await expect(service.remove("p1", ctx)).resolves.toEqual({
      id: "p1",
      deleted: true,
      offersDeleted: 0,
    });
    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    // The snapshot goes with it: the database refuses that only while a
    // PUBLISHED offer still reads it, and the offers went first.
    expect(tx.productApprovalSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { productId: "p1" },
    });
  });

  it("writes the audit entry BEFORE the rows go, carrying the identity", async () => {
    // Afterwards there is nothing left for an entity id to join to, so
    // the log holds the evidence rather than a pointer to it.
    const tx = deleteTx();
    await build(tx).remove("p1", ctx);

    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PRODUCT_DELETED",
          actorType: "USER",
          beforeData: expect.objectContaining({ nameAr: "منظمات رفوف" }),
        }),
      })
    );
    expect(tx.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.product.delete.mock.invocationCallOrder[0]
    );
  });

  it("refuses once a buyer has paid for one of its offers", async () => {
    // THE PRODUCT IS ASKED THROUGH ITS OFFERS: a payment is made on an
    // offer, never on a product, so a product with none cannot have
    // been bought and is not asked about at all.
    const tx = deleteTx({ paid: 1 }, ["o1"]);
    await expect(build(tx).remove("p1", ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "BUYER_ALREADY_PAID" }),
    });
    expect(tx.product.delete).not.toHaveBeenCalled();
  });
});
