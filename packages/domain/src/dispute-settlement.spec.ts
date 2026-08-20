import {
  distributeRoundedAmount,
  computeOrderAllocationFinancialSnapshots,
  computeDisputeRefundReversal,
  computeSupplierPayoutNet,
  isValidDisputeTransition,
  isValidReplacementObligationTransition,
  isSecondDisputeDecisionAllowed,
  isOrderAllocationSettlementEligible,
  roundMoney,
} from "./dispute-settlement";

describe("distributeRoundedAmount", () => {
  it("distributes evenly when it divides cleanly", () => {
    const branches = [
      { checkoutLocationAllocationId: "a", createdAt: new Date("2026-01-01"), quantity: 2 },
      { checkoutLocationAllocationId: "b", createdAt: new Date("2026-01-02"), quantity: 2 },
    ];
    const result = distributeRoundedAmount(100, 4, branches);
    expect(result.get("a")!.amount).toBe(50);
    expect(result.get("b")!.amount).toBe(50);
    expect(result.get("a")!.remainder).toBe(0);
  });

  it("assigns the entire leftover fraction to the LAST branch by createdAt", () => {
    // 100 / 3 branches of qty 1 each = 33.33333... -> 33.33 each, remainder 0.01
    const branches = [
      { checkoutLocationAllocationId: "a", createdAt: new Date("2026-01-01T00:00:00Z"), quantity: 1 },
      { checkoutLocationAllocationId: "b", createdAt: new Date("2026-01-01T00:00:01Z"), quantity: 1 },
      { checkoutLocationAllocationId: "c", createdAt: new Date("2026-01-01T00:00:02Z"), quantity: 1 },
    ];
    const result = distributeRoundedAmount(100, 3, branches);
    expect(result.get("a")!.amount).toBe(33.33);
    expect(result.get("b")!.amount).toBe(33.33);
    expect(result.get("c")!.amount).toBe(33.34); // gets the 0.01 leftover
    expect(result.get("c")!.remainder).toBe(0.01);
    const sum = roundMoney(result.get("a")!.amount + result.get("b")!.amount + result.get("c")!.amount);
    expect(sum).toBe(100);
  });

  it("uses id as the deterministic tiebreak when createdAt is identical", () => {
    const sameTime = new Date("2026-01-01T00:00:00Z");
    const branches = [
      { checkoutLocationAllocationId: "zzz-higher-id", createdAt: sameTime, quantity: 1 },
      { checkoutLocationAllocationId: "aaa-lower-id", createdAt: sameTime, quantity: 1 },
    ];
    const result = distributeRoundedAmount(10, 3, branches);
    // total floor: 10/3=3.333 -> floor 3.33 each -> sum 6.66, leftover 3.34
    // last branch by (createdAt ASC, id ASC) is "zzz-higher-id" (since ids tie-break ascending, "zzz" > "aaa")
    expect(result.get("zzz-higher-id")!.remainder).toBe(3.34);
    expect(result.get("aaa-lower-id")!.remainder).toBe(0);
  });

  it("sums exactly to the total across many branches with awkward fractions", () => {
    const branches = [
      { checkoutLocationAllocationId: "a", createdAt: new Date("2026-01-01"), quantity: 7 },
      { checkoutLocationAllocationId: "b", createdAt: new Date("2026-01-02"), quantity: 11 },
      { checkoutLocationAllocationId: "c", createdAt: new Date("2026-01-03"), quantity: 3 },
    ];
    const result = distributeRoundedAmount(999.97, 21, branches);
    const sum = roundMoney([...result.values()].reduce((acc, v) => acc + v.amount, 0));
    expect(sum).toBe(999.97);
  });

  it("handles a zero remainder correctly (no branch gets a spurious adjustment)", () => {
    const branches = [{ checkoutLocationAllocationId: "a", createdAt: new Date("2026-01-01"), quantity: 1 }];
    const result = distributeRoundedAmount(50, 1, branches);
    expect(result.get("a")!.amount).toBe(50);
    expect(result.get("a")!.remainder).toBe(0);
  });
});

