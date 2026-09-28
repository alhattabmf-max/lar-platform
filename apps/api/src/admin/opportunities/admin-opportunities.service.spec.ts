import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AdminOpportunitiesService } from "./admin-opportunities.service";

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    ...overrides,
    opportunity: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(baseRow()),
      count: jest.fn().mockResolvedValue(0),
      ...(overrides.opportunity as Record<string, unknown> | undefined),
    },
    // NO PAID ORDER BY DEFAULT, which is the state every cancel case
    // here was written in. A plain cancel refuses outright once anyone
    // has paid — «إذا كان عليه عملية شراء يطلب المورد من الإدارة» — and
    // the case that proves that refusal sets its own count.
    masterOrder: {
      count: jest.fn().mockResolvedValue(0),
      ...(overrides.masterOrder as Record<string, unknown> | undefined),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(overrides.tx ?? {})),
  } as never;
}

const ctx = { actorId: "admin-1", requestId: "req-1" };

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "opp-1",
    companyId: "company-1",
    productId: "p1",
    fulfillmentLocationId: "l1",
    targetQuantity: 100,
    fundedQuantity: 0,
    unitPriceAmount: new Prisma.Decimal(11.5),
    currency: "SAR",
    startAt: new Date(Date.now() - 3600_000),
    endAt: new Date(Date.now() + 3600_000),
    expectedPreparationDays: 3,
    descriptionAr: null,
    descriptionEn: null,
    status: "ACTIVE",
    firstActivatedAt: new Date(),
    extendedAt: null,
    pausedAt: null,
    pauseReason: null,
    cancelReason: null,
    reasonCode: null,
    reasonDetails: null,
    blockedAt: null,
    fulfillmentCityNameAr: "a",
    fulfillmentCityNameEn: "a",
    fulfillmentRegionNameAr: "a",
    fulfillmentRegionNameEn: "a",
    taxRatePercent: new Prisma.Decimal(15),
    unitPriceExclTaxAmount: new Prisma.Decimal(10),
    unitTaxAmount: new Prisma.Decimal(1.5),
    totalValueInclTaxAmount: new Prisma.Decimal(1150),
    shareBasisPoints: 1000,
    shareQuantity: 10,
    salesUnitNameAr: "ك",
    salesUnitNameEn: "Carton",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Builds a tx mock whose $queryRaw returns `claimedRows` for every call (in order, if an array of arrays is given) — matching the atomic UPDATE...RETURNING pattern pause/resume/cancel all use. */
function buildTx(options: {
  queryRawResults: unknown[][];
  findUniqueOrThrowResult?: unknown;
}) {
  let call = 0;
  const queryRaw = jest.fn(async () => options.queryRawResults[call++] ?? []);
  return {
    $queryRaw: queryRaw,
    opportunity: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(options.findUniqueOrThrowResult ?? baseRow()),
    },
    auditLog: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
  };
}

