import { NotFoundException } from "@nestjs/common";
import { AccountType, OpportunityStatus, Prisma } from "@prisma/client";
import { OpportunitiesService } from "./opportunities.service";

/**
 * A PRISMA THAT ANSWERS EVERYTHING, and says what a test tells it to.
 *
 * THE OVERRIDES MERGE PER MODEL rather than replacing it. A test that
 * wants a particular `opportunity.findFirst` is saying what that ONE
 * call returns — not that the offer table has no other methods — and
 * when a new rule starts asking a new question (here: has any buyer
 * paid?) replacement turns every such test into a TypeError about a
 * method the test never meant to remove.
 */
function fakePrisma(overrides: Record<string, unknown> = {}) {
  const base = {
    company: { findUniqueOrThrow: jest.fn() },
    product: { findFirst: jest.fn() },
    companyLocation: { findFirst: jest.fn() },
    opportunity: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    // THE BUYER'S VETO, ASKED ON EVERY EDIT. `assertNoBuyerCommitted`
    // counts live baskets, paid baskets, orders and funded offers;
    // the default here is an offer nobody has touched, which is what
    // all but the tests that say otherwise are about.
    checkoutSession: { count: jest.fn().mockResolvedValue(0) },
    masterOrder: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(),
  } as Record<string, unknown>;

  const merged: Record<string, unknown> = { ...base };
  for (const [model, value] of Object.entries(overrides)) {
    const existing = merged[model];
    merged[model] =
      existing && typeof existing === "object" && value && typeof value === "object"
        ? { ...(existing as object), ...(value as object) }
        : value;
  }
  return merged as never;
}

const auditStub = { log: jest.fn().mockResolvedValue(undefined) } as never;
const opportunitySettingsStub = {
  getConfig: jest.fn().mockResolvedValue({
    minDurationHours: 1,
    maxDurationDays: 90,
    minTargetQuantity: 1,
    maxTargetQuantity: 10_000_000,
    showScheduledPubliclyEnabled: false,
  }),
} as never;
const shareTierSettingsStub = {
  getCurrentPolicy: jest.fn(),
  getPolicyByVersionId: jest.fn(),
} as never;
const commissionPolicyStub = {
  getCurrentPolicy: jest.fn().mockResolvedValue({ id: "commission-v1", version: 1, rateBasisPoints: 500 }),
  getPolicyByVersionId: jest.fn().mockResolvedValue({ id: "commission-v1", version: 1, rateBasisPoints: 500 }),
} as never;
const taxRateProviderStub = { getApplicableRate: jest.fn() } as never;

const ctx = { userId: "user-1", companyId: "company-1", requestId: "req-1" };

function buildService(prisma: unknown) {
  return new OpportunitiesService(
    prisma as never,
    auditStub,
    opportunitySettingsStub,
    shareTierSettingsStub,
    commissionPolicyStub,
    taxRateProviderStub
  );
}