describe("computeOrderAllocationFinancialSnapshots", () => {
  it("computes exact per-branch product amounts, proportional commission/tax with independent remainders, and DERIVES supplierPayableShareAmount so the row equation holds exactly", () => {
    const branches = [
      { checkoutLocationAllocationId: "a", createdAt: new Date("2026-01-01"), quantity: 1, unitPriceExclTaxAmount: 100, unitTaxAmount: 15, shippingFeeAmount: 10 },
      { checkoutLocationAllocationId: "b", createdAt: new Date("2026-01-02"), quantity: 2, unitPriceExclTaxAmount: 100, unitTaxAmount: 15, shippingFeeAmount: 20 },
    ];
    const result = computeOrderAllocationFinancialSnapshots({
      masterOrderTotalQuantity: 3,
      branches,
      masterOrderCommissionAmount: 34.8,
      masterOrderCommissionTaxAmount: 5.22,
    });

    const a = result.find((r) => r.checkoutLocationAllocationId === "a")!;
    const b = result.find((r) => r.checkoutLocationAllocationId === "b")!;

    expect(a.productAmountExclTax).toBe(100);
    expect(a.productTaxAmount).toBe(15);
    expect(a.productAmountInclTax).toBe(115);
    expect(b.productAmountExclTax).toBe(200);
    expect(b.productAmountInclTax).toBe(230);

    // allocationShareBasisPoints is DISPLAY_ONLY
    expect(a.allocationShareBasisPoints).toBe(Math.round((1 / 3) * 10000));

    const commissionSum = roundMoney(a.commissionShareAmount + b.commissionShareAmount);
    expect(commissionSum).toBe(34.8);
    const commissionTaxSum = roundMoney(a.commissionShareTaxAmount + b.commissionShareTaxAmount);
    expect(commissionTaxSum).toBe(5.22);

    // Row equation holds EXACTLY for every branch, by construction.
    expect(roundMoney(a.supplierPayableShareAmount + a.commissionShareAmount + a.commissionShareTaxAmount)).toBe(a.productAmountInclTax);
    expect(roundMoney(b.supplierPayableShareAmount + b.commissionShareAmount + b.commissionShareTaxAmount)).toBe(b.productAmountInclTax);

    // Shipping never enters the supplier-payable-share calculation.
    expect(a.shippingFeeAmount).toBe(10);
    expect(b.shippingFeeAmount).toBe(20);
  });
});

describe("computeDisputeRefundReversal", () => {
  it("computes commission/tax reversal from the PRODUCT ratio only, never touching shipping", () => {
    const result = computeDisputeRefundReversal({
      productRefundAmountInclTax: 57.5, // half of 115
      shippingRefundAmount: 10, // full shipping, irrelevant to the ratio
      snapshotProductAmountInclTax: 115,
      snapshotCommissionShareAmount: 11.6,
      snapshotCommissionShareTaxAmount: 1.74,
      snapshotSupplierPayableShareAmount: 100,
    });
    expect(result.totalRefundAmount).toBe(67.5);
    const expectedCommissionReversal = roundMoney(11.6 * 0.5);
    const expectedCommissionTaxReversal = roundMoney(1.74 * 0.5);
    expect(result.commissionReversalAmount).toBe(expectedCommissionReversal);
    expect(result.commissionTaxReversalAmount).toBe(expectedCommissionTaxReversal);
    // supplierPayableDebitAmount is DERIVED so the entry balances by
    // construction: productRefund - commissionReversal - commissionTaxReversal.
    expect(result.supplierPayableDebitAmount).toBe(roundMoney(57.5 - expectedCommissionReversal - expectedCommissionTaxReversal));
    // Balance check: the debits (supplierPayable + commission + commissionTax + shipping) must equal the credit (total).
    const debitSum = roundMoney(result.supplierPayableDebitAmount + result.commissionReversalAmount + result.commissionTaxReversalAmount + 10);
    expect(debitSum).toBe(result.totalRefundAmount);
  });

  it("a full product refund reverses the full commission/tax share, and the journal entry still balances", () => {
    const result = computeDisputeRefundReversal({
      productRefundAmountInclTax: 115,
      shippingRefundAmount: 0,
      snapshotProductAmountInclTax: 115,
      snapshotCommissionShareAmount: 11.6,
      snapshotCommissionShareTaxAmount: 1.74,
      snapshotSupplierPayableShareAmount: 100,
    });
    expect(result.commissionReversalAmount).toBe(11.6);
    expect(result.commissionTaxReversalAmount).toBe(1.74);
    expect(result.supplierPayableDebitAmount).toBe(roundMoney(115 - 11.6 - 1.74));
    const debitSum = roundMoney(result.supplierPayableDebitAmount + result.commissionReversalAmount + result.commissionTaxReversalAmount);
    expect(debitSum).toBe(result.totalRefundAmount);
  });
});

