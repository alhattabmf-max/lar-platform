import { NotFoundException } from "@nestjs/common";
import { AdminProductsService } from "./admin-products.service";

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    ...overrides,
    product: {
      findUnique: jest.fn().mockResolvedValue(null),
      ...(overrides.product as Record<string, unknown> | undefined),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(overrides.tx ?? {})),
  } as never;
}

const ctx = { requestId: "req-1" };

/**
 * The supplier write rules the admin service now delegates to.
 *
 * A STUB, because nothing in this file exercises them: these tests cover
 * suspend, close, reactivate and delete, none of which writes a product
 * FIELD. The edit path that does call them is covered by its own file,
 * against the real ProductsService.
 */
const productsStub = () =>
  ({
    requireActiveTaxonomyNode: jest.fn(),
    requireActiveSalesUnit: jest.fn(),
    requirePackageContentGroupComplete: jest.fn(),
    requirePackageContentClearIsWholeGroup: jest.fn(),
    reapproveIfNeededTx: jest.fn().mockResolvedValue(false),
  }) as never;

const DEFAULT_PRODUCT_ROW = {
  id: "p1",
  companyId: "c1",
  approvalStatus: "APPROVED",
  nameAr: "a",
  nameEn: "a",
  descriptionAr: null,
  descriptionEn: null,
  taxonomyNodeId: "node-1",
  salesUnitNameAr: "a",
  salesUnitNameEn: "a",
  packageContentQuantity: null,
  packageContentUnitNameAr: null,
  packageContentUnitNameEn: null,
  weightPerUnit: { toString: () => "1" },
  lengthCm: { toString: () => "1" },
  widthCm: { toString: () => "1" },
  heightCm: { toString: () => "1" },
};

function buildTx(queryRawResults: unknown[][], productRow: Record<string, unknown> = DEFAULT_PRODUCT_ROW) {
  let call = 0;
  const queryRaw = jest.fn(async () => queryRawResults[call++] ?? []);
  return {
    $queryRaw: queryRaw,
    product: {
      findUnique: jest.fn().mockResolvedValue(productRow),
      findUniqueOrThrow: jest.fn().mockResolvedValue(productRow),
    },
    productMedia: { findMany: jest.fn().mockResolvedValue([]) },
    productApprovalSnapshot: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
  };
}

