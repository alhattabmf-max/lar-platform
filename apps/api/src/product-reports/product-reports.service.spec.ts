import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ProductReportsService } from "./product-reports.service";

function fakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    ...overrides,
    company: { findUniqueOrThrow: jest.fn(), ...(overrides.company as Record<string, unknown> | undefined) },
    product: { findUnique: jest.fn(), ...(overrides.product as Record<string, unknown> | undefined) },
    productApprovalSnapshot: {
      findFirst: jest.fn(),
      ...(overrides.productApprovalSnapshot as Record<string, unknown> | undefined),
    },
    productReport: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      ...(overrides.productReport as Record<string, unknown> | undefined),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(overrides.tx ?? {})),
  } as never;
}

const auditStub = { log: jest.fn().mockResolvedValue(undefined) };
const ctx = { userId: "user-1", companyId: "trader-co", requestId: "req-1" };
const adminCtx = { actorId: "admin-1", requestId: "req-1" };

describe("ProductReportsService", () => {
  describe("create", () => {
    it("rejects a non-TRADER account", async () => {
      const prisma = fakePrisma({ company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ accountType: "SUPPLIER" }) } });
      const service = new ProductReportsService(prisma, auditStub as never);

      await expect(
        service.create({ productId: "p1", reasonCode: "COUNTERFEIT" } as never, ctx)
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "FORBIDDEN" }) });
    });

    it("rejects a supplier reporting its own product (defensive, even though accountType already blocks it)", async () => {
      const prisma = fakePrisma({
        company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ accountType: "TRADER" }) },
        product: { findUnique: jest.fn().mockResolvedValue({ id: "p1", companyId: "trader-co" }) },
      });
      const service = new ProductReportsService(prisma, auditStub as never);

      await expect(
        service.create({ productId: "p1", reasonCode: "COUNTERFEIT" } as never, ctx)
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("rejects reporting a product that was never approved (no snapshot exists)", async () => {
      const prisma = fakePrisma({
        company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ accountType: "TRADER" }) },
        product: { findUnique: jest.fn().mockResolvedValue({ id: "p1", companyId: "other-co" }) },
        productApprovalSnapshot: { findFirst: jest.fn().mockResolvedValue(null) },
      });
      const service = new ProductReportsService(prisma, auditStub as never);

      await expect(
        service.create({ productId: "p1", reasonCode: "COUNTERFEIT" } as never, ctx)
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "VALIDATION_FAILED" }) });
    });

    it("pins the LATEST approval snapshot id and audits the filing", async () => {
      const createFn = jest.fn().mockResolvedValue({ id: "report-1", productId: "p1" });
      const prisma = fakePrisma({
        company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ accountType: "TRADER" }) },
        product: { findUnique: jest.fn().mockResolvedValue({ id: "p1", companyId: "other-co" }) },
        productApprovalSnapshot: { findFirst: jest.fn().mockResolvedValue({ id: "snap-latest" }) },
        productReport: { create: createFn, findMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
      });
      const service = new ProductReportsService(prisma, auditStub as never);

      await service.create({ productId: "p1", reasonCode: "SAFETY_CONCERN" } as never, ctx);

      expect(createFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reportedProductApprovalSnapshotId: "snap-latest",
            reporterCompanyId: "trader-co",
          }),
        })
      );
      expect(auditStub.log).toHaveBeenCalledWith(expect.objectContaining({ action: "PRODUCT_REPORT_FILED" }));
    });

    it("turns a unique-constraint violation (already has an OPEN report) into a clear 409", async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError("unique violation", {
        code: "P2002",
        clientVersion: "5.22.0",
      });
      const prisma = fakePrisma({
        company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ accountType: "TRADER" }) },
        product: { findUnique: jest.fn().mockResolvedValue({ id: "p1", companyId: "other-co" }) },
        productApprovalSnapshot: { findFirst: jest.fn().mockResolvedValue({ id: "snap-1" }) },
        productReport: {
          create: jest.fn().mockRejectedValue(p2002),
          findMany: jest.fn(),
          findUnique: jest.fn(),
          findUniqueOrThrow: jest.fn(),
        },
      });
      const service = new ProductReportsService(prisma, auditStub as never);

      await expect(
        service.create({ productId: "p1", reasonCode: "OTHER", reasonDetails: "x" } as never, ctx)
      ).rejects.toMatchObject({ response: expect.objectContaining({ code: "CONFLICT" }) });
    });
  });

  describe("admin transitions — atomic claim", () => {
    function buildTx(claimResult: unknown[]) {
      return {
        $queryRaw: jest.fn().mockResolvedValue(claimResult),
        productReport: {
          findUnique: jest.fn().mockResolvedValue({ id: "report-1", status: "OPEN" }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "report-1", status: "RESOLVED" }),
        },
        auditLog: { create: jest.fn() },
        outboxEvent: { create: jest.fn() },
      };
    }

    it("rejects resolving a report that isn't in an eligible status (claim matches nothing)", async () => {
      const tx = buildTx([]);
      const prisma = fakePrisma({ tx });
      const service = new ProductReportsService(prisma, auditStub as never);

      await expect(service.resolve("report-1", "handled", "admin-1", adminCtx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: "CONFLICT" }),
      });
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for a genuinely missing report", async () => {
      const tx = buildTx([]);
      tx.productReport.findUnique = jest.fn().mockResolvedValue(null);
      const prisma = fakePrisma({ tx });
      const service = new ProductReportsService(prisma, auditStub as never);

      await expect(service.resolve("missing", "x", "admin-1", adminCtx)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("resolves atomically with audit+outbox, never touching the product itself", async () => {
      const tx = buildTx([{ id: "report-1" }]);
      const prisma = fakePrisma({ tx });
      const service = new ProductReportsService(prisma, auditStub as never);

      await service.resolve("report-1", "confirmed, product suspended separately", "admin-1", adminCtx);

      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: "PRODUCT_REPORT_RESOLVED" }) })
      );
      expect(tx.outboxEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ eventType: "PRODUCT_REPORT_RESOLVED" }) })
      );
      expect((tx as Record<string, unknown>).product).toBeUndefined();
    });
  });
});