describe("computeSupplierPayoutNet", () => {
  it("no refund at all: net = productShare + shippingFee", () => {
    const result = computeSupplierPayoutNet({
      snapshotSupplierPayableShareAmount: 90,
      snapshotShippingFeeAmount: 10,
      sumProductRelatedSupplierPayableDebits: 0,
      sumShippingRefundDebits: 0,
    });
    expect(result.productNet).toBe(90);
    expect(result.shippingNet).toBe(10);
    expect(result.netAmount).toBe(100);
  });

  it("product-only refund does NOT reduce the shipping net", () => {
    const result = computeSupplierPayoutNet({
      snapshotSupplierPayableShareAmount: 90,
      snapshotShippingFeeAmount: 10,
      sumProductRelatedSupplierPayableDebits: 30,
      sumShippingRefundDebits: 0,
    });
    expect(result.productNet).toBe(60);
    expect(result.shippingNet).toBe(10);
    expect(result.netAmount).toBe(70);
  });

  it("shipping-only refund does NOT reduce the product/commission net", () => {
    const result = computeSupplierPayoutNet({
      snapshotSupplierPayableShareAmount: 90,
      snapshotShippingFeeAmount: 10,
      sumProductRelatedSupplierPayableDebits: 0,
      sumShippingRefundDebits: 10,
    });
    expect(result.productNet).toBe(90);
    expect(result.shippingNet).toBe(0);
    expect(result.netAmount).toBe(90);
  });

  it("full refund of both product and shipping makes the allocation net exactly zero", () => {
    const result = computeSupplierPayoutNet({
      snapshotSupplierPayableShareAmount: 90,
      snapshotShippingFeeAmount: 10,
      sumProductRelatedSupplierPayableDebits: 90,
      sumShippingRefundDebits: 10,
    });
    expect(result.productNet).toBe(0);
    expect(result.shippingNet).toBe(0);
    expect(result.netAmount).toBe(0);
  });
});

describe("dispute state machine", () => {
  it("allows the documented transitions", () => {
    expect(isValidDisputeTransition("OPEN", "SUPPLIER_RESPONDED")).toBe(true);
    expect(isValidDisputeTransition("OPEN", "AWAITING_REPLACEMENT")).toBe(true);
    expect(isValidDisputeTransition("SUPPLIER_RESPONDED", "RESOLVED_PARTIAL")).toBe(true);
    expect(isValidDisputeTransition("AWAITING_REPLACEMENT", "RESOLVED_REPLACED")).toBe(true);
    expect(isValidDisputeTransition("AWAITING_REPLACEMENT", "RESOLVED_ACCEPTED")).toBe(true);
  });
  it("rejects transitions out of any RESOLVED_* terminal state", () => {
    expect(isValidDisputeTransition("RESOLVED_ACCEPTED", "OPEN")).toBe(false);
    expect(isValidDisputeTransition("RESOLVED_REJECTED", "SUPPLIER_RESPONDED")).toBe(false);
  });
  it("rejects OPEN -> RESOLVED_REPLACED directly (must go through AWAITING_REPLACEMENT)", () => {
    expect(isValidDisputeTransition("OPEN", "RESOLVED_REPLACED")).toBe(false);
  });
});

