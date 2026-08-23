import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Decimal } from "decimal.js";
import { InvalidTaxInputError, computeTaxSnapshot } from "./tax-snapshot";

/**
 * The tax split, which had no test at all until the Financial Precision
 * Gate.
 *
 * The defect this pins: the old implementation divided in binary double
 * and rounded with `Math.round((value + Number.EPSILON) * 100) / 100`.
 * `Number.EPSILON` is smaller than one ULP for any value above ~2, so the
 * guard did nothing, and `2.175 * 100` is `217.49999999999997` — so a
 * price whose exclusive amount lands exactly on a half-cent rounded DOWN
 * instead of up, and the split between supplier revenue and VAT came out
 * a cent wrong. Both figures are written to `Decimal(12,2)` columns and
 * frozen at publish.
 */

const RULE = { ruleCode: "SA_VAT", ruleVersion: "1" };

const snapshot = (unitPriceInclTax: string, ratePercent: string) =>
  computeTaxSnapshot({ unitPriceInclTax, ratePercent, ...RULE });

describe("the cases the old float pipeline got wrong", () => {
  it("2.61 at 20% splits 2.18 / 0.43, not 2.17 / 0.44", () => {
    // 2.61 / 1.2 is exactly 2.175. ROUND_HALF_UP takes it to 2.18.
    expect(snapshot("2.61", "20.00")).toMatchObject({
      unitPriceExclTaxAmount: "2.18",
      unitTaxAmount: "0.43",
    });
  });

  it("4.27 at 100% splits 2.14 / 2.13, not 2.13 / 2.14", () => {
    expect(snapshot("4.27", "100.00")).toMatchObject({
      unitPriceExclTaxAmount: "2.14",
      unitTaxAmount: "2.13",
    });
  });

  it.each([
    ["4.77", "3.98", "0.79"],
    ["5.97", "4.98", "0.99"],
    ["8.79", "7.33", "1.46"],
    ["11.19", "9.33", "1.86"],
    ["16.83", "14.03", "2.80"],
    ["32.91", "27.43", "5.48"],
  ])("half-cent tie at 20%%: %s -> %s / %s", (price, excl, tax) => {
    expect(snapshot(price, "20.00")).toMatchObject({
      unitPriceExclTaxAmount: excl,
      unitTaxAmount: tax,
    });
  });
});

describe("the cases that were already right stay right", () => {
  it("115.15 at 15% splits 100.13 / 15.02", () => {
    expect(snapshot("115.15", "15.00")).toMatchObject({
      unitPriceExclTaxAmount: "100.13",
      unitTaxAmount: "15.02",
    });
  });

  it.each([
    ["0.10", "0.09", "0.01"],
    ["0.20", "0.17", "0.03"],
  ])("%s at 15%% splits %s / %s", (price, excl, tax) => {
    expect(snapshot(price, "15.00")).toMatchObject({
      unitPriceExclTaxAmount: excl,
      unitTaxAmount: tax,
    });
  });

  it("charges no tax at 0%", () => {
    expect(snapshot("115.15", "0.00")).toMatchObject({
      unitPriceExclTaxAmount: "115.15",
      unitTaxAmount: "0.00",
    });
  });

  it("handles a zero price without producing a negative or NaN", () => {
    expect(snapshot("0.00", "15.00")).toMatchObject({
      unitPriceExclTaxAmount: "0.00",
      unitTaxAmount: "0.00",
    });
  });
});

describe("the invariant: the two figures sum back to the price exactly", () => {
  it("holds across every 2-decimal price at every tie-producing rate", () => {
    // The subtraction step is what guarantees this; it held under the old
    // implementation too, which is precisely why the defect was invisible
    // to a reconciliation that only checked the sum.
    for (const rate of ["0.00", "5.00", "15.00", "20.00", "25.00", "100.00"]) {
      for (let cents = 0; cents <= 20000; cents++) {
        const price = new Decimal(cents).div(100).toFixed(2);
        const result = snapshot(price, rate);
        const sum = new Decimal(result.unitPriceExclTaxAmount).plus(result.unitTaxAmount);

        if (!sum.equals(new Decimal(price))) {
          throw new Error(
            `rate=${rate} price=${price}: ${result.unitPriceExclTaxAmount} + ${result.unitTaxAmount} = ${sum.toFixed(2)}`
          );
        }
      }
    }
  });

  it("agrees with an independent exact computation across a wide sweep", () => {
    // Recomputed here from first principles rather than by calling the
    // module again — a test that reuses the implementation proves nothing.
    for (const rate of ["7.50", "12.25", "15.00", "20.00", "33.33", "100.00"]) {
      for (let cents = 1; cents <= 30000; cents++) {
        const price = new Decimal(cents).div(100).toFixed(2);
        const result = snapshot(price, rate);

        const expectedExcl = new Decimal(price)
          .div(new Decimal(1).plus(new Decimal(rate).div(100)))
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const expectedTax = new Decimal(price).minus(expectedExcl);

        if (
          result.unitPriceExclTaxAmount !== expectedExcl.toFixed(2) ||
          result.unitTaxAmount !== expectedTax.toFixed(2)
        ) {
          throw new Error(
            `rate=${rate} price=${price}: got ${result.unitPriceExclTaxAmount}/${result.unitTaxAmount}, expected ${expectedExcl.toFixed(2)}/${expectedTax.toFixed(2)}`
          );
        }
      }
    }
  });
});

