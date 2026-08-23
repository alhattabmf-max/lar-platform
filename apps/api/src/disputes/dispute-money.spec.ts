import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { DECIMAL_12_2_MAX, DECIMAL_14_2_MAX, fitsDecimalPrecision } from "@platform/types";
import { AdminDecideDisputeDto } from "./dto/admin-decide-dispute.dto";

/**
 * The dispute refund path carries no float, and the source proves it.
 *
 * Behavioural tests only cover the branches the cases reach. This reads
 * the two files the money actually flows through and asserts the
 * conversion is absent everywhere, including in branches nobody wrote a
 * case for.
 *
 * The path: `admin-dispute.controller.ts` receives validated decimal
 * strings, passes them through unconverted, and `dispute.service.ts`
 * compares and computes with them as Decimals before Prisma writes them.
 */

const SERVICE = readFileSync(join(__dirname, "dispute.service.ts"), "utf8");
const CONTROLLER = readFileSync(
  join(__dirname, "..", "admin", "disputes", "admin-dispute.controller.ts"),
  "utf8"
);

/** Comments explain the conversions that are NOT there; code must not contain them. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const CONTROLLER_CODE = strip(CONTROLLER);

/**
 * The money region of the service, from the frozen snapshot to the
 * constraint check that closes the ledger write.
 *
 * Scoped rather than whole-file: `dispute.service.ts` also holds trader
 * and supplier read views, and a `Number()` in an unrelated pagination
 * clamp is not a defect on this path. Slicing keeps the assertion about
 * what it claims to be about.
 */
function moneyRegion(): string {
  const code = strip(SERVICE);
  const start = code.indexOf("const snapshot = dispute.orderAllocation.financialSnapshot");
  const end = code.indexOf("trg_check_journal_entry_balance");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return code.slice(start, end);
}

describe("the controller converts nothing", () => {
  it("contains no Number(), parseFloat or parseInt at all", () => {
    expect(CONTROLLER_CODE).not.toContain("Number(");
    expect(CONTROLLER_CODE).not.toContain("parseFloat");
    expect(CONTROLLER_CODE).not.toContain("parseInt");
  });

  it("passes both amounts straight through from the DTO", () => {
    expect(CONTROLLER_CODE).toContain(
      "productRefundAmountInclTax: dto.productRefundAmountInclTax"
    );
    expect(CONTROLLER_CODE).toContain("shippingRefundAmount: dto.shippingRefundAmount");
  });
});

describe("the service's money region converts nothing", () => {
  const REGION = moneyRegion();

  it.each(["Number(", "parseFloat(", "parseInt(", ".toNumber()", "Math.round"])(
    "contains no %s",
    (forbidden) => {
      expect(REGION).not.toContain(forbidden);
    }
  );

  it("renders every snapshot column with toFixed(2)", () => {
    // `Prisma.Decimal` handed to JSON.stringify calls toString(), which
    // drops the scale: 100.00 becomes "100". Every snapshot read on this
    // path goes through toFixed instead.
    expect(REGION).toContain("snapshot.productAmountInclTax.toFixed(2)");
    expect(REGION).toContain("snapshot.shippingFeeAmount.toFixed(2)");
    expect(REGION).toContain("snapshot.commissionShareAmount.toFixed(2)");
    expect(REGION).toContain("snapshot.commissionShareTaxAmount.toFixed(2)");
  });

  it("bounds the refund with the Decimal comparison, not an operator", () => {
    expect(REGION).toContain("isWithinExact(input.productRefundAmountInclTax, snapshotProduct)");
    expect(REGION).toContain("isWithinExact(input.shippingRefundAmount, snapshotShipping)");
    // `a > b` on two amounts is what this replaced.
    expect(REGION).not.toMatch(/input\.\w*Refund\w*\s*[<>]/);
  });

  it("computes the reversal with the exact implementation", () => {
    expect(REGION).toContain("computeDisputeRefundReversalExact");
    expect(REGION).not.toContain("computeDisputeRefundReversal(");
  });

  it("writes every amount as a Prisma.Decimal built from the original string", () => {
    expect(REGION).toContain("new Prisma.Decimal(productRefund)");
    expect(REGION).toContain("new Prisma.Decimal(shippingRefund)");
    expect(REGION).toContain("new Prisma.Decimal(reversal.totalRefundAmount)");
    expect(REGION).toContain("new Prisma.Decimal(reversal.supplierPayableDebitAmount)");
    expect(REGION).toContain("new Prisma.Decimal(reversal.commissionReversalAmount)");
    expect(REGION).toContain("new Prisma.Decimal(reversal.commissionTaxReversalAmount)");
  });

  it("decides posting inclusion with the exact predicate", () => {
    // `amount > 0` on a decimal string is a string comparison, which is
    // wrong in a different and quieter way than a float.
    expect(REGION).toContain("isPositiveExact(");
    expect(REGION).not.toMatch(/reversal\.\w+\s*>\s*0/);
  });
});