describe("OpportunitiesService", () => {
  describe("create — account type gate", () => {
    it("rejects a TRADER account", async () => {
      const prisma = fakePrisma({
        company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ accountType: AccountType.TRADER }) },
      });
      const service = buildService(prisma);

      await expect(
        service.create(
          {
            productId: "p1",
            fulfillmentLocationId: "l1",
            targetQuantity: 10,
            unitPriceAmount: 5,
            startAt: new Date(Date.now() + 3600_000).toISOString(),
            endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
            expectedPreparationDays: 3,
          },
          ctx
        )
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "FORBIDDEN" }) });
    });
  });

  describe("getOwned — cross-company isolation", () => {
    it("throws NotFoundException when the opportunity does not belong to the caller's company", async () => {
      const prisma = fakePrisma({ opportunity: { findFirst: jest.fn().mockResolvedValue(null) } });
      const service = buildService(prisma);
      await expect(service.getOwned("opp-1", "company-1")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("update — editable-status gate", () => {
    /**
     * FINISHED IS FINISHED, whoever is asking.
     *
     * These three are not refusals about money — a FUNDED offer sold,
     * an EXPIRED one ran out and a CANCELLED one was stopped. Editing
     * any of them would be editing the past, and no rule about buyers
     * can reopen them.
     */
    it.each([
      OpportunityStatus.FUNDED,
      OpportunityStatus.EXPIRED,
      OpportunityStatus.CANCELLED,
    ])("rejects editing a %s opportunity", async (status) => {
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({ id: "opp-1", companyId: "company-1", status }),
        },
      });
      const service = buildService(prisma);
      await expect(service.update("opp-1", {}, ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
    });

    /**
     * AND AN OFFER ON THE MARKET IS NOT FINISHED — «احذف العرض أو
     * عدّله دام ما عليه أي عملية».
     *
     * ACTIVE AND PAUSED USED TO BE REFUSED HERE, on the reasoning that
     * a buyer may be relying on what they were shown. Most live offers
     * have no buyer at all, and the rule was stopping the only person
     * it belonged to. What replaces it is the buyer himself, asked
     * directly.
     */
    it.each([OpportunityStatus.ACTIVE, OpportunityStatus.PAUSED])(
      "refuses a %s opportunity somebody has PAID for",
      async (status) => {
        const prisma = fakePrisma({
          opportunity: {
            findFirst: jest.fn().mockResolvedValue({ id: "opp-1", companyId: "company-1", status }),
            count: jest.fn().mockResolvedValue(1),
          },
        });
        const service = buildService(prisma);
        await expect(service.update("opp-1", {}, ctx)).rejects.toMatchObject({
          response: expect.objectContaining({ code: "BUYER_ALREADY_PAID" }),
        });
      }
    );

    it.each([OpportunityStatus.ACTIVE, OpportunityStatus.PAUSED])(
      "refuses a %s opportunity while somebody is checking out — for now",
      async (status) => {
        const prisma = fakePrisma({
          opportunity: {
            findFirst: jest.fn().mockResolvedValue({ id: "opp-1", companyId: "company-1", status }),
          },
          // A LOCKED or PAYMENT_PENDING session: the first count the
          // verdict takes is the live one.
          checkoutSession: { count: jest.fn().mockResolvedValue(1) },
          masterOrder: { count: jest.fn().mockResolvedValue(0) },
        });
        const service = buildService(prisma);
        await expect(service.update("opp-1", {}, ctx)).rejects.toMatchObject({
          response: expect.objectContaining({ code: "BUYER_CHECKOUT_IN_PROGRESS" }),
        });
      }
    );
  });

  describe("deleteDraft — DRAFT-only gate", () => {
    it.each([
      OpportunityStatus.SCHEDULED,
      OpportunityStatus.ACTION_REQUIRED,
      OpportunityStatus.ACTIVE,
      OpportunityStatus.PAUSED,
      OpportunityStatus.FUNDED,
      OpportunityStatus.EXPIRED,
      OpportunityStatus.CANCELLED,
    ])("rejects deleting a %s opportunity", async (status) => {
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({ id: "opp-1", companyId: "company-1", status }),
          delete: jest.fn(),
        },
      });
      const service = buildService(prisma);
      await expect(service.deleteDraft("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
      expect((prisma as { opportunity: { delete: jest.Mock } }).opportunity.delete).not.toHaveBeenCalled();
    });

    it("deletes a DRAFT opportunity and audits it", async () => {
      const deleteFn = jest.fn().mockResolvedValue({});
      const auditLog = jest.fn().mockResolvedValue(undefined);
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({ id: "opp-1", companyId: "company-1", status: OpportunityStatus.DRAFT }),
          delete: deleteFn,
        },
      });
      const service = new OpportunitiesService(
        prisma as never,
        { log: auditLog } as never,
        opportunitySettingsStub,
        shareTierSettingsStub,
        commissionPolicyStub,
        taxRateProviderStub
      );

      await service.deleteDraft("opp-1", ctx);

      expect(deleteFn).toHaveBeenCalledWith({ where: { id: "opp-1" } });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "OPPORTUNITY_DRAFT_DELETED", entityId: "opp-1" })
      );
    });
  });

  describe("update — ACTION_REQUIRED never regenerates snapshots (only publish/republish does)", () => {
    it("plain-updates fields directly, without touching snapshot fields or entering a transaction", async () => {
      const updateFn = jest.fn().mockResolvedValue({});
      const transactionFn = jest.fn();
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({
            id: "opp-1",
            companyId: "company-1",
            status: OpportunityStatus.ACTION_REQUIRED,
            productId: "p1",
            fulfillmentLocationId: "l1",
            unitPriceAmount: new Prisma.Decimal(10),
            targetQuantity: 100,
            startAt: new Date(Date.now() + 3600_000),
            endAt: new Date(Date.now() + 30 * 3600_000),
            expectedPreparationDays: 3,
            descriptionAr: null,
            descriptionEn: null,
          }),
          update: updateFn,
        },
        $transaction: transactionFn,
      });
      const service = buildService(prisma);

      await service.update("opp-1", { descriptionEn: "Updated text" }, ctx);

      expect(transactionFn).not.toHaveBeenCalled();
      expect(updateFn).toHaveBeenCalledTimes(1);
      const dataArg = updateFn.mock.calls[0][0].data;
      expect(dataArg).not.toHaveProperty("fulfillmentCityId");
      expect(dataArg).not.toHaveProperty("taxRatePercent");
      expect(dataArg).not.toHaveProperty("shareBasisPoints");
      expect(dataArg).not.toHaveProperty("status");
      expect(dataArg).not.toHaveProperty("reasonCode");
    });
  });

  describe("update — SCHEDULED regenerates snapshots atomically via a transaction", () => {
    it("uses $transaction (snapshot regeneration path), unlike ACTION_REQUIRED/DRAFT", async () => {
      const transactionFn = jest.fn().mockRejectedValue(new Error("stop-here-transaction-was-entered"));
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({
            id: "opp-1",
            companyId: "company-1",
            status: OpportunityStatus.SCHEDULED,
            productId: "p1",
            fulfillmentLocationId: "l1",
            unitPriceAmount: new Prisma.Decimal(10),
            targetQuantity: 100,
            startAt: new Date(Date.now() + 3600_000),
            endAt: new Date(Date.now() + 30 * 3600_000),
            expectedPreparationDays: 3,
            descriptionAr: null,
            descriptionEn: null,
          }),
        },
        $transaction: transactionFn,
      });
      const service = buildService(prisma);

      await expect(service.update("opp-1", { descriptionEn: "Updated text" }, ctx)).rejects.toThrow(
        "stop-here-transaction-was-entered"
      );
      expect(transactionFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("publish — status gate", () => {
    it.each([
      OpportunityStatus.SCHEDULED,
      OpportunityStatus.ACTIVE,
      OpportunityStatus.PAUSED,
      OpportunityStatus.FUNDED,
      OpportunityStatus.EXPIRED,
      OpportunityStatus.CANCELLED,
    ])("rejects publishing from %s (only DRAFT/ACTION_REQUIRED are valid)", async (status) => {
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({ id: "opp-1", companyId: "company-1", status }),
        },
      });
      const service = buildService(prisma);
      await expect(service.publish("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
    });
  });

  /**
   * ONE PRODUCT, ONE LIVE OFFER — checked where it cannot be walked
   * around.
   *
   * The owner's rule: «لا يُنشر عرض ثانٍ على المنتج إلا بعد انتهاء
   * العرض الأول». Two live offers on one product compete for the same
   * stock and can between them sell more than the supplier holds.
   *
   * These drive the WHOLE of `publish()` rather than a extracted helper,
   * because the guarantee is not "a function returns false" — it is
   * "nothing is written". Each one asserts the refusal AND that the row
   * was left alone.
   */
  describe("publish — one live offer per product", () => {
    /**
     * Everything `publish()` reads on its way to the transaction.
     *
     * `siblings` is what the in-transaction sibling lookup answers; the
     * rest is the ordinary happy path, stubbed once so each test below
     * changes exactly the one thing it is about.
     */
    function publishablePrisma(options: {
      status?: OpportunityStatus;
      /** What the row looks like INSIDE the lock — the concurrency seam. */
      claimed?: Record<string, unknown>;
      liveSibling?: Record<string, unknown> | null;
    }) {
      const status = options.status ?? OpportunityStatus.DRAFT;
      const startAt = new Date("2026-08-01T00:00:00.000Z");
      const endAt = new Date("2026-08-08T00:00:00.000Z");

      const owned = {
        id: "opp-1",
        companyId: "company-1",
        productId: "product-1",
        fulfillmentLocationId: "location-1",
        status,
        startAt,
        endAt,
        unitPriceAmount: new Prisma.Decimal("10.00"),
        targetQuantity: 100,
        shareTierPolicyVersionId: null,
        commissionPolicyVersionId: null,
      };

      const full = {
        ...owned,
        product: { approvalStatus: "APPROVED", archivedAt: null, taxonomyNodeId: "node-1" },
        fulfillmentLocation: {
          isActive: true,
          region: { isActive: true },
          city: { isActive: true },
        },
        company: {
          verificationStatus: "VERIFIED",
          activeBankAccount: { verificationStatus: "VERIFIED" },
          taxProfile: { id: "tax-1" },
          invoicingProfile: { id: "inv-1" },
        },
      };

      const claimed = options.claimed ?? {
        status,
        startAt,
        endAt,
        firstActivatedAt: null,
      };

      const update = jest.fn().mockResolvedValue({ id: "opp-1" });
      const auditCreate = jest.fn().mockResolvedValue({});
      const outboxCreate = jest.fn().mockResolvedValue({});
      const queryRaw = jest.fn().mockResolvedValue([{ id: "product-1" }]);
      const siblingFindFirst = jest.fn().mockResolvedValue(options.liveSibling ?? null);

      const tx = {
        $queryRaw: queryRaw,
        opportunity: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(claimed),
          findFirst: siblingFindFirst,
          update,
        },
        auditLog: { create: auditCreate },
        outboxEvent: { create: outboxCreate },
        companyLocation: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: "location-1",
            region: { id: "region-1", nameAr: "الرياض", nameEn: "Riyadh" },
            city: { id: "city-1", nameAr: "الرياض", nameEn: "Riyadh" },
          }),
        },
        product: { findUniqueOrThrow: jest.fn().mockResolvedValue({ taxonomyNodeId: "node-1" }) },
        productApprovalSnapshot: {
          findFirst: jest.fn().mockResolvedValue({
            id: "snap-1",
            snapshot: {
              salesUnitNameAr: "كرتون",
              salesUnitNameEn: "Carton",
              packageContentQuantity: 24,
              packageContentUnitNameAr: "قطعة",
              packageContentUnitNameEn: "Piece",
            },
          }),
        },
      };

      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue(owned),
          findUniqueOrThrow: jest.fn().mockResolvedValue(full),
          update: jest.fn(),
        },
        // The snapshot fields are computed on the client itself, before
        // the transaction opens.
        companyLocation: tx.companyLocation,
        product: tx.product,
        productApprovalSnapshot: tx.productApprovalSnapshot,
        $transaction: jest.fn(async (run: (t: unknown) => unknown) => run(tx)),
      });

      return { prisma, tx, update, queryRaw, siblingFindFirst };
    }

    const publishableService = (prisma: unknown) =>
      new OpportunitiesService(
        prisma as never,
        auditStub,
        opportunitySettingsStub,
        {
          getCurrentPolicy: jest.fn().mockResolvedValue({
            id: "tier-v1",
            version: 1,
            tiers: [{ maxTotalValueInclTax: null, shareBasisPoints: 1000 }],
          }),
          getPolicyByVersionId: jest.fn(),
        } as never,
        commissionPolicyStub,
        {
          getApplicableRate: jest
            .fn()
            .mockResolvedValue({ ratePercent: 15, ruleCode: "KSA_VAT", ruleVersion: "1" }),
        } as never
      );

    it("refuses a second publication while another offer on the product is live", async () => {
      const { prisma, update } = publishablePrisma({
        liveSibling: { id: "opp-live", status: OpportunityStatus.ACTIVE },
      });

      await expect(publishableService(prisma).publish("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "PRODUCT_ALREADY_HAS_LIVE_OFFER" }),
      });

      // THE DRAFT IS UNTOUCHED. What is refused is the publication, not
      // the work — the supplier keeps the offer and publishes it once
      // the running one ends.
      expect(update).not.toHaveBeenCalled();
    });

    it("looks for the sibling only AFTER locking the product row", async () => {
      // The read and the write are not atomic on their own: two drafts
      // published in the same instant would both see "none live" and
      // both write one. The lock is what makes the second request wait
      // and then see what the first committed.
      const calls: string[] = [];
      const { prisma, queryRaw, siblingFindFirst } = publishablePrisma({
        liveSibling: { id: "opp-live", status: OpportunityStatus.SCHEDULED },
      });
      queryRaw.mockImplementation(async () => {
        calls.push("lock");
        return [{ id: "product-1" }];
      });
      siblingFindFirst.mockImplementation(async () => {
        calls.push("look");
        return { id: "opp-live", status: OpportunityStatus.SCHEDULED };
      });

      await expect(publishableService(prisma).publish("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "PRODUCT_ALREADY_HAS_LIVE_OFFER" }),
      });

      expect(calls).toEqual(["lock", "look"]);
      expect(String(queryRaw.mock.calls[0][0])).toContain("FOR UPDATE");
    });

    it.each([
      OpportunityStatus.SCHEDULED,
      OpportunityStatus.ACTIVE,
      OpportunityStatus.PAUSED,
      OpportunityStatus.FUNDED,
    ])("counts %s as live", async (status) => {
      const { prisma, update } = publishablePrisma({ liveSibling: { id: "opp-live", status } });

      await expect(publishableService(prisma).publish("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "PRODUCT_ALREADY_HAS_LIVE_OFFER" }),
      });
      expect(update).not.toHaveBeenCalled();
    });

    it("asks only for the four live statuses, never for a draft sibling", async () => {
      // A draft on the same product blocks nothing — preparing the next
      // offer while the current one runs is exactly what the rule
      // allows.
      const { prisma, siblingFindFirst } = publishablePrisma({ liveSibling: null });
      await publishableService(prisma).publish("opp-1", ctx);

      expect(siblingFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            productId: "product-1",
            id: { not: "opp-1" },
            status: { in: ["SCHEDULED", "ACTIVE", "PAUSED", "FUNDED"] },
          }),
        })
      );
    });

    it("refuses a second publication of the SAME offer, seen inside the lock", async () => {
      // Two requests to publish one draft. The first commits; the second
      // was already past its own status gate, and only the re-read
      // inside the lock stops it activating the row twice.
      const { prisma, update } = publishablePrisma({
        claimed: {
          status: OpportunityStatus.ACTIVE,
          startAt: new Date(),
          endAt: new Date(),
          firstActivatedAt: new Date(),
        },
      });

      await expect(publishableService(prisma).publish("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONFLICT" }),
      });
      expect(update).not.toHaveBeenCalled();
    });

    /**
     * THE CLOCK STARTS WHEN THE PUBLICATION SUCCEEDS.
     *
     * It used to be stamped before publication, in the listings path
     * only — so a refused publication had already spent days of a window
     * on an offer nobody could buy, and the direct route never
     * re-anchored at all.
     */
    it("re-anchors the stored duration to now and goes ACTIVE", async () => {
      const { prisma, update } = publishablePrisma({ liveSibling: null });
      const before = Date.now();

      await publishableService(prisma).publish("opp-1", ctx);

      const written = update.mock.calls[0][0].data;
      // The draft was written for 1–8 August; the seven days survive and
      // start now, not then.
      const startAt = written.startAt as Date;
      const endAt = written.endAt as Date;
      expect(startAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(endAt.getTime() - startAt.getTime()).toBe(7 * 86_400_000);
      expect(written.status).toBe(OpportunityStatus.ACTIVE);
      expect(written.firstActivatedAt).toBeInstanceOf(Date);
    });

    it("leaves the window alone once the offer has been live", async () => {
      // A republish of a row that was already activated: its instants
      // are frozen by a database trigger and may move only through the
      // single atomic extension path.
      const startAt = new Date("2026-08-01T00:00:00.000Z");
      const { prisma, update } = publishablePrisma({
        status: OpportunityStatus.ACTION_REQUIRED,
        claimed: {
          status: OpportunityStatus.ACTION_REQUIRED,
          startAt,
          endAt: new Date("2026-08-08T00:00:00.000Z"),
          firstActivatedAt: new Date("2026-08-01T00:00:01.000Z"),
        },
        liveSibling: null,
      });

      await publishableService(prisma).publish("opp-1", ctx);

      const written = update.mock.calls[0][0].data;
      expect(written.startAt).toBeUndefined();
      expect(written.endAt).toBeUndefined();
    });
  });

  describe("extend — ACTIVE-only, once, before end", () => {
    it("rejects extending a non-ACTIVE opportunity", async () => {
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: "opp-1", companyId: "company-1", status: OpportunityStatus.SCHEDULED }),
        },
      });
      const service = buildService(prisma);
      await expect(service.extend("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
    });

    it("rejects extending an already-extended opportunity", async () => {
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({
            id: "opp-1",
            companyId: "company-1",
            status: OpportunityStatus.ACTIVE,
            extendedAt: new Date(),
            endAt: new Date(Date.now() + 3600_000),
          }),
        },
      });
      const service = buildService(prisma);
      await expect(service.extend("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONFLICT" }),
      });
    });

    it("rejects extending an opportunity that has already ended", async () => {
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({
            id: "opp-1",
            companyId: "company-1",
            status: OpportunityStatus.ACTIVE,
            extendedAt: null,
            endAt: new Date(Date.now() - 3600_000),
          }),
        },
      });
      const service = buildService(prisma);
      await expect(service.extend("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
    });
  });

  describe("create — ownership (IDOR guard); no minPurchaseQuantity/maxPurchaseQuantity input exists anymore", () => {
    it("rejects an unowned product (IDOR guard)", async () => {
      const prisma = fakePrisma({
        company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ accountType: AccountType.SUPPLIER }) },
        product: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      const service = buildService(prisma);
      await expect(
        service.create(
          {
            productId: "someone-elses-product",
            fulfillmentLocationId: "l1",
            targetQuantity: 10,
            unitPriceAmount: 5,
            startAt: new Date(Date.now() + 3600_000).toISOString(),
            endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
            expectedPreparationDays: 3,
          },
          ctx
        )
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("rejects an unowned fulfillment location (IDOR guard)", async () => {
      const prisma = fakePrisma({
        company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ accountType: AccountType.SUPPLIER }) },
        product: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) },
        companyLocation: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      const service = buildService(prisma);
      await expect(
        service.create(
          {
            productId: "p1",
            fulfillmentLocationId: "someone-elses-location",
            targetQuantity: 10,
            unitPriceAmount: 5,
            startAt: new Date(Date.now() + 3600_000).toISOString(),
            endAt: new Date(Date.now() + 30 * 3600_000).toISOString(),
            expectedPreparationDays: 3,
          },
          ctx
        )
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });
  });

});