describe("AdminProductsService — suspend/close/reactivate (atomic claim + cascade)", () => {
  describe("suspend", () => {
    it("rejects when the atomic claim matches nothing (not APPROVED)", async () => {
      const tx = buildTx([[]], { id: "p1", companyId: "c1", approvalStatus: "SUSPENDED" });
      const prisma = fakePrisma({ tx });
      const service = new AdminProductsService(prisma, { log: jest.fn() } as never, productsStub());

      await expect(service.suspend("p1", "report confirmed", "admin-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONFLICT" }),
      });
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when the product truly does not exist", async () => {
      const tx = buildTx([[]]);
      tx.product.findUnique = jest.fn().mockResolvedValue(null);
      const prisma = fakePrisma({ tx });
      const service = new AdminProductsService(prisma, { log: jest.fn() } as never, productsStub());

      await expect(service.suspend("missing", "x", "admin-1", ctx)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("claims APPROVED->SUSPENDED, writes product audit+outbox, then cascades SCHEDULED->ACTION_REQUIRED and ACTIVE->PAUSED atomically", async () => {
      const tx = buildTx([
        [{ id: "p1", company_id: "c1" }],
        [{ id: "opp-scheduled", company_id: "c1" }],
        [{ id: "opp-active", company_id: "c1" }],
      ]);
      const prisma = fakePrisma({ tx });
      const service = new AdminProductsService(prisma, { log: jest.fn() } as never, productsStub());

      await service.suspend("p1", "report confirmed", "admin-1", ctx);

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "PRODUCT_SUSPENDED" }) })
      );
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: "OPPORTUNITY_ACTION_REQUIRED_PRODUCT_CASCADE", entityId: "opp-scheduled" }),
        })
      );
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: "OPPORTUNITY_PAUSED_PRODUCT_CASCADE", entityId: "opp-active" }),
        })
      );
      expect(tx.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ eventType: "PRODUCT_SUSPENDED" }) })
      );
    });
  });

  describe("close", () => {
    it("rejects from DRAFT (not APPROVED or SUSPENDED)", async () => {
      const tx = buildTx([[]], { id: "p1", companyId: "c1", approvalStatus: "DRAFT" });
      const prisma = fakePrisma({ tx });
      const service = new AdminProductsService(prisma, { log: jest.fn() } as never, productsStub());

      await expect(service.close("p1", "violation", "admin-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONFLICT" }),
      });
    });

    it("claims APPROVED->CLOSED and cascades SCHEDULED/ACTIVE/PAUSED -> CANCELLED, but never touches ACTION_REQUIRED (no such edge in the transitions table)", async () => {
      const tx = buildTx([
        [{ id: "p1", company_id: "c1" }],
        [
          { id: "opp-1", company_id: "c1" },
          { id: "opp-2", company_id: "c1" },
        ],
      ]);
      const prisma = fakePrisma({ tx });
      const service = new AdminProductsService(prisma, { log: jest.fn() } as never, productsStub());

      await service.close("p1", "safety violation", "admin-1", ctx);

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "PRODUCT_CLOSED" }) })
      );
      const cascadeCalls = (tx.auditLog.create as jest.Mock).mock.calls.filter(
        (c) => c[0].data.action === "OPPORTUNITY_CANCELLED_PRODUCT_CASCADE"
      );
      expect(cascadeCalls).toHaveLength(2);

      const cascadeQueryCall = (tx.$queryRaw as jest.Mock).mock.calls[1];
      const sqlText = cascadeQueryCall[0].join("");
      expect(sqlText).not.toContain("ACTION_REQUIRED");
    });

    it("claims SUSPENDED->CLOSED too", async () => {
      const tx = buildTx([[{ id: "p1", company_id: "c1" }], []], {
        id: "p1",
        companyId: "c1",
        approvalStatus: "SUSPENDED",
      });
      const prisma = fakePrisma({ tx });
      const service = new AdminProductsService(prisma, { log: jest.fn() } as never, productsStub());

      await service.close("p1", "escalated", "admin-1", ctx);
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "PRODUCT_CLOSED" }) })
      );
    });
  });

  describe("reactivate", () => {
    it("rejects from CLOSED — permanent, never reactivated", async () => {
      const tx = buildTx([[]], { id: "p1", companyId: "c1", approvalStatus: "CLOSED" });
      const prisma = fakePrisma({ tx });
      const service = new AdminProductsService(prisma, { log: jest.fn() } as never, productsStub());

      await expect(service.reactivate("p1", "admin-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONFLICT" }),
      });
    });

    it("claims SUSPENDED->APPROVED, creates a new ADMIN-sourced snapshot, does NOT touch any opportunity", async () => {
      const tx = buildTx([[{ id: "p1" }]], { ...DEFAULT_PRODUCT_ROW, approvalStatus: "SUSPENDED" });
      const prisma = fakePrisma({ tx });
      const service = new AdminProductsService(prisma, { log: jest.fn() } as never, productsStub());

      await service.reactivate("p1", "admin-1", ctx);

      expect(tx.productApprovalSnapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ approvalSource: "ADMIN", approvedByAdminId: "admin-1" }),
        })
      );
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "PRODUCT_REACTIVATED" }) })
      );
      expect((tx.$queryRaw as jest.Mock).mock.calls.length).toBe(1);
    });
  });
});

