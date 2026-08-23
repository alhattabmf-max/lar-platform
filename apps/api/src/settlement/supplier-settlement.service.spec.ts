/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { SETTLEMENT_DETAIL_KEYS, SETTLEMENT_SUMMARY_KEYS } from "@platform/types";
import { SupplierSettlementService } from "./supplier-settlement.service";

/**
 * What a supplier may read of being paid.
 *
 * `supplier_payouts` records a bank transfer an ADMINISTRATOR executed. Three
 * of its columns describe the platform's operation rather than the supplier's
 * money, and the test that matters most here is not that they are unmapped but
 * that they are never SELECTED — a later refactor that spreads a row cannot
 * leak a column the query never asked for.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY = "99999999-9999-4999-8999-999999999999";
const PAYOUT = "44444444-4444-4444-8444-444444444444";
const SCOPE = { companyId: COMPANY };

/** The columns whose presence would be the leak. */
const FORBIDDEN = [
  "externalTransferReference",
  "executedByAdminUserId",
  "supplierBankAccountId",
  "iban",
  "accountNumber",
  "ledger",
  "journalEntry",
  "allocationShareBasisPoints",
  "roundingRemainder",
];

function payoutRow(overrides: Record<string, any> = {}) {
  return {
    id: PAYOUT,
    orderAllocationId: "33333333-3333-4333-8333-333333333333",
    outcome: "EXECUTED",
    netAmount: new Prisma.Decimal("1200.4"),
    executedAt: new Date("2026-08-10T00:00:00.000Z"),
    orderAllocation: {
      masterOrderId: "22222222-2222-4222-8222-222222222222",
      masterOrder: { paymentAttempt: { currency: "SAR" } },
      financialSnapshot: {
        productAmountExclTax: new Prisma.Decimal("1000"),
        productTaxAmount: new Prisma.Decimal("150"),
        productAmountInclTax: new Prisma.Decimal("1150"),
        shippingFeeAmount: new Prisma.Decimal("50"),
        commissionShareAmount: new Prisma.Decimal("100"),
        commissionShareTaxAmount: new Prisma.Decimal("15"),
        supplierPayableShareAmount: new Prisma.Decimal("1200.4"),
      },
      checkoutLocationAllocation: {
        locationNameSnapshot: "الفرع الرئيسي",
        cityNameArSnapshot: "الرياض",
        cityNameEnSnapshot: "Riyadh",
      },
    },
    ...overrides,
  };
}

function build(row: unknown) {
  const findMany = jest.fn(async (..._args: any[]) => (row ? [row] : []));
  const findFirst = jest.fn(async (..._args: any[]) => row);
  const service = new SupplierSettlementService({
    supplierPayout: { findMany, findFirst, count: jest.fn(async () => (row ? 1 : 0)) },
  } as any);
  return { service, findMany, findFirst };
}

describe("the settlement carries exactly its contract", () => {
  it("returns the declared summary keys — no more, no less", async () => {
    const { service } = build(payoutRow());

    const page = await service.list(SCOPE, {});

    expect(Object.keys(page.items[0]).sort()).toEqual([...SETTLEMENT_SUMMARY_KEYS].sort());
  });

  it("returns the declared detail keys", async () => {
    const { service } = build(payoutRow());

    expect(Object.keys(await service.get(SCOPE, PAYOUT)).sort()).toEqual(
      [...SETTLEMENT_DETAIL_KEYS].sort()
    );
  });

  it.each(FORBIDDEN)("never serialises %s", async (field) => {
    const { service } = build(payoutRow());

    expect(JSON.stringify(await service.get(SCOPE, PAYOUT))).not.toContain(field);
  });

  it("never SELECTS the banking columns in the first place", async () => {
    // Not mapping them would be enough today. Not selecting them stays true
    // after a refactor that spreads the row.
    const { service, findMany, findFirst } = build(payoutRow());

    await service.list(SCOPE, {});
    await service.get(SCOPE, PAYOUT);

    const selects = [
      JSON.stringify((findMany.mock.calls[0][0] as any).select),
      JSON.stringify((findFirst.mock.calls[0][0] as any).select),
    ];
    for (const select of selects) {
      for (const field of FORBIDDEN) {
        expect(select).not.toContain(field);
      }
    }
  });
});

describe("money is a fixed-scale decimal string everywhere", () => {
  it("renders every amount at scale two", async () => {
    const { service } = build(payoutRow());
    const detail = await service.get(SCOPE, PAYOUT);

    // 1200.4 must serialise as "1200.40", never as a JSON number.
    expect(detail.netAmount).toBe("1200.40");
    expect(detail.productAmountExclTax).toBe("1000.00");
    expect(detail.commissionShareTaxAmount).toBe("15.00");

    for (const value of [
      detail.netAmount,
      detail.productAmountExclTax,
      detail.productTaxAmount,
      detail.productAmountInclTax,
      detail.shippingFeeAmount,
      detail.commissionShareAmount,
      detail.commissionShareTaxAmount,
      detail.supplierPayableShareAmount,
    ]) {
      expect(typeof value).toBe("string");
      expect(value).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("reports an absent basis as zero rather than crashing", async () => {
    const { service } = build(
      payoutRow({
        orderAllocation: { ...payoutRow().orderAllocation, financialSnapshot: null },
      })
    );

    expect((await service.get(SCOPE, PAYOUT)).productAmountExclTax).toBe("0.00");
  });
});

describe("ZERO_BALANCE is an outcome, not a failure", () => {
  it("passes it through unchanged", async () => {
    // Nothing was owed for that allocation. A consumer that renders it as an
    // error tells the supplier a payment failed when none was due.
    const { service } = build(
      payoutRow({ outcome: "ZERO_BALANCE", netAmount: new Prisma.Decimal("0") })
    );

    const summary = (await service.list(SCOPE, {})).items[0];

    expect(summary.outcome).toBe("ZERO_BALANCE");
    expect(summary.netAmount).toBe("0.00");
  });
});

describe("ownership lives in the query", () => {
  it("scopes the list through the allocation to the caller's company", async () => {
    const { service, findMany } = build(payoutRow());

    await service.list(SCOPE, {});

    expect((findMany.mock.calls[0][0] as any).where).toEqual({
      orderAllocation: { masterOrder: { supplierCompanyId: COMPANY } },
    });
  });

  it("scopes the detail to the id AND the company together", async () => {
    const { service, findFirst } = build(payoutRow());

    await service.get(SCOPE, PAYOUT);

    expect((findFirst.mock.calls[0][0] as any).where).toEqual({
      id: PAYOUT,
      orderAllocation: { masterOrder: { supplierCompanyId: COMPANY } },
    });
  });

  it("answers another supplier's settlement with 404, the same as an unknown one", async () => {
    const { service } = build(null);

    await expect(service.get({ companyId: OTHER_COMPANY }, PAYOUT)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("orders the list deterministically, terminating in the id", async () => {
    const { service, findMany } = build(payoutRow());

    await service.list(SCOPE, {});

    expect((findMany.mock.calls[0][0] as any).orderBy).toEqual([
      { executedAt: "desc" },
      { id: "asc" },
    ]);
  });
});
