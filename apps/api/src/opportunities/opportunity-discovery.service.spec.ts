import { Prisma, OpportunityStatus } from "@prisma/client";
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
        startAt: PUBLIC_START_AT,
        endAt: PUBLIC_END_AT,
        status: OpportunityStatus.ACTIVE,
      });
      expect(result).not.toHaveProperty("expectedPreparationDays");
      expect(result).not.toHaveProperty("unitPriceAmount");
      expect(result).not.toHaveProperty("targetQuantity");
      expect(result).not.toHaveProperty("fundedQuantity");
      expect(result).not.toHaveProperty("shareQuantity");
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
      expect(selectArg).not.toHaveProperty("unitPriceAmount");
      expect(selectArg).not.toHaveProperty("targetQuantity");
      expect(selectArg).not.toHaveProperty("shareBasisPoints");
      expect(selectArg).not.toHaveProperty("shareTierPolicyVersionId");
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

  describe("filters — taxonomyNodeId, cityId, productId", () => {
    it("filters by fulfillmentCityId directly (no join needed)", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({ cityId: "city-1" });

      expect(findMany.mock.calls[0][0].where.fulfillmentCityId).toBe("city-1");
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
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new OpportunityDiscoveryService(prisma, settingsStub(false));

      await service.listPublic({ taxonomyNodeId: "node-1" });

      expect(findMany.mock.calls[0][0].where.productApprovalSnapshot).toEqual({
        is: { snapshot: { path: ["taxonomyNodeId"], equals: "node-1" } },
      });
      expect(findMany.mock.calls[0][0].where).not.toHaveProperty("product");
      expect(findMany.mock.calls[0][0].select).not.toHaveProperty("product");
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