describe("AdminOpportunitiesService", () => {
  describe("list — filters and pagination", () => {
    it("filters by status/companyId/productId when provided", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const count = jest.fn().mockResolvedValue(0);
      const prisma = fakePrisma({ opportunity: { findMany, count } });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      await service.list({ status: "ACTION_REQUIRED", companyId: "c1", productId: "p1", page: 1, pageSize: 20 });

      expect(findMany.mock.calls[0][0].where).toEqual({
        status: "ACTION_REQUIRED",
        companyId: "c1",
        productId: "p1",
      });
    });

    it("shows ALL statuses by default (no restriction unlike trader/public)", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      await service.list({});

      expect(findMany.mock.calls[0][0].where).toEqual({});
    });

    it("clamps pageSize to 100", async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = fakePrisma({ opportunity: { findMany, count: jest.fn().mockResolvedValue(0) } });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      const result = await service.list({ pageSize: 500 });
      expect(result.pageSize).toBe(100);
    });
  });

  describe("getById — not found", () => {
    it("throws NotFoundException for a missing id", async () => {
      const prisma = fakePrisma();
      const service = new AdminOpportunitiesService(prisma, {} as never);
      await expect(service.getById("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("pause — atomic claim, ACTIVE only", () => {
    it("rejects pausing when the atomic claim matches nothing (not ACTIVE)", async () => {
      const existing = baseRow({ status: "SCHEDULED" });
      const tx = buildTx({ queryRawResults: [[]] }); // UPDATE...WHERE status='ACTIVE' matches 0 rows
      const prisma = fakePrisma({ opportunity: { findUnique: jest.fn().mockResolvedValue(existing) }, tx });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      await expect(service.pause("opp-1", "issue found", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONFLICT" }),
      });
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it("pauses an ACTIVE opportunity, writes audit+outbox atomically, requires a reason", async () => {
      const existing = baseRow({ status: "ACTIVE" });
      const tx = buildTx({
        queryRawResults: [[{ id: "opp-1" }]], // claim succeeds
        findUniqueOrThrowResult: baseRow({ status: "PAUSED", pauseReason: "supplier under investigation" }),
      });
      const prisma = fakePrisma({ opportunity: { findUnique: jest.fn().mockResolvedValue(existing) }, tx });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      const result = await service.pause("opp-1", "supplier under investigation", ctx);

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: "OPPORTUNITY_PAUSED", reason: "supplier under investigation" }),
        })
      );
      expect(tx.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ eventType: "OPPORTUNITY_PAUSED" }) })
      );
      expect(result.status).toBe("PAUSED");
    });
  });

  describe("resume — atomic claim, PAUSED only, self-corrects to EXPIRED if end_at already passed", () => {
    it("rejects resuming when neither the resume claim nor the expire claim matches (not PAUSED at all)", async () => {
      const existing = baseRow({ status: "ACTIVE" });
      const tx = buildTx({ queryRawResults: [[], []] }); // resume claim empty, expire claim empty
      const prisma = fakePrisma({ opportunity: { findUnique: jest.fn().mockResolvedValue(existing) }, tx });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      await expect(service.resume("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
    });

    it("self-corrects to EXPIRED (does not resume) when end_at has already passed", async () => {
      const existing = baseRow({ status: "PAUSED", endAt: new Date(Date.now() - 1000), pauseReason: "old reason" });
      // resume claim (WHERE end_at > now()) matches nothing; expire claim (WHERE end_at <= now()) matches.
      const tx = buildTx({ queryRawResults: [[], [{ id: "opp-1" }]] });
      const prisma = fakePrisma({ opportunity: { findUnique: jest.fn().mockResolvedValue(existing) }, tx });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      await expect(service.resume("opp-1", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONFLICT" }),
      });
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: "OPPORTUNITY_EXPIRED", actorType: "SYSTEM" }),
        })
      );
      expect(tx.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ eventType: "OPPORTUNITY_EXPIRED" }) })
      );
    });

    it("resumes normally when end_at has not passed, clearing pause fields", async () => {
      const existing = baseRow({ status: "PAUSED", endAt: new Date(Date.now() + 3600_000), pauseReason: "reason" });
      const tx = buildTx({
        queryRawResults: [[{ id: "opp-1" }]], // resume claim succeeds immediately
        findUniqueOrThrowResult: baseRow({ status: "ACTIVE", pausedAt: null, pauseReason: null }),
      });
      const prisma = fakePrisma({ opportunity: { findUnique: jest.fn().mockResolvedValue(existing) }, tx });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      const result = await service.resume("opp-1", ctx);

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "OPPORTUNITY_RESUMED" }) })
      );
      expect(result.status).toBe("ACTIVE");
    });
  });

  describe("cancel — atomic claim, reachable from DRAFT/SCHEDULED/ACTIVE/PAUSED, NEVER from ACTION_REQUIRED", () => {
    it.each(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED"])("allows cancelling from %s", async (status) => {
      const existing = baseRow({ status });
      const tx = buildTx({
        queryRawResults: [[{ id: "opp-1" }]],
        findUniqueOrThrowResult: baseRow({ status: "CANCELLED" }),
      });
      const prisma = fakePrisma({ opportunity: { findUnique: jest.fn().mockResolvedValue(existing) }, tx });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      const result = await service.cancel("opp-1", "mandatory legal reason", ctx);
      expect(result.status).toBe("CANCELLED");
    });

    it("REJECTS cancelling an ACTION_REQUIRED opportunity — admin never substitutes for the supplier fixing it", async () => {
      const existing = baseRow({ status: "ACTION_REQUIRED" });
      // ACTION_REQUIRED is never in the cancellableFrom list, so the
      // WHERE clause is built without it — the claim always matches 0
      // rows for this status.
      const tx = buildTx({ queryRawResults: [[]] });
      const prisma = fakePrisma({ opportunity: { findUnique: jest.fn().mockResolvedValue(existing) }, tx });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      await expect(service.cancel("opp-1", "reason", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it.each(["FUNDED", "EXPIRED", "CANCELLED"])("rejects cancelling a terminal %s opportunity", async (status) => {
      const existing = baseRow({ status });
      const tx = buildTx({ queryRawResults: [[]] });
      const prisma = fakePrisma({ opportunity: { findUnique: jest.fn().mockResolvedValue(existing) }, tx });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      await expect(service.cancel("opp-1", "reason", ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "VALIDATION_FAILED" }),
      });
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe("getById — never leaks shareBasisPoints or shareTierPolicyVersionId, exposes sharePercentage instead", () => {
    it("computes sharePercentage and omits raw internals", async () => {
      const prisma = fakePrisma({
        opportunity: { findUnique: jest.fn().mockResolvedValue(baseRow()) },
      });
      const service = new AdminOpportunitiesService(prisma, {} as never);

      const result = await service.getById("opp-1");

      expect(result.sharePercentage).toBe(10);
      expect(result).not.toHaveProperty("shareBasisPoints");
      expect(result).not.toHaveProperty("shareTierPolicyVersionId");
      expect(result).not.toHaveProperty("productApprovalSnapshotId");
      expect(result).not.toHaveProperty("fulfillmentCityId");
      expect(result.companyId).toBe("company-1");
    });
  });
});