describe("the DTO refuses everything that is not a canonical decimal", () => {
  function check(raw: unknown) {
    return validateSync(plainToInstance(AdminDecideDisputeDto, raw), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  }

  const VALID = {
    decisionType: "PARTIAL_REFUND",
    reasonNote: "Partial refund agreed with the buyer",
  };

  it("accepts a canonical pair", () => {
    expect(
      check({ ...VALID, productRefundAmountInclTax: "57.50", shippingRefundAmount: "0.00" })
    ).toHaveLength(0);
  });

  const REJECTED: ReadonlyArray<readonly [string, unknown]> = [
    ["three decimal places", "1.005"],
    ["one decimal place", "1.5"],
    ["no decimal point", "100"],
    ["scientific notation", "1e3"],
    ["uppercase scientific notation", "1E3"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["a negative amount", "-5.00"],
    ["leading whitespace", " 1.00"],
    ["trailing whitespace", "1.00 "],
    ["a thousands separator", "1,000.00"],
    ["a number rather than a string", 57.5],
    ["null", null],
    ["an empty string", ""],
    ["above the Decimal(14,2) ceiling", "1000000000000.00"],
    ["far above the ceiling", "99999999999999999.00"],
  ];

  it.each(REJECTED)("REJECTS %s", (_label, value) => {
    const errors = check({
      ...VALID,
      productRefundAmountInclTax: value,
      shippingRefundAmount: "0.00",
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts exactly the Decimal(14,2) ceiling", () => {
    expect(
      check({
        ...VALID,
        productRefundAmountInclTax: DECIMAL_14_2_MAX,
        shippingRefundAmount: "0.00",
      })
    ).toHaveLength(0);
  });
});

describe("the shared precision bounds", () => {
  it("state the real column limits", () => {
    // numeric(p,s) allows p - s integer digits.
    expect(DECIMAL_14_2_MAX).toBe("999999999999.99");
    expect(DECIMAL_12_2_MAX).toBe("9999999999.99");
    expect(DECIMAL_14_2_MAX.split(".")[0]).toHaveLength(12);
    expect(DECIMAL_12_2_MAX.split(".")[0]).toHaveLength(10);
  });

  it("accept a value at the boundary and refuse one past it", () => {
    expect(fitsDecimalPrecision(DECIMAL_14_2_MAX, 12)).toBe(true);
    expect(fitsDecimalPrecision("1000000000000.00", 12)).toBe(false);
    expect(fitsDecimalPrecision(DECIMAL_12_2_MAX, 10)).toBe(true);
    expect(fitsDecimalPrecision("10000000000.00", 10)).toBe(false);
  });

  it("refuse a non-canonical string outright", () => {
    expect(fitsDecimalPrecision("1e3", 12)).toBe(false);
    expect(fitsDecimalPrecision("NaN", 12)).toBe(false);
    expect(fitsDecimalPrecision("1.5", 12)).toBe(false);
  });
});
