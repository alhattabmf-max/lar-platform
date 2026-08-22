/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  CHECKOUT_ALLOCATION_VIEW_KEYS,
  CHECKOUT_SESSION_STATUSES,
  CHECKOUT_SESSION_VIEW_KEYS,
  isPaidCheckoutSession,
} from "@platform/types";
import {
  CHECKOUT_SESSION_VIEW_SELECT,
  CheckoutInvariantError,
  toCheckoutSessionView,
} from "./checkout-session.view";
import { CheckoutSessionService } from "./checkout-session.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "99999999-9999-9999-9999-999999999999";
const SESSION = "22222222-2222-2222-2222-222222222222";
const ORDER = "33333333-3333-3333-3333-333333333333";
const LOCATION = "44444444-4444-4444-4444-444444444444";

const CTX = { userId: "u", companyId: COMPANY, requestId: "req-1" };

function quoteRow(overrides: Record<string, any> = {}) {
  return {
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    shareQuantity: 4,
    currency: "SAR",
    unitPriceInclTaxAmount: new Prisma.Decimal("115"),
    productsSubtotalExclTaxAmount: new Prisma.Decimal("800"),
    productsTaxAmount: new Prisma.Decimal("120"),
    productsSubtotalInclTaxAmount: new Prisma.Decimal("920"),
    totalShippingFeeAmount: new Prisma.Decimal("75.5"),
    grandTotalAmount: new Prisma.Decimal("995.5"),
    ...overrides,
  };
}

function allocationRow(overrides: Record<string, any> = {}) {
  return {
    companyLocationId: LOCATION,
    locationNameSnapshot: "الفرع الرئيسي",
    cityNameArSnapshot: "الرياض",
    cityNameEnSnapshot: "Riyadh",
    regionNameArSnapshot: "منطقة الرياض",
    regionNameEnSnapshot: "Riyadh Region",
    addressSnapshot: "طريق الملك فهد",
    quantity: 8,
    shippingFeeAmount: new Prisma.Decimal("75.5"),
    ...overrides,
  };
}

function sessionRow(overrides: Record<string, any> = {}) {
  return {
    id: SESSION,
    opportunityId: "55555555-5555-5555-5555-555555555555",
    status: "LOCKED",
    lockedQuantity: 8,
    lockExpiresAt: new Date("2026-08-21T12:00:00.000Z"),
    paymentDeadlineAt: null,
    quoteSnapshot: quoteRow(),
    allocations: [allocationRow()],
    order: null,
    ...overrides,
  };
}

