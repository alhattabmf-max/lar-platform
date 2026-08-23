/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  NOT_A_TAX_INVOICE,
  SUPPLIER_ALLOCATION_DETAIL_KEYS,
  SUPPLIER_ORDER_DETAIL_KEYS,
  SUPPLIER_ORDER_SUMMARY_KEYS,
  DOCUMENT_SUMMARY_KEYS,
} from "@platform/types";
import { SupplierOrdersService } from "./supplier-orders.service";

/**
 * The supplier's orders, projected.
 *
 * The defect this replaces: `listForSupplier` returned a raw Prisma row from
 * the ADMIN's SELECT, carrying `traderCompanyId` and a Decimal `totalAmount`
 * that serialises to a JSON number.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY = "99999999-9999-4999-8999-999999999999";
const ORDER = "22222222-2222-4222-8222-222222222222";
const SCOPE = { companyId: COMPANY };

const PAST = new Date(Date.now() - 86_400_000);
const FUTURE = new Date(Date.now() + 86_400_000);

function allocationRow(overrides: Record<string, any> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    status: "AWAITING_PREPARATION",
    preparationDueAt: FUTURE,
    preparationStartedAt: null,
    readyToShipAt: null,
    shippedAt: null,
    deliveredAt: null,
    disputeWindowClosesAt: null,
    payoutSettledAt: null,
    shipmentTracking: null,
    dispute: null,
    financialSnapshot: { supplierPayableShareAmount: new Prisma.Decimal("400") },
    checkoutLocationAllocation: {
      quantity: 4,
      locationNameSnapshot: "الفرع الرئيسي",
      cityNameArSnapshot: "الرياض",
      cityNameEnSnapshot: "Riyadh",
      regionNameArSnapshot: "منطقة الرياض",
      regionNameEnSnapshot: "Riyadh Region",
      addressSnapshot: "طريق الملك فهد",
      contactNameSnapshot: "محمد",
      contactPhoneSnapshot: "+966500000001",
    },
    ...overrides,
  };
}

function orderRow(overrides: Record<string, any> = {}) {
  return {
    id: ORDER,
    status: "IN_FULFILLMENT",
    totalAmount: new Prisma.Decimal("995.5"),
    supplierPayableAmount: new Prisma.Decimal("900"),
    commissionAmount: new Prisma.Decimal("85.5"),
    commissionTaxAmount: new Prisma.Decimal("10"),
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
    allocations: [allocationRow()],
    ...overrides,
  };
}

function build(row: unknown, count = 1) {
  const findMany = jest.fn(async (..._args: any[]) => (row ? [row] : []));
  const findFirst = jest.fn(async (..._args: any[]) => row);
  const documentFindMany = jest.fn(async (..._args: any[]) => []);
  const service = new SupplierOrdersService({
    masterOrder: { findMany, findFirst, count: jest.fn(async () => count) },
    invoiceDocument: { findMany: documentFindMany },
  } as any);
  return { service, findMany, findFirst, documentFindMany };
}

describe("the projected order carries exactly its contract", () => {
  it("returns the declared summary keys — no more, no less", async () => {
    const { service } = build(orderRow());

    const page = await service.listOrders(SCOPE, {});

    expect(Object.keys(page.items[0]).sort()).toEqual([...SUPPLIER_ORDER_SUMMARY_KEYS].sort());
  });

  it("returns the declared detail and allocation keys", async () => {
    const { service } = build(orderRow());

    const order = await service.getOrder(SCOPE, ORDER);

    expect(Object.keys(order).sort()).toEqual([...SUPPLIER_ORDER_DETAIL_KEYS].sort());
    expect(Object.keys(order.allocations[0]).sort()).toEqual(
      [...SUPPLIER_ALLOCATION_DETAIL_KEYS].sort()
    );
  });

  it("names the trader nowhere", async () => {
    const { service } = build(orderRow());
    const serialised = JSON.stringify(await service.getOrder(SCOPE, ORDER));

    for (const forbidden of [
      "traderCompanyId",
      "traderTaxProfileSnapshot",
      "traderBillingLegalNameSnapshot",
      "checkoutSessionId",
      "paymentAttemptId",
      "acceptedByUserId",
      "policyAcceptanceId",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("carries the commission CHARGED but not how it was derived", async () => {
    const { service } = build(orderRow());
    const order = await service.getOrder(SCOPE, ORDER);

    expect(order.commissionAmount).toBe("85.50");
    expect(order.commissionTaxAmount).toBe("10.00");

    const serialised = JSON.stringify(order);
    for (const forbidden of [
      "commissionBase",
      "commissionRateBasisPoints",
      "commissionTaxRate",
      "commissionTaxRuleCode",
      "commissionTaxRuleVersion",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("carries no bank account, ledger or coordinate", async () => {
    const { service } = build(orderRow());
    const serialised = JSON.stringify(await service.getOrder(SCOPE, ORDER));

    for (const forbidden of [
      "supplierBankAccountId",
      "ledger",
      "journalEntry",
      "snapshotData",
      "latitude",
      "longitude",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("gives the courier the address and a contact", async () => {
    const { service } = build(orderRow());
    const allocation = (await service.getOrder(SCOPE, ORDER)).allocations[0];

    expect(allocation.address).toBe("طريق الملك فهد");
    expect(allocation.contactName).toBe("محمد");
    expect(allocation.contactPhone).toBe("+966500000001");
  });
});

describe("money is a fixed-scale decimal string everywhere", () => {
  it("renders every amount at scale two", async () => {
    const { service } = build(orderRow());
    const order = await service.getOrder(SCOPE, ORDER);

    // 995.5 must serialise as "995.50". A trimmed trailing zero is the shape
    // that gets re-parsed as a float somewhere downstream.
    expect(order.totalAmount).toBe("995.50");
    expect(order.supplierPayableAmount).toBe("900.00");
    expect(order.allocations[0].supplierPayableShareAmount).toBe("400.00");

    for (const value of [
      order.totalAmount,
      order.supplierPayableAmount,
      order.commissionAmount,
      order.commissionTaxAmount,
      order.allocations[0].supplierPayableShareAmount,
    ]) {
      expect(typeof value).toBe("string");
      expect(value).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("reports a missing financial snapshot as zero rather than crashing", async () => {
    const { service } = build(orderRow({ allocations: [allocationRow({ financialSnapshot: null })] }));

    expect((await service.getOrder(SCOPE, ORDER)).allocations[0].supplierPayableShareAmount).toBe(
      "0.00"
    );
  });
});

describe("ownership lives in the query", () => {
  it("scopes the list to the caller's company", async () => {
    const { service, findMany } = build(orderRow());

    await service.listOrders(SCOPE, {});

    expect((findMany.mock.calls[0][0] as any).where).toEqual({ supplierCompanyId: COMPANY });
  });

  it("scopes the detail to the id AND the company together", async () => {
    const { service, findFirst } = build(orderRow());

    await service.getOrder(SCOPE, ORDER);

    expect((findFirst.mock.calls[0][0] as any).where).toEqual({
      id: ORDER,
      supplierCompanyId: COMPANY,
    });
  });

  it("answers another supplier's order with 404, the same as an unknown one", async () => {
    // A 403 would confirm the order exists and belongs to someone.
    const { service } = build(null);

    await expect(
      service.getOrder({ companyId: OTHER_COMPANY }, ORDER)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("orders the list deterministically, terminating in the id", async () => {
    const { service, findMany } = build(orderRow());

    await service.listOrders(SCOPE, {});

    expect((findMany.mock.calls[0][0] as any).orderBy).toEqual([
      { paidAt: "desc" },
      { id: "asc" },
    ]);
  });
});

describe("the aggregates that make a list one request", () => {
  it("counts allocations by state without opening each order", async () => {
    const { service } = build(
      orderRow({
        allocations: [
          allocationRow({ status: "AWAITING_PREPARATION" }),
          allocationRow({ status: "DELIVERED" }),
          allocationRow({ status: "SHIPPED" }),
        ],
      })
    );

    const summary = (await service.listOrders(SCOPE, {})).items[0];

    expect(summary.allocationCount).toBe(3);
    expect(summary.awaitingPreparationCount).toBe(1);
    expect(summary.deliveredAllocationCount).toBe(1);
  });

  it("flags an overdue preparation only while nothing has shipped", async () => {
    const overdue = build(
      orderRow({ allocations: [allocationRow({ preparationDueAt: PAST, shippedAt: null })] })
    );
    expect((await overdue.service.listOrders(SCOPE, {})).items[0].hasOverduePreparation).toBe(true);

    // Past its date but already shipped: not overdue. The deadline was for
    // preparation, and preparation finished.
    const shipped = build(
      orderRow({ allocations: [allocationRow({ preparationDueAt: PAST, shippedAt: PAST })] })
    );
    expect((await shipped.service.listOrders(SCOPE, {})).items[0].hasOverduePreparation).toBe(
      false
    );
  });
});

describe("order documents", () => {
  it("checks ownership before reading a single document", async () => {
    const { service, findFirst } = build(null);

    await expect(service.listDocuments(SCOPE, ORDER)).rejects.toBeInstanceOf(NotFoundException);
    expect((findFirst.mock.calls[0][0] as any).where).toEqual({
      id: ORDER,
      supplierCompanyId: COMPANY,
    });
  });

  it("returns the commission draft — the supplier is party to that charge", async () => {
    // The opposite of the trader's rule, and deliberately so: billing someone
    // without letting them see what for is not defensible.
    const { service, documentFindMany } = build(orderRow());
    documentFindMany.mockResolvedValue([
      {
        id: "d1",
        documentType: "INTERNAL_COMMISSION_DRAFT",
        amount: new Prisma.Decimal("95.5"),
        currency: "SAR",
        issuedAt: new Date("2026-08-02T00:00:00.000Z"),
        internalDocumentReference: "REF-1",
      },
    ] as any);

    const documents = await service.listDocuments(SCOPE, ORDER);

    expect(documents[0].documentType).toBe("INTERNAL_COMMISSION_DRAFT");
    expect(Object.keys(documents[0]).sort()).toEqual([...DOCUMENT_SUMMARY_KEYS].sort());
    expect(documents[0].amount).toBe("95.50");
    // The legal notice on every item, from the contract's constant.
    expect(documents[0].notice).toBe(NOT_A_TAX_INVOICE);
  });

  it("never selects snapshotData, and offers no PDF, QR or ZATCA field", async () => {
    const { service, documentFindMany } = build(orderRow());

    await service.listDocuments(SCOPE, ORDER);

    const select = (documentFindMany.mock.calls[0][0] as any).select;
    expect(Object.keys(select)).not.toContain("snapshotData");
    for (const forbidden of ["pdf", "qrCode", "zatca", "clearance"]) {
      expect(Object.keys(select).join(" ").toLowerCase()).not.toContain(forbidden);
    }
  });
});