describe("replacement obligation state machine", () => {
  it("allows the four forward transitions and FAILED from any non-terminal state", () => {
    expect(isValidReplacementObligationTransition("AWAITING_PREPARATION", "PREPARING")).toBe(true);
    expect(isValidReplacementObligationTransition("PREPARING", "READY_TO_SHIP")).toBe(true);
    expect(isValidReplacementObligationTransition("READY_TO_SHIP", "SHIPPED")).toBe(true);
    expect(isValidReplacementObligationTransition("SHIPPED", "DELIVERED")).toBe(true);
    expect(isValidReplacementObligationTransition("AWAITING_PREPARATION", "FAILED")).toBe(true);
    expect(isValidReplacementObligationTransition("SHIPPED", "FAILED")).toBe(true);
  });
  it("rejects transitions out of DELIVERED or FAILED", () => {
    expect(isValidReplacementObligationTransition("DELIVERED", "FAILED")).toBe(false);
    expect(isValidReplacementObligationTransition("FAILED", "PREPARING")).toBe(false);
  });
});

describe("isSecondDisputeDecisionAllowed", () => {
  it("allows a refund decision after a FAILED replacement", () => {
    expect(
      isSecondDisputeDecisionAllowed({ firstDecisionType: "REPLACEMENT", replacementObligationStatus: "FAILED", secondDecisionType: "FULL_REFUND" })
    ).toBe(true);
    expect(
      isSecondDisputeDecisionAllowed({ firstDecisionType: "REPLACEMENT", replacementObligationStatus: "FAILED", secondDecisionType: "PARTIAL_REFUND" })
    ).toBe(true);
  });
  it("rejects a second REPLACEMENT decision", () => {
    expect(
      isSecondDisputeDecisionAllowed({ firstDecisionType: "REPLACEMENT", replacementObligationStatus: "FAILED", secondDecisionType: "REPLACEMENT" })
    ).toBe(false);
  });
  it("rejects a second decision when the replacement has not failed yet", () => {
    expect(
      isSecondDisputeDecisionAllowed({ firstDecisionType: "REPLACEMENT", replacementObligationStatus: "SHIPPED", secondDecisionType: "FULL_REFUND" })
    ).toBe(false);
  });
  it("rejects a second decision when the first decision was not REPLACEMENT", () => {
    expect(
      isSecondDisputeDecisionAllowed({ firstDecisionType: "FULL_REFUND", replacementObligationStatus: null, secondDecisionType: "FULL_REFUND" })
    ).toBe(false);
  });
});

describe("isOrderAllocationSettlementEligible", () => {
  const base = {
    status: "DELIVERED",
    disputeWindowClosesAt: new Date("2026-01-01"),
    payoutSettledAt: null,
    hasOpenDispute: false,
    hasBlockingRefundObligation: false,
    supplierCompanyPayoutHoldUntil: null,
    now: new Date("2026-01-10"),
  };
  it("is eligible when all four conditions hold", () => {
    expect(isOrderAllocationSettlementEligible(base)).toBe(true);
  });
  it("is not eligible before DELIVERED", () => {
    expect(isOrderAllocationSettlementEligible({ ...base, status: "SHIPPED" })).toBe(false);
  });
  it("is not eligible before the dispute window closes", () => {
    expect(isOrderAllocationSettlementEligible({ ...base, disputeWindowClosesAt: new Date("2026-02-01") })).toBe(false);
  });
  it("is not eligible with an open dispute", () => {
    expect(isOrderAllocationSettlementEligible({ ...base, hasOpenDispute: true })).toBe(false);
  });
  it("is not eligible with a FAILED refund obligation still blocking (not just PENDING/SENT)", () => {
    expect(isOrderAllocationSettlementEligible({ ...base, hasBlockingRefundObligation: true })).toBe(false);
  });
  it("is not eligible while already settled", () => {
    expect(isOrderAllocationSettlementEligible({ ...base, payoutSettledAt: new Date("2026-01-05") })).toBe(false);
  });
  it("is not eligible while Company.payoutHoldUntil (Phase 5) is in the future", () => {
    expect(isOrderAllocationSettlementEligible({ ...base, supplierCompanyPayoutHoldUntil: new Date("2026-02-01") })).toBe(false);
  });
  it("is eligible when Company.payoutHoldUntil has already passed", () => {
    expect(isOrderAllocationSettlementEligible({ ...base, supplierCompanyPayoutHoldUntil: new Date("2025-12-01") })).toBe(true);
  });
});
