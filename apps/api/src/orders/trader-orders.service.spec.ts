/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  DISPUTE_STATUSES,
  DOCUMENT_SUMMARY_KEYS,
  MASTER_ORDER_STATUSES,
  MAX_TRADER_PAGE_SIZE,
  NOT_A_TAX_INVOICE,
  ORDER_ALLOCATION_DETAIL_KEYS,
  ORDER_ALLOCATION_STATUSES,
  ORDER_DETAIL_KEYS,
  ORDER_SUMMARY_KEYS,
  REPLACEMENT_OBLIGATION_STATUSES,
  REPLACEMENT_SUMMARY_KEYS,
} from "@platform/types";
import { TraderOrdersService } from "./trader-orders.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ORDER = "22222222-2222-2222-2222-222222222222";
const ALLOCATION = "33333333-3333-3333-3333-333333333333";
const SCOPE = { companyId: COMPANY };

const PAST = new Date(Date.now() - 86_400_000);
const FUTURE = new Date(Date.now() + 86_400_000);

function orderRow(overrides: Record<string, any> = {}) {
  return {
    id: ORDER,
    status: "IN_FULFILLMENT",
    totalAmount: new Prisma.Decimal("1200.5"),
    paidAt: new Date("2026-08-01T00:00:00.000Z"),
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    paymentAttempt: { currency: "SAR" },
    checkoutSession: {
      opportunity: {
        salesUnitNameAr: "كرتون",
        salesUnitNameEn: "Carton",
        productApprovalSnapshot: { snapshot: { nameAr: "منتج", nameEn: "Product" } },
      },
    },
    allocations: [
      { id: ALLOCATION, status: "DELIVERED", preparationDueAt: PAST, shippedAt: PAST },
    ],
    ...overrides,
  };
}

function allocationRow(overrides: Record<string, any> = {}) {
  return {
    id: ALLOCATION,
    status: "SHIPPED",
    preparationDueAt: PAST,
    preparationStartedAt: PAST,
    readyToShipAt: PAST,
    shippedAt: PAST,
    deliveredAt: null,
    disputeWindowClosesAt: null,
    checkoutLocationAllocation: {
      quantity: 5,
      locationNameSnapshot: "Main warehouse",
      cityNameArSnapshot: "الرياض",
      cityNameEnSnapshot: "Riyadh",
      regionNameArSnapshot: "منطقة الرياض",
      regionNameEnSnapshot: "Riyadh Region",
      addressSnapshot: "Street 1",
    },
    shipmentTracking: { carrierCode: "DHL", trackingNumber: "TRK1" },
    dispute: null,
    ...overrides,
  };
}

function harness(overrides: Record<string, any> = {}) {
  const orderFindMany = jest.fn((..._a: any[]) => Promise.resolve([orderRow()]));
  const orderFindFirst = jest.fn((..._a: any[]) =>
    Promise.resolve({ ...orderRow(), allocations: [allocationRow()] })
  );
  const orderCount = jest.fn((..._a: any[]) => Promise.resolve(1));

  const prisma = {
    masterOrder: { findMany: orderFindMany, findFirst: orderFindFirst, count: orderCount },
    invoiceDocument: {
      findMany: jest.fn((..._a: any[]) =>
        Promise.resolve([
          {
            id: "doc-1",
            documentType: "INTERNAL_PRODUCT_DRAFT",
            amount: new Prisma.Decimal("1200.5"),
            currency: "SAR",
            issuedAt: new Date("2026-08-02T00:00:00.000Z"),
            internalDocumentReference: "REF-1",
          },
        ])
      ),
    },
    dispute: {
      findMany: jest.fn((..._a: any[]) =>
        Promise.resolve([
          {
            id: "dis-1",
            status: "OPEN",
            reasonCode: "DAMAGED",
            openedAt: PAST,
            supplierResponseDueAt: FUTURE,
            orderAllocationId: ALLOCATION,
            orderAllocation: { masterOrderId: ORDER },
          },
        ])
      ),
      count: jest.fn((..._a: any[]) => Promise.resolve(1)),
    },
    replacementObligation: {
      findMany: jest.fn((..._a: any[]) =>
        Promise.resolve([
          {
            id: "rep-1",
            status: "SHIPPED",
            replacementQuantity: 2,
            createdAt: PAST,
            shippedAt: PAST,
            deliveredAt: null,
            failedAt: null,
            originalOrderAllocationId: ALLOCATION,
            originalOrderAllocation: { masterOrderId: ORDER },
          },
        ])
      ),
      findFirst: jest.fn((..._a: any[]) =>
        Promise.resolve({
          id: "rep-1",
          status: "FAILED",
          replacementQuantity: 2,
          createdAt: PAST,
          shippedAt: null,
          deliveredAt: null,
          failedAt: PAST,
          originalOrderAllocationId: ALLOCATION,
          originalOrderAllocation: { masterOrderId: ORDER },
          preparationStartedAt: PAST,
          readyToShipAt: null,
          shipmentTracking: null,
          disputeDecision: { disputeId: "dis-1" },
        })
      ),
      count: jest.fn((..._a: any[]) => Promise.resolve(1)),
    },
    ...overrides,
  };

  return { prisma, service: new TraderOrdersService(prisma as never) };
}

