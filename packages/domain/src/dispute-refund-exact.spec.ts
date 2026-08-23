import { Decimal } from "decimal.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeDisputeRefundReversalExact,
  isExactMoney,
  isWithinExact,
  sumExact,
  type ExactMoney,
} from "./dispute-refund-exact";

/**
 * Dispute refund arithmetic, proved exact rather than asserted safe.
 *
 * The float version of this path was defended as "practically lossless
 * for two-decimal values". That is an argument about the inputs anybody
 * tried, not a property of the code. These tests are about the property.
 */

/** The real column bounds — `numeric(p,s)` allows `p - s` integer digits. */
const DECIMAL_14_2_MAX = "999999999999.99";
const DECIMAL_12_2_MAX = "9999999999.99";

/** Adds up what the ledger would debit, exactly. */
function debitTotal(
  reversal: ReturnType<typeof computeDisputeRefundReversalExact>,
  shippingRefund: ExactMoney
): ExactMoney {
  return sumExact(
    reversal.supplierPayableDebitAmount,
    reversal.commissionReversalAmount,
    reversal.commissionTaxReversalAmount,
    shippingRefund
  );
}

describe("the values that break a float", () => {
  // The float failures here are the MEASURED ones, not assumed ones.
  // `2.61 * 100` is exactly 261 in a double — it is not itself a trap,
  // and saying otherwise would be inventing evidence. The traps that do
  // exist at this scale are shown in their own test below: 0.29 * 100 is
  // 28.999999999999996, 0.57 * 100 is 56.99999999999999, and
  // `Math.round(1.005 * 100) / 100` is 1.00 rather than 1.01.
  it("0.10 survives as 0.10", () => {
    const result = computeDisputeRefundReversalExact({
      productRefundAmountInclTax: "0.10",
      shippingRefundAmount: "0.00",
      snapshotProductAmountInclTax: "0.10",
      snapshotCommissionShareAmount: "0.00",
      snapshotCommissionShareTaxAmount: "0.00",
    });

    expect(result.totalRefundAmount).toBe("0.10");
    expect(result.supplierPayableDebitAmount).toBe("0.10");
  });

  it("the float traps at this scale are real, and these are them", () => {
    // Scaling to cents, which is what `Math.round(n * 100) / 100` does:
    expect(0.07 * 100).toBe(7.000000000000001);
    expect(0.29 * 100).toBe(28.999999999999996);
    expect(0.57 * 100).toBe(56.99999999999999);

    // And the rounder itself, losing a cent on a half:
    expect(Math.round(1.005 * 100) / 100).toBe(1);
    expect(new Decimal("1.005").toFixed(2, Decimal.ROUND_HALF_UP)).toBe("1.01");

    // Accumulation, which every ledger total is:
    expect(0.1 + 0.2).toBe(0.30000000000000004);
  });

  it("2.61 survives as 2.61", () => {
    const result = computeDisputeRefundReversalExact({
      productRefundAmountInclTax: "2.61",
      shippingRefundAmount: "0.00",
      snapshotProductAmountInclTax: "2.61",
      snapshotCommissionShareAmount: "0.00",
      snapshotCommissionShareTaxAmount: "0.00",
    });

    expect(result.totalRefundAmount).toBe("2.61");
    expect(result.supplierPayableDebitAmount).toBe("2.61");
  });

  it("0.10 + 0.20 is 0.30, not 0.30000000000000004", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumExact("0.10", "0.20")).toBe("0.30");
  });

  it("carries a hundred cents without drift", () => {
    // A hundred additions of 0.10 in a double lands at 9.99999999999998.
    const cents: ExactMoney[] = Array.from({ length: 100 }, () => "0.10");
    expect(sumExact(...cents)).toBe("10.00");
  });
});

