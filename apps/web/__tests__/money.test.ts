import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatMoney, formatPercentage, formatQuantity } from "@/lib/money";

/**
 * The numeric run only.
 *
 * Locale output wraps the figure in directional marks, non-breaking
 * spaces and a currency name that itself contains dots, so stripping
 * every non-digit would fold the currency into the number.
 */
const digits = (value: string | null) => value?.match(/-?[\d,]+(\.\d+)?/)?.[0] ?? null;

describe("formatMoney", () => {
  it("keeps both decimal places on a round amount", () => {
    // "SAR 1,200" reads as an approximation of a figure that is exact.
    expect(digits(formatMoney("1200.00", "SAR", "en-SA"))).toBe("1,200.00");
  });

  it("keeps a trailing zero on a half amount", () => {
    expect(digits(formatMoney("75.50", "SAR", "en-SA"))).toBe("75.50");
  });

  it("rejects a non-canonical scale rather than guessing at it", () => {
    // The API emits Decimal.toFixed(2) everywhere, so "1200" or "75.5"
    // did not come from it. Formatting them anyway would render a
    // figure of unknown provenance as though it were authoritative;
    // rendering a stated absence surfaces the contract break instead.
    expect(formatMoney("1200", "SAR", "en-SA")).toBeNull();
    expect(formatMoney("75.5", "SAR", "en-SA")).toBeNull();
    expect(formatMoney("75.500", "SAR", "en-SA")).toBeNull();
  });

  it("uses Latin digits in BOTH locales, matching the date layer", () => {
    // Intl defaults ar-SA to Arabic-Indic numerals. lib/localized.ts
    // already pins dates to latn so one product cannot show a closing
    // date in two numbering systems; a price beside it is the same
    // problem, so it follows the same rule.
    for (const locale of ["ar-SA", "en-SA"] as const) {
      expect(digits(formatMoney("995.50", "SAR", locale)), locale).toBe("995.50");
    }
    expect(formatMoney("995.50", "SAR", "ar-SA")).not.toMatch(/[٠-٩]/);
    expect(formatQuantity(12000, "ar-SA")).not.toMatch(/[٠-٩]/);
    expect(formatPercentage(50, "ar-SA")).not.toMatch(/[٠-٩]/);
  });

  it("names the currency it was given rather than assuming one", () => {
    expect(formatMoney("10.00", "SAR", "en-SA")).toContain("SAR");
    expect(formatMoney("10.00", "USD", "en-SA")).not.toContain("SAR");
  });

  it("returns null for anything that is not a decimal amount", () => {
    // A malformed amount must render as a stated absence. "NaN SAR" is
    // noise, and "0.00" would be a claim about what something costs.
    for (const bad of ["", " ", "abc", "1.2.3", "1e5", "Infinity", "NaN", "12,50", "١٢٣"]) {
      expect(formatMoney(bad, "SAR", "en-SA"), bad).toBeNull();
    }
  });

  it("handles a negative amount without mangling the sign", () => {
    expect(formatMoney("-75.25", "SAR", "en-SA")).not.toBeNull();
    expect(digits(formatMoney("-75.25", "SAR", "en-SA"))).toContain("75.25");
  });

  it("keeps a large amount exact rather than abbreviating it", () => {
    expect(digits(formatMoney("9999999.99", "SAR", "en-SA"))).toBe("9,999,999.99");
  });
});

describe("there is no number path left to fall back to", () => {
  const SOURCE = readFileSync(join(__dirname, "..", "lib", "money.ts"), "utf8");

  it("validates with the SHARED guard, not a second local regex", () => {
    // A local copy is how the client comes to accept a shape the API
    // never sends, or reject one it does.
    expect(SOURCE).toContain('import { isMoneyString } from "@platform/types"');
    expect(SOURCE).toContain("if (!isMoneyString(amount)) return null;");
    expect(SOURCE).not.toMatch(/const DECIMAL_STRING = \//);
  });

  it("exports exactly one money formatter, and it takes a string", () => {
    // A second entry point accepting a number existed while
    // /trader/opportunities/* still sent one. The endpoint now sends a
    // decimal string like every other, and the number path was removed
    // rather than left available: a tolerated shape comes back.
    expect(SOURCE).not.toContain("formatMoneyFromApiNumber");
    expect(SOURCE).toMatch(/export function formatMoney\(\s*amount: string/);
    expect(SOURCE.match(/export function formatMoney\w*/g)).toEqual([
      "export function formatMoney",
    ]);
  });

  it("rejects a number handed to it at runtime, not just at compile time", () => {
    // A JSON boundary can deliver anything. The guard has to hold when
    // the type says otherwise.
    expect(formatMoney(125.5 as unknown as string, "SAR", "en-SA")).toBeNull();
    expect(formatMoney(0 as unknown as string, "SAR", "en-SA")).toBeNull();
  });

  it("still renders the exact figures the opportunities endpoint now sends", () => {
    expect(digits(formatMoney("1234.50", "SAR", "en-SA"))).toBe("1,234.50");
    expect(digits(formatMoney("115.00", "SAR", "en-SA"))).toBe("115.00");
    expect(digits(formatMoney("0.00", "SAR", "en-SA"))).toBe("0.00");
  });
});

describe("formatPercentage", () => {
  it("rounds a raw progress float to something readable", () => {
    expect(digits(formatPercentage(33.333333, "en-SA"))).toBe("33.3");
    expect(digits(formatPercentage(50, "en-SA"))).toBe("50");
  });

  it("keeps 0 and 100 intact", () => {
    expect(digits(formatPercentage(0, "en-SA"))).toBe("0");
    expect(digits(formatPercentage(100, "en-SA"))).toBe("100");
  });

  it("returns null for a non-finite value", () => {
    expect(formatPercentage(Number.NaN, "en-SA")).toBeNull();
  });
});

describe("formatQuantity", () => {
  it("groups a large quantity so it can be read at a glance", () => {
    expect(digits(formatQuantity(12000, "en-SA"))).toBe("12,000");
  });

  it("leaves a small quantity alone", () => {
    expect(digits(formatQuantity(4, "en-SA"))).toBe("4");
  });
});

describe("the money module does no arithmetic", () => {
  const SOURCE = readFileSync(join(__dirname, "..", "lib", "money.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("exports no add, multiply or sum", () => {
    // Every total is server-authoritative: the checkout quote is frozen
    // in quote_snapshots and that is the figure charged. A client-side
    // total is a second source of truth that will eventually disagree.
    for (const name of ["add", "sum", "multiply", "total", "subtotal"]) {
      expect(SOURCE).not.toMatch(new RegExp(`export function ${name}`, "i"));
    }
  });

  it("never returns a number a caller could compute with", () => {
    const signatures = SOURCE.match(/export function \w+\([\s\S]*?\): [\w |]+ \{/g) ?? [];
    expect(signatures.length).toBeGreaterThan(0);
    for (const signature of signatures) {
      expect(signature).toMatch(/\): string( \| null)? \{$/);
    }
  });
});
