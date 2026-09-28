import { Prisma, OpportunityStatus } from "@prisma/client";
import { TAXONOMY_MAX_DEPTH } from "@platform/types";
import { OpportunityDiscoveryService } from "./opportunity-discovery.service";

/** Window close on the public view, added when the contract widened in 8C. */
const PUBLIC_END_AT = new Date("2026-09-01T00:00:00.000Z");
/** Window open — detail only. */
const PUBLIC_START_AT = new Date("2026-08-01T00:00:00.000Z");

const SNAPSHOT_JSON = {
  nameAr: "منتج",
  nameEn: "Product",
  descriptionAr: "وصف",
  descriptionEn: "Description",
};

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    opportunity: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      ...(overrides.opportunity as Record<string, unknown> | undefined),
    },
    // A taxonomy filter now widens to the node's subtree, so the double
    // has to answer for the tree too. The default is a LEAF — no
    // children — which is what almost every test here means when it
    // passes a node id and cares about something else entirely.
    taxonomyNode: {
      findMany: jest.fn().mockResolvedValue([]),
      ...(overrides.taxonomyNode as Record<string, unknown> | undefined),
    },
    // NOTHING IS LOCKED IN THESE DOUBLES. The trader projection asks how
    // much of each listing sits in live baskets, so it can publish a
    // ceiling a quantity picker may offer; with no checkout sessions
    // the answer is empty and `availableQuantity` falls back to target
    // minus funded. The lock arithmetic is proved against a real
    // database, where a lock can actually exist.
    $queryRaw: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as never;
}

function settingsStub(showScheduled: boolean) {
  return {
    getConfig: jest.fn().mockResolvedValue({
      minDurationHours: 1,
      maxDurationDays: 90,
      minTargetQuantity: 1,
      maxTargetQuantity: 10_000_000,
      showScheduledPubliclyEnabled: showScheduled,
    }),
  } as never;
}