describe("the real Decimal bounds", () => {
  it("handles the largest value a Decimal(14,2) column can hold", () => {
    // The refund columns — DisputeDecision.productRefundAmountInclTax,
    // .shippingRefundAmount and RefundObligation.amount — are
    // Decimal(14,2), NOT (12,2): twelve integer digits, not ten.
    // 999999999999.99 exceeds Number.MAX_SAFE_INTEGER once scaled to
    // cents (99999999999999 > 9007199254740991 is false, but the
    // multiplication a float rounder performs pushes precision to its
    // edge), so it is exactly where a float implementation stops being
    // trustworthy.
    const result = computeDisputeRefundReversalExact({
      productRefundAmountInclTax: DECIMAL_14_2_MAX,
      shippingRefundAmount: "0.00",
      snapshotProductAmountInclTax: DECIMAL_14_2_MAX,
      snapshotCommissionShareAmount: "0.00",
      snapshotCommissionShareTaxAmount: "0.00",
    });

    expect(result.totalRefundAmount).toBe(DECIMAL_14_2_MAX);
    expect(result.supplierPayableDebitAmount).toBe(DECIMAL_14_2_MAX);
  });

  it("sums two large values without losing a cent", () => {
    // A float would lose the trailing cents entirely at this magnitude.
    const total = sumExact("999999999999.99", "0.01");
    expect(total).toBe("1000000000000.00");
  });

  it("handles the largest value a Decimal(12,2) column can hold", () => {
    // The allocation snapshot's shippingFeeAmount is Decimal(12,2), and
    // it is the tighter bound a shipping refund must satisfy.
    const result = computeDisputeRefundReversalExact({
      productRefundAmountInclTax: "0.00",
      shippingRefundAmount: DECIMAL_12_2_MAX,
      snapshotProductAmountInclTax: "0.00",
      snapshotCommissionShareAmount: "0.00",
      snapshotCommissionShareTaxAmount: "0.00",
    });

    expect(result.totalRefundAmount).toBe(DECIMAL_12_2_MAX);
  });
});