describe("AdminProductsService — deletePermanently", () => {
  // «أنا صاحب منصة لي جميع التحكم فيها، أريد حذف منتج بكل بساطة»،
  // «أنت تحمي منتجًا معتمدًا وليس عليه أي حركة، لذلك هذا عيب»،
  // «الميتة أريد أن أقدر أحذفها».
  //
  // A PAYMENT IS THE LINE, AND ONLY A PAYMENT — «دام المشتري ما بعد
  // دفع». This used to refuse on any checkout session at all, which
  // was not caution but a guess about what the database would allow,
  // and the guess was wrong in both directions: it blocked products
  // nothing had been built on, and it let others through to die on a
  // trigger with a raw Postgres error.
  //
  // THE THREE WITNESSES ARE THE VERDICT'S OWN. `live` is a basket
  // somebody is holding, `paid` is one they paid for, `orders` is the
  // platform's copy of that — and the rule is asked from
  // `common/removal.ts`, which the supplier's own delete asks too.
  function deleteTx(
    counts: { orders: number; live?: number; paid?: number; funded?: number },
    offers: string[] = ["o1"],
    sessions: string[] = ["s1"],
  ) {
    return {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: "p1",
          companyId: "c1",
          approvalStatus: "CLOSED",
          nameAr: "منتج",
          nameEn: "product",
        }),
        delete: jest.fn(),
      },
      opportunity: {
        findMany: jest.fn().mockResolvedValue(offers.map((id) => ({ id }))),
        deleteMany: jest.fn(),
        count: jest.fn().mockResolvedValue(counts.funded ?? 0),
      },
      masterOrder: { count: jest.fn().mockResolvedValue(counts.orders) },
      checkoutSession: {
        findMany: jest.fn().mockResolvedValue(sessions.map((id) => ({ id }))),
        deleteMany: jest.fn(),
        // The verdict takes the live count first and the paid count
        // second, in that order.
        count: jest
          .fn()
          .mockResolvedValueOnce(counts.live ?? 0)
          .mockResolvedValueOnce(counts.paid ?? 0),
      },
      checkoutLocationAllocation: { deleteMany: jest.fn() },
      quoteSnapshot: { deleteMany: jest.fn() },
      paymentAttempt: { deleteMany: jest.fn() },
      productReport: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      productReportEvidence: { deleteMany: jest.fn() },
      productApprovalSnapshot: { deleteMany: jest.fn() },
      productMedia: { deleteMany: jest.fn() },
      auditLog: { create: jest.fn() },
      outboxEvent: { create: jest.fn() },
    };
  }

  const build = (tx: unknown) =>
    new AdminProductsService(fakePrisma({ tx }), { log: jest.fn() } as never, productsStub());

  it("erases the product, its snapshots and its dead checkouts", async () => {
    const tx = deleteTx({ orders: 0 });
    const result = await build(tx).deletePermanently("p1", undefined, "admin-1", ctx);

    expect(result).toEqual({ id: "p1", deleted: true, offersDeleted: 1 });
    // DEEPEST FIRST — the allocation and the quote hang off the session,
    // and the deferred sum check refuses a partial delete that leaves
    // the session behind, correctly, because the total stops matching.
    expect(tx.checkoutLocationAllocation.deleteMany).toHaveBeenCalled();
    expect(tx.quoteSnapshot.deleteMany).toHaveBeenCalled();
    expect(tx.checkoutSession.deleteMany).toHaveBeenCalled();
    expect(
      tx.checkoutLocationAllocation.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.checkoutSession.deleteMany.mock.invocationCallOrder[0]);
    expect(
      tx.checkoutSession.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.opportunity.deleteMany.mock.invocationCallOrder[0]);
    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
  });

  it("REFUSES when an order stands on one of its offers", async () => {
    // A master order names an opportunity, and an invoice and a ledger
    // entry stand on that. Erase it and the invoice cannot say what was
    // invoiced. Closing is the answer, and no rule will ever release it.
    await expect(
      build(deleteTx({ orders: 1 })).deletePermanently("p1", undefined, "admin-1", ctx)
    ).rejects.toMatchObject({ status: 409 });

    // ITS OWN CODE, read from the RESPONSE where BusinessException puts
    // it: the console translates by code and never shows the server's
    // own sentence, so a shared CONFLICT reached the owner as «تعارض مع
    // الحالة الحالية للعنصر» — neither the cause nor the next step.
    await expect(
      build(deleteTx({ orders: 1 }))
        .deletePermanently("p1", undefined, "admin-1", ctx)
        .catch((e) => {
          throw e.getResponse();
        })
    ).rejects.toMatchObject({ code: "BUYER_ALREADY_PAID" });

    const tx = deleteTx({ orders: 1 });
    await expect(
      build(tx).deletePermanently("p1", undefined, "admin-1", ctx)
    ).rejects.toBeDefined();
    expect(tx.product.delete).not.toHaveBeenCalled();
    expect(tx.checkoutLocationAllocation.deleteMany).not.toHaveBeenCalled();
  });

  it("REFUSES, temporarily, while somebody is checking out", async () => {
    // NOT THE SAME REFUSAL. Nothing has been paid and nothing is owed;
    // somebody is simply holding a lock at this moment, and the lock
    // expires on its own. Telling the owner to stop when all he had to
    // do was wait is what the separate code is for.
    const tx = deleteTx({ orders: 0, live: 1 });
    await expect(
      build(tx).deletePermanently("p1", undefined, "admin-1", ctx).catch((e) => {
        throw e.getResponse();
      })
    ).rejects.toMatchObject({ code: "BUYER_CHECKOUT_IN_PROGRESS" });
    expect(tx.product.delete).not.toHaveBeenCalled();
  });

  it("REFUSES when the offer itself says it was funded", async () => {
    // THREE WITNESSES, ANY ONE OF THEM ENOUGH. The webhook writes all
    // three in one transaction, so in practice they agree — and a row
    // that lost its partner still speaks.
    const tx = deleteTx({ orders: 0, funded: 1 });
    await expect(
      build(tx).deletePermanently("p1", undefined, "admin-1", ctx)
    ).rejects.toMatchObject({ status: 409 });
    expect(tx.product.delete).not.toHaveBeenCalled();
  });

  it("does NOT refuse over an abandoned checkout", async () => {
    // The whole point of the change. A page somebody opened and walked
    // away from carries no money, no invoice and no ledger entry.
    const tx = deleteTx({ orders: 0 }, ["o1"], ["dead-1", "dead-2"]);
    await expect(
      build(tx).deletePermanently("p1", undefined, "admin-1", ctx)
    ).resolves.toMatchObject({ deleted: true });
    expect(tx.checkoutSession.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["dead-1", "dead-2"] } },
    });
  });

  it("takes no reason, and still records who and what", async () => {
    // «بدون أن يطلب مني سبب» — the owner removing his own row has no
    // second reader. The entry still carries the identity itself,
    // because after the transaction nothing is left to join an id to.
    const tx = deleteTx({ orders: 0 });
    await build(tx).deletePermanently("p1", undefined, "admin-1", ctx);

    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "PRODUCT_DELETED",
          reason: null,
          beforeData: expect.objectContaining({ nameAr: "منتج", offerCount: 1 }),
        }),
      })
    );
    expect(tx.auditLog.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.product.delete.mock.invocationCallOrder[0]
    );
  });

  it("keeps a reason when one is given", async () => {
    const tx = deleteTx({ orders: 0 });
    await build(tx).deletePermanently("p1", "duplicate row", "admin-1", ctx);
    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: "duplicate row" }),
      })
    );
  });

  it("is a 404 for a product that is not there", async () => {
    const tx = deleteTx({ orders: 0 });
    tx.product.findUnique = jest.fn().mockResolvedValue(null);

    await expect(
      build(tx).deletePermanently("nope", undefined, "admin-1", ctx)
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