describe("OpportunityDiscoveryService", () => {
  describe("visibility — excluded statuses never appear regardless of settings", () => {
    it.each([OpportunityStatus.DRAFT, OpportunityStatus.ACTION_REQUIRED, OpportunityStatus.CANCELLED, OpportunityStatus.PAUSED])(
      "never includes %s in the base status filter, even with showScheduledPubliclyEnabled=true",
      async (excludedStatus) => {
        const findMany = jest.fn().mockResolvedValue([]);
        const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
        const service = new OpportunityDiscoveryService(prisma, settingsStub(true));

        await service.listPublic({});

        const whereArg = findMany.mock.calls[0][0].where;
        expect(whereArg.status.in).not.toContain(excludedStatus);
      }
    );
  });

  describe("visibility — showScheduledPubliclyEnabled controls SCHEDULED inclusion, read from settings not hardcoded", () => {
    it("excludes SCHEDULED when the setting is false (the documented default)", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({});

      const whereArg = findMany.mock.calls[0][0].where;
      expect(whereArg.status.in).toEqual([OpportunityStatus.ACTIVE]);
    });

    it("includes SCHEDULED alongside ACTIVE when the setting is true", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(true));

      await service.listForTrader({});

      const whereArg = findMany.mock.calls[0][0].where;
      expect(whereArg.status.in).toEqual(
        expect.arrayContaining([OpportunityStatus.ACTIVE, OpportunityStatus.SCHEDULED])
      );
      expect(whereArg.status.in).toHaveLength(2);
    });
  });

  describe("public view — never leaks price, quantities, or internal fields", () => {
    it("the public detail response contains only marketing-safe fields", async () => {
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({
            id: "opp-1",
            fulfillmentCityNameAr: "الرياض",
            fulfillmentCityNameEn: "Riyadh",
            salesUnitNameAr: null,
            salesUnitNameEn: null,
            fulfillmentRegionNameAr: "منطقة الرياض",
            fulfillmentRegionNameEn: "Riyadh Region",
            unitPriceAmount: new Prisma.Decimal("287.50"),
            currency: "SAR",
            targetQuantity: 100,
            fundedQuantity: 10,
            shareQuantity: 10,
            startAt: PUBLIC_START_AT,
            endAt: PUBLIC_END_AT,
            status: OpportunityStatus.ACTIVE,
            productApprovalSnapshot: { snapshot: SNAPSHOT_JSON },
          }),
        },
      });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      const result = await service.getPublicDetail("opp-1");

      // Widened in 8C: a nullable image ROUTE, the selling unit and the
      // window close. Widened again in Batch 8 with the descriptive
      // context a detail page needs — description, fulfilment region and
      // the window open. Commercial terms stay absent — no price, no
      // quantity, no share size, no purchase step, and no
      // expectedPreparationDays, which is a supply commitment.
      expect(result).toEqual({
        id: "opp-1",
        productNameAr: "منتج",
        productNameEn: "Product",
        productDescriptionAr: "وصف",
        productDescriptionEn: "Description",
        imageUrl: null,
        thumbnailUrl: null,
        fulfillmentCityNameAr: "الرياض",
        fulfillmentCityNameEn: "Riyadh",
        fulfillmentRegionNameAr: "منطقة الرياض",
        fulfillmentRegionNameEn: "Riyadh Region",
        salesUnitNameAr: null,
        salesUnitNameEn: null,
        unitPriceInclTaxAmount: "287.50",
        currency: "SAR",
        targetQuantity: 100,
        unsoldQuantity: 90,
        progressPercentage: 10,
        shareQuantity: 10,
        startAt: PUBLIC_START_AT,
        endAt: PUBLIC_END_AT,
        status: OpportunityStatus.ACTIVE,
        // THE PRODUCT'S OWN FACTS, read from the same frozen snapshot.
        // Null here because THIS fixture is a legacy four-key snapshot,
        // which is exactly the shape a pre-7A row has: an absence must
        // read as one, never as a zero.
        taxonomyNodeId: null,
        weightPerUnit: null,
        lengthCm: null,
        widthCm: null,
        heightCm: null,
        packageContentQuantity: null,
        packageContentUnitNameAr: null,
        packageContentUnitNameEn: null,
        // No media in the fixture, so no gallery.
        imageUrls: [],
        thumbnailUrls: [],
      });
      // Price and quantities are public BY DECISION now. What stays
      // out is the raw Decimal column, the absolute amount sold, and
      // the supplier preparation commitment.
      expect(result).not.toHaveProperty("expectedPreparationDays");
      expect(result).not.toHaveProperty("unitPriceAmount");
      expect(result).not.toHaveProperty("fundedQuantity");
      // shareQuantity IS public now — it is the minimum order a visitor
      // needs to judge an offer. shareBasisPoints and the percentage
      // derived from it are not.
      expect(result).not.toHaveProperty("shareBasisPoints");
      expect(result).not.toHaveProperty("sharePercentage");
      expect(result).not.toHaveProperty("shareTierPolicyVersionId");
      expect(result).not.toHaveProperty("reasonCode");
      expect(result).not.toHaveProperty("reasonDetails");
      expect(result).not.toHaveProperty("fulfillmentLocationId");
      expect(result).not.toHaveProperty("fulfillmentCityId");
      expect(result).not.toHaveProperty("companyId");
    });

    it("the public select never requests reasonCode/reasonDetails/bank data, share-tier internals, or a live Product join", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({});

      const selectArg = findMany.mock.calls[0][0].select;
      expect(selectArg).not.toHaveProperty("reasonCode");
      expect(selectArg).not.toHaveProperty("reasonDetails");
      expect(selectArg).not.toHaveProperty("blockedAt");
      expect(selectArg).not.toHaveProperty("fulfillmentLocationId");
      expect(selectArg).not.toHaveProperty("companyId");
      expect(selectArg).not.toHaveProperty("product");
      // Share sizing internals stay out: `sharePercentage` is derived
      // from shareBasisPoints and remains trader-only.
      expect(selectArg).not.toHaveProperty("shareBasisPoints");
      expect(selectArg).not.toHaveProperty("shareTierPolicyVersionId");
    });

    it("does select the columns the PUBLIC terms are derived from", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({
        opportunity: { findMany, count: jest.fn().mockResolvedValue(0) },
      });
      const service = new OpportunityDiscoveryService(
        prisma,
        settingsStub(false),
      );

      await service.listPublic({});

      const selectArg = findMany.mock.calls[0][0].select;
      // Price, target and share size are returned; fundedQuantity is
      // read only to derive unsold and progress, and never returned —
      // the response-shape tests above are what prove that.
      for (const column of [
        "unitPriceAmount",
        "currency",
        "targetQuantity",
        "fundedQuantity",
        "shareQuantity",
        "fulfillmentRegionNameAr",
        "fulfillmentRegionNameEn",
      ]) {
        expect(selectArg).toHaveProperty(column);
      }
    });
  });

  describe("trader view — full commercial detail, still no internal/sensitive fields", () => {
    it("computes progressPercentage and sharePercentage, reads price/city/duration/share-quantity from the row", async () => {
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({
            id: "opp-1",
            unitPriceAmount: new Prisma.Decimal("11.5"),
            currency: "SAR",
            targetQuantity: 200,
            fundedQuantity: 50,
            shareQuantity: 20,
            shareBasisPoints: 1000,
            salesUnitNameAr: "كرتون",
            salesUnitNameEn: "Carton",
            fulfillmentCityNameAr: "جدة",
            fulfillmentCityNameEn: "Jeddah",
            fulfillmentRegionNameAr: "مكة",
            fulfillmentRegionNameEn: "Makkah",
            startAt: new Date("2026-01-01T00:00:00Z"),
            endAt: new Date("2026-01-10T00:00:00Z"),
            expectedPreparationDays: 5,
            status: OpportunityStatus.ACTIVE,
            productApprovalSnapshot: { snapshot: SNAPSHOT_JSON },
          }),
        },
      });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      const result = await service.getTraderDetail("opp-1");

      expect(result?.progressPercentage).toBe(25);
      expect(result?.unitPriceInclTaxAmount).toBe("11.50");
      expect(result?.fulfillmentCityNameEn).toBe("Jeddah");
      expect(result?.shareQuantity).toBe(20);
      expect(result?.sharePercentage).toBe(10); // 1000 bps -> 10%, computed, never raw bps
      expect(result?.salesUnitNameEn).toBe("Carton");
      expect(result).not.toHaveProperty("reasonCode");
      expect(result).not.toHaveProperty("fulfillmentCityId");
      expect(result).not.toHaveProperty("companyId");
      expect(result).not.toHaveProperty("shareBasisPoints");
      expect(result).not.toHaveProperty("shareTierPolicyVersionId");
    });

    it("never selects shareTierPolicyVersionId from the DB at all — it cannot leak what is never fetched", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listForTrader({});

      const selectArg = findMany.mock.calls[0][0].select;
      expect(selectArg).not.toHaveProperty("shareTierPolicyVersionId");
      expect(selectArg).not.toHaveProperty("reasonCode");
      expect(selectArg).not.toHaveProperty("companyId");
    });

    it("returns 0% progress for a zero target quantity without dividing by zero into NaN/Infinity", async () => {
      const prisma = fakePrisma({
        opportunity: {
          findFirst: jest.fn().mockResolvedValue({
            id: "opp-1",
            unitPriceAmount: new Prisma.Decimal("10"),
            currency: "SAR",
            targetQuantity: 0,
            fundedQuantity: 0,
            shareQuantity: 0,
            shareBasisPoints: 1000,
            salesUnitNameAr: "a",
            salesUnitNameEn: "a",
            fulfillmentCityNameAr: "a",
            fulfillmentCityNameEn: "a",
            fulfillmentRegionNameAr: "a",
            fulfillmentRegionNameEn: "a",
            startAt: new Date(),
            endAt: new Date(),
            expectedPreparationDays: 1,
            status: OpportunityStatus.ACTIVE,
            productApprovalSnapshot: { snapshot: SNAPSHOT_JSON },
          }),
        },
      });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));
      const result = await service.getTraderDetail("opp-1");
      expect(result?.progressPercentage).toBe(0);
    });
  });

  describe("detail lookup — not-found for excluded statuses (never leaks existence via a different error)", () => {
    it("getPublicDetail returns null when the row's status is not in the visible set (findFirst filters it out)", async () => {
      const findFirst = jest.fn().mockResolvedValue(null);
      const prisma = fakePrisma({ opportunity: { findFirst } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      const result = await service.getPublicDetail("draft-opp-id");

      expect(result).toBeNull();
      expect(findFirst.mock.calls[0][0].where.status.in).toEqual([OpportunityStatus.ACTIVE]);
    });
  });

  describe("filters — taxonomyNodeId, regionId, cityId, productId", () => {
    /**
     * THE REGION IS THE PLACE FILTER. A listing ships from a branch and
     * a branch is recorded against a region, so this is what a buyer
     * narrows by. The city is the refinement beneath it, and both are
     * matched against the FROZEN snapshot on the listing — never
     * through a join to the branch, whose place may have changed since.
     */
    it("filters by fulfillmentRegionId directly (no join needed)", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({ regionId: "region-1" });

      expect(findMany.mock.calls[0][0].where.fulfillmentRegionId).toBe("region-1");
      // The city is not implied by the region, and no default is
      // invented for it.
      expect(findMany.mock.calls[0][0].where.fulfillmentCityId).toBeUndefined();
    });

    it("filters by fulfillmentCityId directly (no join needed)", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({ cityId: "city-1" });

      expect(findMany.mock.calls[0][0].where.fulfillmentCityId).toBe("city-1");
    });

    it("applies both when both are sent, narrowing rather than replacing", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({ regionId: "region-1", cityId: "city-1" });

      const where = findMany.mock.calls[0][0].where;
      expect(where.fulfillmentRegionId).toBe("region-1");
      expect(where.fulfillmentCityId).toBe("city-1");
    });

    it("neither is applied when neither is sent", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({});

      const where = findMany.mock.calls[0][0].where;
      expect(where.fulfillmentRegionId).toBeUndefined();
      expect(where.fulfillmentCityId).toBeUndefined();
    });

    it("filters by productId directly", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({ productId: "product-1" });

      expect(findMany.mock.calls[0][0].where.productId).toBe("product-1");
    });

    it("filters by taxonomyNodeId via the FROZEN snapshot JSON, never a live Product join", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({
        opportunity: { findMany, count: jest.fn().mockResolvedValue(0) },
        // A leaf: no children, so the subtree is the node itself.
        taxonomyNode: { findMany: jest.fn().mockResolvedValue([]) },
      });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({ taxonomyNodeId: "node-1" });

      expect(findMany.mock.calls[0][0].where.productApprovalSnapshot).toEqual({
        is: { OR: [{ snapshot: { path: ["taxonomyNodeId"], equals: "node-1" } }] },
      });
      expect(findMany.mock.calls[0][0].where).not.toHaveProperty("product");
      expect(findMany.mock.calls[0][0].select).not.toHaveProperty("product");
    });

    it("REACHES THE WHOLE SUBTREE, because nothing is filed on a parent any more", async () => {
      // `TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS` is false: a node with active
      // children cannot hold a product. Equality matching would then make
      // every parent in the category bar an empty page — the two
      // constants are one decision, and this is the half that proves it.
      const findMany = jest.fn().mockResolvedValue([]);
      const nodes = jest
        .fn()
        .mockResolvedValueOnce([{ id: "child-1" }, { id: "child-2" }])
        .mockResolvedValueOnce([{ id: "grandchild-1" }]);
      const prisma = fakePrisma({
        opportunity: { findMany, count: jest.fn().mockResolvedValue(0) },
        taxonomyNode: { findMany: nodes },
      });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({ taxonomyNodeId: "root" });

      expect(findMany.mock.calls[0][0].where.productApprovalSnapshot.is.OR).toEqual([
        { snapshot: { path: ["taxonomyNodeId"], equals: "root" } },
        { snapshot: { path: ["taxonomyNodeId"], equals: "child-1" } },
        { snapshot: { path: ["taxonomyNodeId"], equals: "child-2" } },
        { snapshot: { path: ["taxonomyNodeId"], equals: "grandchild-1" } },
      ]);
    });

    it("stops widening at the tree's own maximum depth", async () => {
      // Two widening steps reach every descendant a 3-deep tree can
      // have. A third would be walking a tree that cannot exist, and an
      // unbounded loop here is how a filter becomes a table scan.
      const findMany = jest.fn().mockResolvedValue([]);
      const nodes = jest.fn().mockResolvedValue([{ id: "always-more" }]);
      const prisma = fakePrisma({
        opportunity: { findMany, count: jest.fn().mockResolvedValue(0) },
        taxonomyNode: { findMany: nodes },
      });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({ taxonomyNodeId: "root" });

      expect(nodes).toHaveBeenCalledTimes(TAXONOMY_MAX_DEPTH - 1);
    });
  });

  describe("pagination — bounded and safe", () => {
    it("defaults to page 1, pageSize 20 when not provided", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      const result = await service.listPublic({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(findMany.mock.calls[0][0].skip).toBe(0);
      expect(findMany.mock.calls[0][0].take).toBe(20);
    });

    it("clamps pageSize to a maximum of 100 even if a larger value is passed", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      const result = await service.listPublic({ pageSize: 500 });

      expect(result.pageSize).toBe(100);
      expect(findMany.mock.calls[0][0].take).toBe(100);
    });

    it("computes the correct skip offset for page > 1", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({ page: 3, pageSize: 10 });

      expect(findMany.mock.calls[0][0].skip).toBe(20);
      expect(findMany.mock.calls[0][0].take).toBe(10);
    });
  });
});