describe("toCheckoutSessionView", () => {
  it("returns exactly the shared contract keys — no more, no less", () => {
    const view = toCheckoutSessionView(sessionRow() as any);
    expect(Object.keys(view).sort()).toEqual([...CHECKOUT_SESSION_VIEW_KEYS].sort());
    expect(Object.keys(view.allocations[0]).sort()).toEqual(
      [...CHECKOUT_ALLOCATION_VIEW_KEYS].sort()
    );
  });

  it("carries no trace of the raw quote snapshot", () => {
    const view = toCheckoutSessionView(sessionRow() as any);
    expect(view).not.toHaveProperty("quoteSnapshot");
    // The quote's own internal tax working — the exclusive-of-tax unit
    // price, the per-unit tax and the rate — is what the platform used
    // to arrive at the total. The trader is charged the total.
    const serialised = JSON.stringify(view);
    for (const field of [
      "unitPriceExclTaxAmount",
      "unitTaxAmount",
      "taxRatePercent",
      "taxCalculationRuleCode",
      "taxCalculationRuleVersion",
      "productApprovalSnapshotId",
      "shippingTariffPolicyVersionId",
      "shippingProviderCode",
      "sharePercentageReadable",
    ]) {
      expect(serialised).not.toContain(field);
    }
  });

  it("carries none of the session's internal or commercial internals", () => {
    const serialised = JSON.stringify(toCheckoutSessionView(sessionRow() as any));
    for (const field of [
      "traderCompanySnapshot",
      "traderCompanyId",
      "releaseReason",
      "lockReleasedAt",
      "lockCreatedAt",
      "capturedAt",
      "commission",
      "supplierPayable",
      "idempotency",
      "provider",
      "webhook",
      "latitude",
      "longitude",
      "contactPhone",
      "contactName",
      "shippingTierCode",
    ]) {
      expect(serialised).not.toContain(field);
    }
  });

  it("renders every money field as a fixed-scale decimal string", () => {
    const view = toCheckoutSessionView(sessionRow() as any);
    // 75.5 must serialise as "75.50". A trailing-zero-trimmed total is
    // the shape that later gets parsed back into a float somewhere.
    expect(view.totalShippingFeeAmount).toBe("75.50");
    expect(view.grandTotalAmount).toBe("995.50");
    expect(view.unitPriceInclTaxAmount).toBe("115.00");
    expect(view.productsSubtotalExclTaxAmount).toBe("800.00");
    expect(view.productsTaxAmount).toBe("120.00");
    expect(view.productsSubtotalInclTaxAmount).toBe("920.00");
    expect(view.allocations[0].shippingFeeAmount).toBe("75.50");

    for (const key of [
      "unitPriceInclTaxAmount",
      "productsSubtotalExclTaxAmount",
      "productsTaxAmount",
      "productsSubtotalInclTaxAmount",
      "totalShippingFeeAmount",
      "grandTotalAmount",
    ] as const) {
      expect(typeof view[key]).toBe("string");
      expect(view[key]).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("reads quantity from the LOCKED quantity, not the quote's requested quantity", () => {
    const view = toCheckoutSessionView(sessionRow({ lockedQuantity: 12 }) as any);
    expect(view.quantity).toBe(12);
    expect(view.shareQuantity).toBe(4);
  });

  it("emits ISO timestamps and a null payment deadline before any attempt", () => {
    const view = toCheckoutSessionView(sessionRow() as any);
    expect(view.lockExpiresAt).toBe("2026-08-21T12:00:00.000Z");
    expect(view.paymentDeadlineAt).toBeNull();

    const pending = toCheckoutSessionView(
      sessionRow({
        status: "PAYMENT_PENDING",
        paymentDeadlineAt: new Date("2026-08-21T12:30:00.000Z"),
      }) as any
    );
    expect(pending.paymentDeadlineAt).toBe("2026-08-21T12:30:00.000Z");
  });

  describe("the PAID ⇒ masterOrderId invariant", () => {
    it.each(CHECKOUT_SESSION_STATUSES.filter((s) => s !== "PAID"))(
      "%s carries a null masterOrderId",
      (status) => {
        const view = toCheckoutSessionView(sessionRow({ status }) as any);
        expect(view.status).toBe(status);
        expect(view.masterOrderId).toBeNull();
        expect(isPaidCheckoutSession(view)).toBe(false);
      }
    );

    it("PAID carries the exact order id from the relation", () => {
      const view = toCheckoutSessionView(
        sessionRow({ status: "PAID", order: { id: ORDER } }) as any
      );
      expect(view.status).toBe("PAID");
      expect(view.masterOrderId).toBe(ORDER);
      expect(isPaidCheckoutSession(view)).toBe(true);
    });

    it("PAID with no order fails internally instead of answering", () => {
      // The webhook writes the PAID status and the order on ONE
      // transaction client, so this pair cannot occur in practice.
      // If it ever does, the relational graph is broken: answering
      // `{status: "PAID", masterOrderId: null}` would hand the
      // contradiction to the UI, and answering with a guessed or
      // most-recent order id would attach a payment to the wrong order.
      expect(() =>
        toCheckoutSessionView(sessionRow({ status: "PAID", order: null }) as any)
      ).toThrow(CheckoutInvariantError);
    });

    it("a session with no quote fails rather than pricing itself at zero", () => {
      expect(() =>
        toCheckoutSessionView(sessionRow({ quoteSnapshot: null }) as any)
      ).toThrow(CheckoutInvariantError);
    });

    it("the invariant failure names no company, amount or trader detail", () => {
      let message = "";
      try {
        toCheckoutSessionView(sessionRow({ status: "PAID", order: null }) as any);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain(SESSION);
      expect(message).not.toContain(COMPANY);
      expect(message).not.toContain("995");
      expect(message).not.toContain("كرتون");
    });
  });

  it("projects allocations rather than forwarding their rows", () => {
    const view = toCheckoutSessionView(
      sessionRow({
        allocations: [
          allocationRow(),
          allocationRow({ companyLocationId: LOCATION, quantity: 4, shippingFeeAmount: new Prisma.Decimal("40") }),
        ],
      }) as any
    );
    expect(view.allocations).toHaveLength(2);
    expect(view.allocations[1]).toEqual({
      companyLocationId: LOCATION,
      locationName: "الفرع الرئيسي",
      cityNameAr: "الرياض",
      cityNameEn: "Riyadh",
      regionNameAr: "منطقة الرياض",
      regionNameEn: "Riyadh Region",
      address: "طريق الملك فهد",
      quantity: 4,
      shippingFeeAmount: "40.00",
    });
  });
});

describe("CHECKOUT_SESSION_VIEW_SELECT", () => {
  const selected = Object.keys(CHECKOUT_SESSION_VIEW_SELECT);

  it("selects the master order through the unique relation, not a search", () => {
    expect(CHECKOUT_SESSION_VIEW_SELECT.order).toEqual({ select: { id: true } });
  });

  it("never asks the database for a column the contract cannot carry", () => {
    // Not selecting is stronger than not mapping: a column that is
    // never read cannot be leaked by a later refactor that spreads.
    for (const column of [
      "traderCompanySnapshot",
      "traderCompanyId",
      "releaseReason",
      "capturedAt",
      "lockReleasedAt",
      "lockCreatedAt",
      "paymentAttempts",
    ]) {
      expect(selected).not.toContain(column);
    }
    const quoteColumns = Object.keys(CHECKOUT_SESSION_VIEW_SELECT.quoteSnapshot.select);
    for (const column of [
      "unitPriceExclTaxAmount",
      "unitTaxAmount",
      "taxRatePercent",
      "taxCalculationRuleCode",
      "taxCalculationRuleVersion",
      "shippingTariffPolicyVersionId",
      "shippingProviderCode",
      "productApprovalSnapshotId",
    ]) {
      expect(quoteColumns).not.toContain(column);
    }
    const allocationColumns = Object.keys(CHECKOUT_SESSION_VIEW_SELECT.allocations.select);
    for (const column of ["latitudeSnapshot", "longitudeSnapshot", "contactNameSnapshot", "contactPhoneSnapshot"]) {
      expect(allocationColumns).not.toContain(column);
    }
  });

  it("orders allocations deterministically, terminating in the primary key", () => {
    expect(CHECKOUT_SESSION_VIEW_SELECT.allocations.orderBy).toEqual([
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });
});

describe("CheckoutSessionService.getById", () => {
  function buildService(findFirst: jest.Mock) {
    const prisma: any = {
      checkoutSession: { findFirst, updateMany: jest.fn(async () => ({ count: 0 })) },
      $executeRaw: jest.fn(async () => 0),
      $queryRaw: jest.fn(async () => []),
      $transaction: jest.fn(async (fn: any) => (typeof fn === "function" ? fn(prisma) : [])),
    };
    const service = new CheckoutSessionService(prisma as any, {} as any, {} as any);
    return { service, prisma };
  }

  it("scopes to the caller's company inside the query", async () => {
    const findFirst = jest.fn(async (..._args: any[]) => sessionRow());
    const { service } = buildService(findFirst);

    await service.getById(SESSION, CTX);

    const args = findFirst.mock.calls[0][0] as any;
    expect(args.where).toEqual({ id: SESSION, traderCompanyId: COMPANY });
    // A row fetched first and checked afterwards is one early return
    // away from being returned to the wrong company.
    expect(args.select).toBe(CHECKOUT_SESSION_VIEW_SELECT);
    expect(args.include).toBeUndefined();
  });

  it("answers 404 for another company's session — the same as for a missing one", async () => {
    // The scoped WHERE means the row simply is not found. A 403 here
    // would confirm the id exists and belongs to someone.
    const findFirst = jest.fn(async (..._args: any[]) => null);
    const { service } = buildService(findFirst);

    await expect(service.getById(SESSION, { ...CTX, companyId: OTHER_COMPANY })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("returns the contract shape, never the row it read", async () => {
    const findFirst = jest.fn(async (..._args: any[]) => sessionRow({ status: "PAID", order: { id: ORDER } }));
    const { service } = buildService(findFirst);

    const view = await service.getById(SESSION, CTX);

    expect(Object.keys(view).sort()).toEqual([...CHECKOUT_SESSION_VIEW_KEYS].sort());
    expect(view.masterOrderId).toBe(ORDER);
  });
});

describe("checkout projection source", () => {
  const SOURCE = readFileSync(join(__dirname, "checkout-session.view.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const SERVICE = readFileSync(join(__dirname, "checkout-session.service.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never spreads a database row into the response", () => {
    expect(SOURCE).not.toMatch(/\.\.\.row\b/);
    expect(SOURCE).not.toMatch(/\.\.\.quote\b/);
    expect(SOURCE).not.toMatch(/\.\.\.session\b/);
  });

  it("has no fallback that would paper over a broken invariant", () => {
    expect(SOURCE).not.toMatch(/masterOrderId:\s*row\.order\?\./);
    expect(SOURCE).not.toMatch(/order\.\.\.id\s*\?\?/);
    expect(SOURCE).not.toMatch(/findFirst|findMany|orderBy:\s*\{\s*createdAt:\s*"desc"/);
  });

  it("passes money through Decimal.toFixed, never Number()", () => {
    expect(SOURCE).toMatch(/toFixed\(2\)/);
    expect(SOURCE).not.toMatch(/Number\(/);
    expect(SOURCE).not.toMatch(/parseFloat\(/);
  });

  it("leaves getById with no include: and no raw row return", () => {
    const getById = SERVICE.slice(SERVICE.indexOf("async getById("));
    const body = getById.slice(0, getById.indexOf("\n  async ", 1));
    expect(body).toContain("CHECKOUT_SESSION_VIEW_SELECT");
    expect(body).toContain("toCheckoutSessionView");
    expect(body).not.toContain("include:");
    expect(body).not.toMatch(/return session;/);
  });
});