describe("shape of the output", () => {
  it("returns decimal strings at scale 2, never numbers", () => {
    const result = snapshot("115.15", "15.00");

    for (const value of [
      result.unitPriceExclTaxAmount,
      result.unitTaxAmount,
      result.taxRatePercent,
    ]) {
      expect(typeof value).toBe("string");
      expect(value).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("canonicalises the rate to the scale its column holds", () => {
    // A setting stored as `15` and one stored as `15.00` must produce the
    // same snapshot.
    expect(snapshot("115.15", "15").taxRatePercent).toBe("15.00");
    expect(snapshot("115.15", "15.00").taxRatePercent).toBe("15.00");
  });

  it("carries the rule code and version through untouched", () => {
    expect(snapshot("115.15", "15.00")).toMatchObject({
      taxCalculationRuleCode: "SA_VAT",
      taxCalculationRuleVersion: "1",
    });
  });
});

describe("the largest value the column can hold", () => {
  it("computes at the Decimal(12,2) ceiling without losing a digit", () => {
    const max = "9999999999.99";
    const result = snapshot(max, "15.00");

    expect(result.unitPriceExclTaxAmount).toBe("8695652173.90");
    expect(result.unitTaxAmount).toBe("1304347826.09");
    expect(
      new Decimal(result.unitPriceExclTaxAmount).plus(result.unitTaxAmount).toFixed(2)
    ).toBe(max);
  });

  it("keeps full precision where a double would already have failed", () => {
    // 9999999999.99 is not representable exactly as a double; the string
    // path never converts it to one.
    expect(snapshot("9999999999.99", "0.00").unitPriceExclTaxAmount).toBe("9999999999.99");
  });
});

describe("bad input is refused, never quietly computed", () => {
  it.each(["115.155", "0.001", "1e21", "1E21", "NaN", "Infinity", "-Infinity", "", "abc", "12,50"])(
    "refuses %s as a price",
    (bad) => {
      expect(() => snapshot(bad, "15.00")).toThrow(InvalidTaxInputError);
    }
  );

  it("refuses a negative price", () => {
    expect(() => snapshot("-1.00", "15.00")).toThrow(InvalidTaxInputError);
  });

  it.each(["NaN", "Infinity", "-1", "100.01", "abc"])("refuses %s as a rate", (bad) => {
    expect(() => snapshot("115.15", bad)).toThrow(InvalidTaxInputError);
  });
});

describe("no float arithmetic survives on this path", () => {
  const source = readFileSync(join(__dirname, "tax-snapshot.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("uses no Math.round, no Number.EPSILON and no Number() coercion", () => {
    expect(code).not.toContain("Math.round");
    expect(code).not.toContain("Number.EPSILON");
    expect(code).not.toMatch(/\bNumber\(/);
    expect(code).not.toContain("parseFloat");
    expect(code).not.toContain("toNumber");
  });

  it("does every step in Decimal, rounding HALF_UP", () => {
    expect(code).toContain("ROUND_HALF_UP");
    expect(code).toContain("toDecimalPlaces");
    expect(code).toContain(".div(");
    expect(code).toContain(".minus(");
  });

  it("depends on decimal.js directly, never on the database client", () => {
    // This package is pure domain logic. Importing Prisma here would make
    // the rule depend on the client that happens to store the result.
    expect(code).toContain('from "decimal.js"');
    expect(code).not.toContain("@prisma/client");
    expect(code).not.toContain("Prisma.Decimal");
  });
});