describe("ownership lives in the query", () => {
  it.each([
    ["orders list", (s: TraderOrdersService) => s.listOrders(SCOPE, {}), "masterOrder", "findMany"],
    ["disputes list", (s: TraderOrdersService) => s.listDisputes(SCOPE, {}), "dispute", "findMany"],
    ["replacements list", (s: TraderOrdersService) => s.listReplacements(SCOPE, {}), "replacementObligation", "findMany"],
  ])("%s constrains by the trader company", async (_label, call, model, method) => {
    const h = harness();

    await call(h.service);

    expect(JSON.stringify((h.prisma as any)[model][method].mock.calls[0][0].where)).toContain(
      COMPANY
    );
  });

  it("the order detail filters by id AND company in one WHERE", async () => {
    const h = harness();

    await h.service.getOrder(SCOPE, ORDER);

    expect(h.prisma.masterOrder.findFirst.mock.calls[0][0].where).toEqual({
      id: ORDER,
      traderCompanyId: COMPANY,
    });
  });

  it.each([
    ["an order", (s: TraderOrdersService) => s.getOrder(SCOPE, ORDER)],
    ["documents", (s: TraderOrdersService) => s.listDocuments(SCOPE, ORDER)],
  ])("%s belonging to another company is a 404, not a 403", async (_label, call) => {
    const h = harness({
      masterOrder: {
        findMany: jest.fn(() => Promise.resolve([])),
        findFirst: jest.fn(() => Promise.resolve(null)),
        count: jest.fn(() => Promise.resolve(0)),
      },
    });

    // A 403 would confirm the id exists.
    await expect(call(h.service)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a replacement belonging to another company is a 404", async () => {
    const h = harness({
      replacementObligation: {
        findMany: jest.fn(() => Promise.resolve([])),
        findFirst: jest.fn(() => Promise.resolve(null)),
        count: jest.fn(() => Promise.resolve(0)),
      },
    });

    await expect(h.service.getReplacement(SCOPE, "rep-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("scopes a replacement through its allocation's order", async () => {
    const h = harness();

    await h.service.getReplacement(SCOPE, "rep-1");

    expect(
      JSON.stringify(h.prisma.replacementObligation.findFirst.mock.calls[0][0].where)
    ).toContain(COMPANY);
  });
});

describe("pagination is bounded and deterministic", () => {
  it.each([
    ["orders", (s: TraderOrdersService) => s.listOrders(SCOPE, { pageSize: 5000 })],
    ["disputes", (s: TraderOrdersService) => s.listDisputes(SCOPE, { pageSize: 5000 })],
    ["replacements", (s: TraderOrdersService) => s.listReplacements(SCOPE, { pageSize: 5000 })],
  ])("%s clamps the page size to the ceiling", async (_label, call) => {
    const h = harness();

    const result = await call(h.service);

    expect(result.pageSize).toBe(MAX_TRADER_PAGE_SIZE);
  });

  it.each([
    ["orders", "masterOrder"],
    ["disputes", "dispute"],
    ["replacements", "replacementObligation"],
  ])("%s orders deterministically, terminating in id", async (label, model) => {
    const h = harness();

    if (label === "orders") await h.service.listOrders(SCOPE, {});
    if (label === "disputes") await h.service.listDisputes(SCOPE, {});
    if (label === "replacements") await h.service.listReplacements(SCOPE, {});

    const orderBy = (h.prisma as any)[model].findMany.mock.calls[0][0].orderBy;
    expect(orderBy[orderBy.length - 1]).toEqual({ id: "asc" });
  });

  it("advances skip by exactly one page", async () => {
    const h = harness();

    await h.service.listOrders(SCOPE, { page: 3, pageSize: 10 });

    expect(h.prisma.masterOrder.findMany.mock.calls[0][0].skip).toBe(20);
    expect(h.prisma.masterOrder.findMany.mock.calls[0][0].take).toBe(10);
  });

  it("counts against the same predicate the page was read with", async () => {
    const h = harness();

    await h.service.listOrders(SCOPE, { page: 2 });

    expect(h.prisma.masterOrder.count.mock.calls[0][0].where).toEqual(
      h.prisma.masterOrder.findMany.mock.calls[0][0].where
    );
  });

  it("never issues an unbounded query", async () => {
    const h = harness();

    await h.service.listOrders(SCOPE, {});
    await h.service.listDisputes(SCOPE, {});
    await h.service.listReplacements(SCOPE, {});

    for (const model of ["masterOrder", "dispute", "replacementObligation"]) {
      expect((h.prisma as any)[model].findMany.mock.calls[0][0].take).toBeDefined();
    }
  });
});

describe("the order projection withholds every internal financial field", () => {
  it("returns exactly the summary keys", async () => {
    const h = harness();

    const item = (await h.service.listOrders(SCOPE, {})).items[0];

    expect(Object.keys(item).sort()).toEqual([...ORDER_SUMMARY_KEYS].sort());
  });

  it("returns exactly the detail keys", async () => {
    const h = harness();

    const detail = await h.service.getOrder(SCOPE, ORDER);

    expect(Object.keys(detail).sort()).toEqual([...ORDER_DETAIL_KEYS].sort());
  });

  it.each([
    "commissionBase",
    "commissionAmount",
    "commissionRateBasisPoints",
    "commissionTaxAmount",
    "supplierPayableAmount",
    "supplierBankAccountId",
    "supplierLegalNameSnapshot",
    "supplierCrNumberSnapshot",
    "supplierTaxProfileSnapshot",
    "policyAcceptanceId",
  ])("never exposes %s", async (field) => {
    const h = harness();

    const serialised = JSON.stringify(await h.service.getOrder(SCOPE, ORDER));

    expect(serialised).not.toContain(field);
  });

  it("never selects those columns in the first place", async () => {
    const h = harness();

    await h.service.listOrders(SCOPE, {});
    const select = JSON.stringify(h.prisma.masterOrder.findMany.mock.calls[0][0].select);

    expect(select).not.toContain("commission");
    expect(select).not.toContain("supplierPayable");
    expect(select).not.toContain("BankAccount");
  });

  it("formats money as a fixed-scale decimal string", async () => {
    const h = harness();

    const item = (await h.service.listOrders(SCOPE, {})).items[0];

    expect(item.totalAmount).toBe("1200.50");
    expect(typeof item.totalAmount).toBe("string");
  });

  it("takes the currency from the payment attempt, not a guess", async () => {
    const h = harness();

    expect((await h.service.listOrders(SCOPE, {})).items[0].currency).toBe("SAR");
  });
});

describe("the list answers progress without N+1", () => {
  it("aggregates allocation counts server-side", async () => {
    const h = harness({
      masterOrder: {
        findMany: jest.fn(() =>
          Promise.resolve([
            orderRow({
              allocations: [
                { id: "a", status: "DELIVERED", preparationDueAt: PAST, shippedAt: PAST },
                { id: "b", status: "SHIPPED", preparationDueAt: PAST, shippedAt: PAST },
                { id: "c", status: "PREPARING", preparationDueAt: FUTURE, shippedAt: null },
              ],
            }),
          ])
        ),
        findFirst: jest.fn(() => Promise.resolve(null)),
        count: jest.fn(() => Promise.resolve(1)),
      },
    });

    const item = (await h.service.listOrders(SCOPE, {})).items[0];

    expect(item.allocationCount).toBe(3);
    expect(item.deliveredAllocationCount).toBe(1);
  });

  it("flags an overdue preparation so the list can show what needs attention", async () => {
    const h = harness({
      masterOrder: {
        findMany: jest.fn(() =>
          Promise.resolve([
            orderRow({
              allocations: [
                { id: "a", status: "PREPARING", preparationDueAt: PAST, shippedAt: null },
              ],
            }),
          ])
        ),
        findFirst: jest.fn(() => Promise.resolve(null)),
        count: jest.fn(() => Promise.resolve(1)),
      },
    });

    expect((await h.service.listOrders(SCOPE, {})).items[0].hasOverduePreparation).toBe(true);
  });

  it("does not call an allocation shipped late overdue", async () => {
    const h = harness({
      masterOrder: {
        findMany: jest.fn(() =>
          Promise.resolve([
            orderRow({
              allocations: [
                { id: "a", status: "SHIPPED", preparationDueAt: PAST, shippedAt: PAST },
              ],
            }),
          ])
        ),
        findFirst: jest.fn(() => Promise.resolve(null)),
        count: jest.fn(() => Promise.resolve(1)),
      },
    });

    // It missed its deadline, but it is no longer waiting on anyone.
    expect((await h.service.listOrders(SCOPE, {})).items[0].hasOverduePreparation).toBe(false);
  });
});

describe("allocations arrive inline, ordered, and trader-scoped", () => {
  it("returns exactly the allocation keys", async () => {
    const h = harness();

    const detail = await h.service.getOrder(SCOPE, ORDER);

    expect(Object.keys(detail.allocations[0]).sort()).toEqual(
      [...ORDER_ALLOCATION_DETAIL_KEYS].sort()
    );
  });

  it("orders allocations deterministically", async () => {
    const h = harness({
      masterOrder: {
        findMany: jest.fn(() => Promise.resolve([])),
        count: jest.fn(() => Promise.resolve(0)),
        findFirst: jest.fn(() =>
          Promise.resolve({
            ...orderRow(),
            allocations: [
              allocationRow({ id: "ccc" }),
              allocationRow({ id: "aaa" }),
              allocationRow({ id: "bbb" }),
            ],
          })
        ),
      },
    });

    const detail = await h.service.getOrder(SCOPE, ORDER);

    expect(detail.allocations.map((a) => a.id)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("carries the trader's OWN delivery location and their tracking", async () => {
    const h = harness();

    const allocation = (await h.service.getOrder(SCOPE, ORDER)).allocations[0];

    expect(allocation.locationName).toBe("Main warehouse");
    expect(allocation.carrierCode).toBe("DHL");
    expect(allocation.trackingNumber).toBe("TRK1");
  });

  it("links an existing dispute so a notification can reach it", async () => {
    const h = harness({
      masterOrder: {
        findMany: jest.fn(() => Promise.resolve([])),
        count: jest.fn(() => Promise.resolve(0)),
        findFirst: jest.fn(() =>
          Promise.resolve({
            ...orderRow(),
            allocations: [allocationRow({ dispute: { id: "dis-9" } })],
          })
        ),
      },
    });

    expect((await h.service.getOrder(SCOPE, ORDER)).allocations[0].disputeId).toBe("dis-9");
  });

  it("reports no dispute as null rather than omitting the field", async () => {
    const h = harness();

    expect((await h.service.getOrder(SCOPE, ORDER)).allocations[0].disputeId).toBeNull();
  });
});

describe("documents are whitelisted, and commission is withheld", () => {
  it("returns exactly the document keys", async () => {
    const h = harness();

    const documents = await h.service.listDocuments(SCOPE, ORDER);

    expect(Object.keys(documents[0]).sort()).toEqual([...DOCUMENT_SUMMARY_KEYS].sort());
  });

  it("excludes INTERNAL_COMMISSION_DRAFT in the QUERY, not afterwards", async () => {
    const h = harness();

    await h.service.listDocuments(SCOPE, ORDER);
    const where = h.prisma.invoiceDocument.findMany.mock.calls[0][0].where;

    expect(where.documentType.in).toEqual(["INTERNAL_PRODUCT_DRAFT", "INTERNAL_ADJUSTMENT_DRAFT"]);
    expect(where.documentType.in).not.toContain("INTERNAL_COMMISSION_DRAFT");
  });

  it("never selects the raw snapshotData", async () => {
    const h = harness();

    await h.service.listDocuments(SCOPE, ORDER);

    expect(
      JSON.stringify(h.prisma.invoiceDocument.findMany.mock.calls[0][0].select)
    ).not.toContain("snapshotData");
  });

  it("always carries the NOT_A_TAX_INVOICE notice", async () => {
    const h = harness();

    const documents = await h.service.listDocuments(SCOPE, ORDER);

    expect(documents[0].notice).toBe(NOT_A_TAX_INVOICE);
  });

  it("offers no PDF, QR code or ZATCA identifier", async () => {
    const h = harness();

    const serialised = JSON.stringify(await h.service.listDocuments(SCOPE, ORDER));

    for (const forbidden of ["pdf", "qr", "zatca", "clearance", "reporting", "uuid"]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("makes no affirmative tax-invoice claim", async () => {
    const h = harness();

    const serialised = JSON.stringify(await h.service.listDocuments(SCOPE, ORDER)).toLowerCase();

    expect(serialised).not.toMatch(/tax invoice (certified|approved|compliant|valid)/);
  });
});

describe("disputes keep every resolved outcome distinct", () => {
  it("returns the real status, never a collapsed one", async () => {
    for (const status of DISPUTE_STATUSES) {
      const h = harness({
        dispute: {
          findMany: jest.fn(() =>
            Promise.resolve([
              {
                id: "d",
                status,
                reasonCode: "DAMAGED",
                openedAt: PAST,
                supplierResponseDueAt: FUTURE,
                orderAllocationId: ALLOCATION,
                orderAllocation: { masterOrderId: ORDER },
              },
            ])
          ),
          count: jest.fn(() => Promise.resolve(1)),
        },
      });

      expect((await h.service.listDisputes(SCOPE, {})).items[0].status).toBe(status);
    }
  });

  it("links each dispute to its order and allocation", async () => {
    const h = harness();

    const item = (await h.service.listDisputes(SCOPE, {})).items[0];

    expect(item.orderId).toBe(ORDER);
    expect(item.allocationId).toBe(ALLOCATION);
  });

  it("marks whether the trader is waiting on someone else", async () => {
    const h = harness();

    expect((await h.service.listDisputes(SCOPE, {})).items[0].awaitingCounterparty).toBe(true);
  });

  it("exposes no supplier response body or evidence content", async () => {
    const h = harness();

    const serialised = JSON.stringify(await h.service.listDisputes(SCOPE, {}));

    // Scoped to the response BODY and evidence content.
    // Scoped to the response BODY and to evidence content.
    // `supplierResponseDueAt` is a deadline the trader is entitled to
    // see, so a bare "supplierResponse" substring would fire on it.
    for (const forbidden of [
      "evidence",
      "storageObjectKey",
      "responseType",
      "supplierResponseBody",
      "description",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe("replacements", () => {
  it("returns exactly the summary keys", async () => {
    const h = harness();

    const item = (await h.service.listReplacements(SCOPE, {})).items[0];

    expect(Object.keys(item).sort()).toEqual([...REPLACEMENT_SUMMARY_KEYS].sort());
  });

  it("closes the REPLACEMENT_FAILED action target with a real detail route", async () => {
    const h = harness();

    const detail = await h.service.getReplacement(SCOPE, "rep-1");

    // The notification points here; before 8D.3 there was nowhere to go.
    expect(detail.status).toBe("FAILED");
    expect(detail.failedAt).not.toBeNull();
    expect(detail.disputeId).toBe("dis-1");
  });

  it("reports the real status vocabulary", async () => {
    for (const status of REPLACEMENT_OBLIGATION_STATUSES) {
      const h = harness({
        replacementObligation: {
          findMany: jest.fn(() =>
            Promise.resolve([
              {
                id: "r",
                status,
                replacementQuantity: 1,
                createdAt: PAST,
                shippedAt: null,
                deliveredAt: null,
                failedAt: null,
                originalOrderAllocationId: ALLOCATION,
                originalOrderAllocation: { masterOrderId: ORDER },
              },
            ])
          ),
          findFirst: jest.fn(() => Promise.resolve(null)),
          count: jest.fn(() => Promise.resolve(1)),
        },
      });

      expect((await h.service.listReplacements(SCOPE, {})).items[0].status).toBe(status);
    }
  });
});

describe("the status vocabularies match the database", () => {
  it("carries every real master order status and no invented one", () => {
    expect([...MASTER_ORDER_STATUSES]).toEqual(["IN_FULFILLMENT", "FULFILLED"]);
    for (const invented of ["CANCELLED", "PENDING", "REFUNDED", "COMPLETED"]) {
      expect(MASTER_ORDER_STATUSES).not.toContain(invented);
    }
  });

  it("carries every real allocation status, in the order a share travels", () => {
    // AWAITING_FUNDING IS FIRST, AND IT IS NEW — «إذا اكتمل الهدف يتم
    // إرسال الطلبات للمورد». A share is paid for and then WAITS for the
    // offer to reach its target; only then does the supplier owe work.
    //
    // `AWAITING_PREPARATION` used to mean both things at once — "paid,
    // waiting for the others" and "the target is in, the clock runs" —
    // and every screen had to guess which. Two meanings, two names.
    expect([...ORDER_ALLOCATION_STATUSES]).toEqual([
      "AWAITING_FUNDING",
      "AWAITING_PREPARATION",
      "PREPARING",
      "READY_TO_SHIP",
      "SHIPPED",
      "DELIVERED",
    ]);
  });
});

describe("structural contract", () => {
  const SOURCE = readFileSync(join(__dirname, "trader-orders.service.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never spreads a database row into a response", () => {
    expect(SOURCE).not.toMatch(/\.\.\.row\b/);
    expect(SOURCE).not.toMatch(/\.\.\.document\b/);
  });

  it("never throws Forbidden — the answer is always 404", () => {
    expect(SOURCE).not.toContain("ForbiddenException");
  });

  it("selects explicitly rather than including whole relations", () => {
    expect(SOURCE).not.toMatch(/include:\s*\{/);
  });
});
