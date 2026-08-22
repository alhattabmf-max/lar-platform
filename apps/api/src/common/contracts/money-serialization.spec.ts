import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import {
  MONEY_SCALE,
  MONEY_STRING_PATTERN,
  assertMoneyString,
  decimalStringPattern,
  isDecimalString,
  isMoneyString,
} from "@platform/types";

/**
 * One representation of money on every trader-facing surface.
 *
 * These figures come from `Decimal(12,2)` and `Decimal(14,2)` columns
 * and are reconciled against bank statements. JSON has one numeric
 * type — IEEE-754 double — in which 125.50 is not representable, so a
 * value serialised through a number is a different value that merely
 * prints the same. The rule is therefore mechanical: a trader-facing
 * view mapper renders money with `Decimal.toFixed(2)` and nothing else.
 *
 * The tests below read the actual mappers. A convention nobody checks
 * lasts until the next person adds a field.
 */

const SRC = join(__dirname, "..", "..");

/** Comments state the rules; they must not be mistaken for the code that keeps them. */
function code(relative: string): string {
  return readFileSync(join(SRC, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Every mapper that produces a shape a TRADER receives.
 *
 * Admin and supplier surfaces are deliberately absent — they are a
 * separate audience with their own contracts, and widening this list
 * to them would be a change of scope, not a tightening.
 */
const TRADER_FACING_MAPPERS = [
  "checkout/checkout-session.view.ts",
  "checkout/checkout-session.service.ts",
  "payments/payment-attempt.service.ts",
  "orders/trader-orders.service.ts",
  "opportunities/opportunity-discovery.service.ts",
  "notifications/notification-events.service.ts",
  "notifications/notifications.service.ts",
];

describe("no trader-facing mapper turns money into a number", () => {
  it.each(TRADER_FACING_MAPPERS)("%s never calls Decimal.toNumber()", (file) => {
    expect(code(file)).not.toMatch(/\.toNumber\(\)/);
  });

  it.each(TRADER_FACING_MAPPERS)("%s never calls parseFloat", (file) => {
    expect(code(file)).not.toMatch(/parseFloat\(/);
  });

  it("renders money only through toFixed at the money scale", () => {
    for (const file of TRADER_FACING_MAPPERS) {
      const scales = code(file).match(/\.toFixed\((\d+)\)/g) ?? [];
      for (const call of scales) {
        expect([file, call]).toEqual([file, `.toFixed(${MONEY_SCALE})`]);
      }
    }
  });

  it("keeps the one remaining Number() at the payment provider boundary", () => {
    // The provider's SDK contract takes a JSON number. That call is an
    // outbound argument, not a serialized response field — nothing it
    // touches reaches a client. It is asserted here so the exception
    // stays a single known place rather than becoming a habit.
    const source = code("payments/payment-attempt.service.ts");
    const coercions = source.match(/Number\([^)]*\)/g) ?? [];

    expect(coercions).toEqual(["Number(attempt.amount)"]);
    expect(source).toMatch(/createPaymentIntent\(\{\s*amount: Number\(attempt\.amount\)/);
  });

  it("does no money arithmetic in JavaScript numbers when building a quote", () => {
    // `Number(unitPrice) * quantity` goes through IEEE-754 and can land
    // a cent away from the arithmetic a person would do by hand — into
    // a column the payment provider is then asked to charge.
    const source = code("checkout/checkout-session.service.ts");

    expect(source).not.toMatch(/Number\(\s*\w*[Uu]nit\w*\s*\)\s*\*/);
    expect(source).toContain("new Prisma.Decimal(dto.quantity)");
    expect(source).toContain(".mul(quantity)");
  });
});

describe("POST and GET on a checkout session answer with one shape", () => {
  const service = code("checkout/checkout-session.service.ts");

  it("maps the create response through the SAME projection as the read", () => {
    // Assembling the response from the values just computed is what let
    // the two drift: POST answered with JSON numbers and its own field
    // names while GET answered with decimal strings, for one entity.
    const occurrences = service.match(/CHECKOUT_SESSION_VIEW_SELECT/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);

    const mappings = service.match(/toCheckoutSessionView\(/g) ?? [];
    expect(mappings.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps no second ad-hoc checkout mapper", () => {
    expect(service).not.toContain("toTraderCheckoutView");
    expect(service).not.toMatch(/minimumQuantity/);
    expect(service).not.toMatch(/sharePercentage:/);
  });

  it("reads its own writes by using the transaction client", () => {
    // A read on the pooled client would run on another connection and
    // could not see the uncommitted session it just created.
    expect(service).toMatch(/await tx\.checkoutSession\.findUniqueOrThrow\(\{[\s\S]*?CHECKOUT_SESSION_VIEW_SELECT/);
  });
});

describe("the money string contract itself", () => {
  it("accepts exactly the canonical form", () => {
    for (const value of ["0.00", "125.50", "-75.25", "9999999.99", "1.00"]) {
      expect([value, isMoneyString(value)]).toEqual([value, true]);
    }
  });

  it("rejects anything that would be re-parsed as a float", () => {
    for (const value of [
      "12.5", // a dropped trailing zero loses the scale
      "12", // no fraction at all
      "1,250.00", // a thousands separator is presentation
      "12.50 SAR", // a currency belongs in its own field
      "1.2e3",
      "",
      " 12.50",
      "12.50 ",
      "١٢.٥٠", // Arabic-Indic digits are presentation too
      "NaN",
      "Infinity",
      12.5,
      null,
      undefined,
    ]) {
      expect([value, isMoneyString(value)]).toEqual([value, false]);
    }
  });

  it("is anchored, so a valid amount inside junk does not pass", () => {
    expect(MONEY_STRING_PATTERN.test("total: 12.50")).toBe(false);
    expect(MONEY_STRING_PATTERN.test("12.50\n99.99")).toBe(false);
  });

  it("validates a non-money decimal at its OWN precision", () => {
    // A tax rate is Decimal(5,2); a package content quantity is
    // Decimal(10,3). Checking those against the money scale would
    // reject values that are perfectly correct.
    expect(isDecimalString("15.00", 2)).toBe(true);
    expect(isDecimalString("2.500", 3)).toBe(true);
    expect(isDecimalString("2.50", 3)).toBe(false);
    expect(isDecimalString("7", 0)).toBe(true);
    expect(isDecimalString("7.0", 0)).toBe(false);
  });

  it("refuses a nonsensical scale rather than building a broken pattern", () => {
    expect(() => decimalStringPattern(-1)).toThrow(RangeError);
    expect(() => decimalStringPattern(1.5)).toThrow(RangeError);
  });

  it("names the field when an assertion fails", () => {
    expect(() => assertMoneyString(12.5, "grandTotalAmount")).toThrow(/grandTotalAmount/);
    expect(() => assertMoneyString("12.50", "grandTotalAmount")).not.toThrow();
  });

  it("is exactly what Decimal.toFixed produces", () => {
    // The contract and the serializer must agree, or one of them is
    // describing something the other does not emit.
    for (const raw of ["0", "125.5", "-75.25", "1", "9999999.99"]) {
      expect([raw, isMoneyString(new Prisma.Decimal(raw).toFixed(MONEY_SCALE))]).toEqual([raw, true]);
    }
  });
});