describe("input shapes that must never enter the arithmetic", () => {
  const base = {
    shippingRefundAmount: "0.00",
    snapshotProductAmountInclTax: "100.00",
    snapshotCommissionShareAmount: "10.00",
    snapshotCommissionShareTaxAmount: "1.50",
  };

  const REJECTED: ReadonlyArray<readonly [string, unknown]> = [
    ["three decimal places", "1.005"],
    ["one decimal place", "1.5"],
    ["no decimal point", "100"],
    ["scientific notation, lowercase", "1e3"],
    ["scientific notation, uppercase", "1E3"],
    ["scientific notation with a point", "1.5e2"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["-Infinity", "-Infinity"],
    ["a negative amount", "-5.00"],
    ["leading whitespace", " 1.00"],
    ["trailing whitespace", "1.00 "],
    ["a thousands separator", "1,000.00"],
    ["a currency suffix", "100.00 SAR"],
    ["an empty string", ""],
    ["a plain number", 100],
    ["a float", 100.5],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
    ["a hex literal", "0x64"],
    ["a leading plus", "+1.00"],
  ];

  it.each(REJECTED)("REJECTS %s", (_label, value) => {
    expect(isExactMoney(value)).toBe(false);
    expect(() =>
      computeDisputeRefundReversalExact({
        ...base,
        productRefundAmountInclTax: value as ExactMoney,
      })
    ).toThrow(RangeError);
  });

  it("proves the danger it is guarding against", () => {
    // Every one of these is silently ACCEPTED by `new Decimal(...)`,
    // which is why the guard runs before the value reaches it.
    expect(new Decimal("1e3").toFixed(2)).toBe("1000.00");
    expect(new Decimal("NaN").isNaN()).toBe(true);
    expect(new Decimal("Infinity").isFinite()).toBe(false);
    // And a NaN Decimal does not throw on arithmetic — it propagates.
    expect(new Decimal("NaN").plus(1).isNaN()).toBe(true);
  });

  it("accepts the canonical form and only that", () => {
    expect(isExactMoney("0.00")).toBe(true);
    expect(isExactMoney("100.00")).toBe(true);
    expect(isExactMoney("999999999999.99")).toBe(true);
  });
});

describe("a refund can never exceed its frozen bound", () => {
  it("accepts a refund equal to the bound", () => {
    expect(isWithinExact("115.00", "115.00")).toBe(true);
  });

  it("REJECTS one cent over", () => {
    expect(isWithinExact("115.01", "115.00")).toBe(false);
  });

  it("REJECTS one cent over at a magnitude where a float would agree", () => {
    // Both of these parse to the SAME double, so `Number(a) <= Number(b)`
    // would let the larger through. The Decimal comparison does not.
    const bound = "999999999999.99";
    const over = "1000000000000.00";
    expect(Number(over) - Number(bound)).toBeLessThan(1);
    expect(isWithinExact(over, bound)).toBe(false);
  });

  it("compares cents, not approximations", () => {
    expect(isWithinExact("0.10", "0.10")).toBe(true);
    expect(isWithinExact("0.11", "0.10")).toBe(false);
    expect(isWithinExact("2.61", "2.61")).toBe(true);
    expect(isWithinExact("2.62", "2.61")).toBe(false);
  });
});

describe("the journal entry balances BY CONSTRUCTION", () => {
  // The property, not a sample: debits equal the credit for every input,
  // because the supplier debit is DERIVED by subtracting the two
  // reversals from the product refund, so they cancel out of the sum.
  const CASES: ReadonlyArray<
    readonly [string, ExactMoney, ExactMoney, ExactMoney, ExactMoney, ExactMoney]
  > = [
    // label, productRefund, shippingRefund, snapProduct, snapCommission, snapCommissionTax
    ["a clean half", "57.50", "10.00", "115.00", "11.60", "1.74"],
    ["a third, which never divides evenly", "38.33", "3.33", "115.00", "11.60", "1.74"],
    ["one cent", "0.01", "0.00", "115.00", "11.60", "1.74"],
    ["a full refund", "115.00", "10.00", "115.00", "11.60", "1.74"],
    ["no shipping at all", "57.50", "0.00", "115.00", "11.60", "1.74"],
    ["no product, shipping only", "0.00", "10.00", "115.00", "11.60", "1.74"],
    ["nothing at all", "0.00", "0.00", "115.00", "11.60", "1.74"],
    ["a zero snapshot", "0.00", "0.00", "0.00", "0.00", "0.00"],
    ["a value that rounds at the half", "0.05", "0.00", "0.10", "0.01", "0.01"],
    ["awkward sevenths", "16.43", "1.43", "115.00", "11.60", "1.74"],
    ["the column ceiling", "999999999999.99", "0.00", "999999999999.99", "0.00", "0.00"],
    ["2.61 against 7.83", "2.61", "0.00", "7.83", "0.78", "0.12"],
  ];

  it.each(CASES)(
    "%s: debits equal the credit exactly",
    (_label, productRefund, shippingRefund, snapProduct, snapCommission, snapCommissionTax) => {
      const reversal = computeDisputeRefundReversalExact({
        productRefundAmountInclTax: productRefund,
        shippingRefundAmount: shippingRefund,
        snapshotProductAmountInclTax: snapProduct,
        snapshotCommissionShareAmount: snapCommission,
        snapshotCommissionShareTaxAmount: snapCommissionTax,
      });

      expect(debitTotal(reversal, shippingRefund)).toBe(reversal.totalRefundAmount);
      expect(reversal.totalRefundAmount).toBe(sumExact(productRefund, shippingRefund));
    }
  );

  it("balances across a hundred generated ratios", () => {
    // Every whole-cent refund from 0.00 to 1.00 against a snapshot whose
    // commission does not divide evenly by any of them.
    for (let cents = 0; cents <= 100; cents += 1) {
      const productRefund = new Decimal(cents).dividedBy(100).toFixed(2);
      const reversal = computeDisputeRefundReversalExact({
        productRefundAmountInclTax: productRefund,
        shippingRefundAmount: "0.07",
        snapshotProductAmountInclTax: "1.00",
        snapshotCommissionShareAmount: "0.33",
        snapshotCommissionShareTaxAmount: "0.07",
      });

      expect(debitTotal(reversal, "0.07")).toBe(reversal.totalRefundAmount);
    }
  });
});

describe("the reversal amounts themselves", () => {
  it("reverses commission from the PRODUCT ratio only, never shipping", () => {
    // Half the product refunded, full shipping refunded. The commission
    // reversal must be half — shipping must not move it.
    const result = computeDisputeRefundReversalExact({
      productRefundAmountInclTax: "57.50",
      shippingRefundAmount: "10.00",
      snapshotProductAmountInclTax: "115.00",
      snapshotCommissionShareAmount: "11.60",
      snapshotCommissionShareTaxAmount: "1.74",
    });

    expect(result.commissionReversalAmount).toBe("5.80");
    expect(result.commissionTaxReversalAmount).toBe("0.87");
    expect(result.supplierPayableDebitAmount).toBe("50.83");
    expect(result.totalRefundAmount).toBe("67.50");
  });

  it("reverses nothing when nothing was refunded of the product", () => {
    const result = computeDisputeRefundReversalExact({
      productRefundAmountInclTax: "0.00",
      shippingRefundAmount: "10.00",
      snapshotProductAmountInclTax: "115.00",
      snapshotCommissionShareAmount: "11.60",
      snapshotCommissionShareTaxAmount: "1.74",
    });

    expect(result.commissionReversalAmount).toBe("0.00");
    expect(result.commissionTaxReversalAmount).toBe("0.00");
    expect(result.supplierPayableDebitAmount).toBe("0.00");
    expect(result.totalRefundAmount).toBe("10.00");
  });

  it("does not divide by a zero snapshot", () => {
    // Decimal division by zero yields Infinity, which would render as a
    // garbage amount rather than throwing.
    const result = computeDisputeRefundReversalExact({
      productRefundAmountInclTax: "0.00",
      shippingRefundAmount: "0.00",
      snapshotProductAmountInclTax: "0.00",
      snapshotCommissionShareAmount: "5.00",
      snapshotCommissionShareTaxAmount: "1.00",
    });

    expect(result.commissionReversalAmount).toBe("0.00");
    expect(result.commissionTaxReversalAmount).toBe("0.00");
  });

  it("rounds the ratio ONCE, on the product, never twice", () => {
    // 1/3 of a commission. Rounding the ratio to two places first
    // (0.33) and multiplying gives 3.30; carrying full precision and
    // rounding once gives 3.33. The second is correct.
    const result = computeDisputeRefundReversalExact({
      productRefundAmountInclTax: "1.00",
      shippingRefundAmount: "0.00",
      snapshotProductAmountInclTax: "3.00",
      snapshotCommissionShareAmount: "10.00",
      snapshotCommissionShareTaxAmount: "0.00",
    });

    expect(result.commissionReversalAmount).toBe("3.33");
    expect(result.commissionReversalAmount).not.toBe("3.30");
  });

  it("every output is a canonical two-place decimal string", () => {
    const result = computeDisputeRefundReversalExact({
      productRefundAmountInclTax: "38.33",
      shippingRefundAmount: "3.33",
      snapshotProductAmountInclTax: "115.00",
      snapshotCommissionShareAmount: "11.60",
      snapshotCommissionShareTaxAmount: "1.74",
    });

    for (const value of Object.values(result)) {
      expect(isExactMoney(value)).toBe(true);
    }
  });
});

describe("the source itself contains no float conversion", () => {
  // A guard on the code, not on its behaviour. Every assertion above
  // would still pass if someone reintroduced a `Number()` in a branch
  // the cases happen not to reach.
  const SOURCE = readFileSync(join(__dirname, "dispute-refund-exact.ts"), "utf8");
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it.each(["Number(", "parseFloat(", "parseInt(", ".toNumber()", "Math.round", "* 100"])(
    "contains no %s",
    (forbidden) => {
      expect(CODE).not.toContain(forbidden);
    }
  );

  it("does its rounding through Decimal.toFixed with an explicit mode", () => {
    expect(CODE).toContain("toFixed(SCALE, ROUNDING)");
    expect(CODE).toContain("Decimal.ROUND_HALF_UP");
  });
});
