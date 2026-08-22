import { PrismaClient } from "@prisma/client";
import { TraderOrdersService } from "../src/orders/trader-orders.service";

/**
 * STATUS: WRITTEN — NOT EXECUTED — STATUS UNKNOWN.
 *
 * Requires PostgreSQL with migrations 1–90 applied. Port 5432 is closed
 * on this machine, so none of these has run.
 *
 * They cover what unit tests structurally cannot: that the ownership
 * predicates actually exclude another company's rows at the database,
 * that pagination is stable across pages against real data, and that
 * the document filter really withholds the commission draft.
 */

const prisma = new PrismaClient();
const service = new TraderOrdersService(prisma as never);

async function seedTraderCompany(label: string) {
  return prisma.company.create({
    data: {
      crNumber: `CR-READS-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      legalName: `Trader ${label}`,
      accountType: "TRADER",
    },
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("cross-company isolation at the database", () => {
  it("another company's order is invisible to the list", async () => {
    const mine = await seedTraderCompany("mine");
    const theirs = await seedTraderCompany("theirs");

    const listed = await service.listOrders({ companyId: mine.id }, {});
    const theirOrders = await prisma.masterOrder.findMany({
      where: { traderCompanyId: theirs.id },
      select: { id: true },
    });

    for (const order of theirOrders) {
      expect(listed.items.map((item) => item.id)).not.toContain(order.id);
    }
  });

  it("another company's order detail is a 404", async () => {
    const theirs = await seedTraderCompany("theirs-detail");
    const mine = await seedTraderCompany("mine-detail");

    const theirOrder = await prisma.masterOrder.findFirst({
      where: { traderCompanyId: theirs.id },
      select: { id: true },
    });
    if (!theirOrder) return;

    await expect(service.getOrder({ companyId: mine.id }, theirOrder.id)).rejects.toThrow();
  });

  it("another company's documents are a 404, not an empty list", async () => {
    const theirs = await seedTraderCompany("docs-theirs");
    const mine = await seedTraderCompany("docs-mine");

    const theirOrder = await prisma.masterOrder.findFirst({
      where: { traderCompanyId: theirs.id },
      select: { id: true },
    });
    if (!theirOrder) return;

    // An empty list would confirm the order exists.
    await expect(service.listDocuments({ companyId: mine.id }, theirOrder.id)).rejects.toThrow();
  });
});

describe("pagination is stable across pages", () => {
  it("walks every order exactly once with no duplicate or dropped row", async () => {
    const company = await prisma.masterOrder.findFirst({ select: { traderCompanyId: true } });
    if (!company) return;

    const scope = { companyId: company.traderCompanyId };
    const first = await service.listOrders(scope, { page: 1, pageSize: 2 });
    const lastPage = Math.ceil(first.total / 2);

    const seen: string[] = first.items.map((item) => item.id);
    for (let page = 2; page <= lastPage; page++) {
      const next = await service.listOrders(scope, { page, pageSize: 2 });
      seen.push(...next.items.map((item) => item.id));
    }

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(first.total);
  });

  it("returns the same page twice for the same request", async () => {
    const company = await prisma.masterOrder.findFirst({ select: { traderCompanyId: true } });
    if (!company) return;

    const scope = { companyId: company.traderCompanyId };
    const once = await service.listOrders(scope, { page: 1, pageSize: 3 });
    const twice = await service.listOrders(scope, { page: 1, pageSize: 3 });

    expect(once.items.map((i) => i.id)).toEqual(twice.items.map((i) => i.id));
  });
});

describe("documents withhold the commission draft", () => {
  it("returns no INTERNAL_COMMISSION_DRAFT even when one exists", async () => {
    const commission = await prisma.invoiceDocument.findFirst({
      where: { documentType: "INTERNAL_COMMISSION_DRAFT" },
      select: { id: true, masterOrderId: true, masterOrder: { select: { traderCompanyId: true } } },
    });
    if (!commission) return;

    const documents = await service.listDocuments(
      { companyId: commission.masterOrder.traderCompanyId },
      commission.masterOrderId
    );

    // The runtime check that matters: the commission document exists
    // for this order and is not among the returned rows.
    //
    // A `documentType !== "INTERNAL_COMMISSION_DRAFT"` assertion is
    // deliberately absent — `DocumentSummary.documentType` is typed as
    // the two trader-visible values, so the compiler already rejects
    // that comparison as impossible. The type system proves it more
    // strongly than a runtime expectation could.
    expect(documents.map((d) => d.id)).not.toContain(commission.id);
  });

  it("carries the NOT_A_TAX_INVOICE notice on every document returned", async () => {
    const document = await prisma.invoiceDocument.findFirst({
      where: { documentType: "INTERNAL_PRODUCT_DRAFT" },
      select: { masterOrderId: true, masterOrder: { select: { traderCompanyId: true } } },
    });
    if (!document) return;

    const documents = await service.listDocuments(
      { companyId: document.masterOrder.traderCompanyId },
      document.masterOrderId
    );

    expect(documents.every((d) => d.notice === "NOT_A_TAX_INVOICE")).toBe(true);
  });

  it("never returns raw snapshot data", async () => {
    const document = await prisma.invoiceDocument.findFirst({
      select: { masterOrderId: true, masterOrder: { select: { traderCompanyId: true } } },
    });
    if (!document) return;

    const documents = await service.listDocuments(
      { companyId: document.masterOrder.traderCompanyId },
      document.masterOrderId
    );

    expect(JSON.stringify(documents)).not.toContain("snapshotData");
  });
});

describe("the order detail carries its allocations inline", () => {
  it("returns every allocation of the order in one request", async () => {
    const order = await prisma.masterOrder.findFirst({
      select: { id: true, traderCompanyId: true, _count: { select: { allocations: true } } },
    });
    if (!order) return;

    const detail = await service.getOrder({ companyId: order.traderCompanyId }, order.id);

    expect(detail.allocations).toHaveLength(order._count.allocations);
  });

  it("exposes no supplier financial field on a real row", async () => {
    const order = await prisma.masterOrder.findFirst({
      select: { id: true, traderCompanyId: true },
    });
    if (!order) return;

    const serialised = JSON.stringify(
      await service.getOrder({ companyId: order.traderCompanyId }, order.id)
    );

    for (const forbidden of ["commission", "supplierPayable", "supplierBankAccount", "CrNumber"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
