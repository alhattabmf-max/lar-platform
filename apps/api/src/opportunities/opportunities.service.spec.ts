import { NotFoundException } from "@nestjs/common";
import { AccountType, OpportunityStatus, Prisma } from "@prisma/client";
import { OpportunitiesService } from "./opportunities.service";

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    company: { findUniqueOrThrow: jest.fn() },
    product: { findFirst: jest.fn() },
    companyLocation: { findFirst: jest.fn() },
    opportunity: {
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
    ...overrides,
  } as never;
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
    it.each([OpportunityStatus.ACTIVE, OpportunityStatus.PAUSED, OpportunityStatus.FUNDED, OpportunityStatus.EXPIRED, OpportunityStatus.CANCELLED])(
      "rejects editing a %s opportunity",
      async (status) => {
        const prisma = fakePrisma({
          opportunity: {
            findFirst: jest.fn().mockResolvedValue({ id: "opp-1", companyId: "company-1", status }),
          },
        });
        const service = buildService(prisma);
        await expect(service.update("opp-1", {}, ctx)).rejects.toMatchObject({
          response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
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
