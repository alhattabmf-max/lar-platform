import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { DEFAULT_SHARE_TIERS, computeTaxSnapshot, selectTier, type ShareTier } from "@platform/domain";

/**
 * The Financial Precision Delta, held in place.
 *
 * Three `Decimal.toNumber()` calls used to sit between the stored price
 * and the values written back to `Decimal` columns. Two of them fed
 * `computeTaxSnapshot`, whose float rounding was wrong for 0.61% of
 * two-decimal prices at a 20% rate and 3.28% at 100%. Those two are gone.
 * The third remains and is threshold selection only; this file is where
 * that claim is checked rather than asserted.
 */

const SERVICE = readFileSync(join(__dirname, "opportunities.service.ts"), "utf8");
const CODE = SERVICE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("no money value reaches a column through a float", () => {
  it("passes a stored price to the tax computation as a decimal string", () => {
    expect(CODE).toContain("existing.unitPriceAmount.toFixed(2)");
    expect(CODE).not.toContain("existing.unitPriceAmount.toNumber()");
  });

  it("canonicalises a submitted price instead of handing over the raw number", () => {
    expect(CODE).toContain('toCanonicalMoney(dto.unitPriceAmount, "unitPriceAmount")');
    expect(CODE).toContain("new Prisma.Decimal(String(value)).toFixed(2)");
  });

  it("writes the total value from the exact Decimal, not from the tier number", () => {
    expect(CODE).toContain("totalValueInclTaxAmount: totalValueDecimal.toFixed(2)");
    expect(CODE).not.toContain("totalValueInclTaxAmount: totalValueNumber");
  });

  it("declares every stored money field on SnapshotFields as a string", () => {
    const block = CODE.match(/interface SnapshotFields \{([\s\S]*?)\n\}/)![1];

    for (const field of [
      "taxRatePercent",
      "unitPriceExclTaxAmount",
      "unitTaxAmount",
      "totalValueInclTaxAmount",
    ]) {
      expect([field, new RegExp(`${field}:\\s*string;`).test(block)]).toEqual([field, true]);
    }
  });

  it("leaves exactly one toNumber, and it is the tier selection", () => {
    const sites = CODE.split("\n")
      .filter((line) => /\.toNumber\(\)/.test(line))
      .map((line) => line.trim());

    expect(sites).toEqual(["const totalValueForTierSelection = totalValueDecimal.toNumber();"]);
  });

  it("names that one for what it is, so its purpose survives a refactor", () => {
    expect(SERVICE).toContain("THRESHOLD SELECTION ONLY");
  });
});

describe("the surviving conversion is threshold selection and cannot flip a tier", () => {
  const tiers = DEFAULT_SHARE_TIERS as ShareTier[];

  /** The same comparison `selectTier` does, but in exact Decimal. */
  function exactTier(total: Prisma.Decimal): number {
    for (let i = 0; i < tiers.length; i++) {
      const bound = tiers[i].maxTotalValueInclTax;
      if (bound === null || total.lessThanOrEqualTo(bound)) return i;
    }
    throw new Error("no tier matched");
  }

  it("agrees with exact Decimal across the quantity and price ranges allowed", () => {
    // maxTargetQuantity is bounded at 10,000,000 and the total's column is
    // Decimal(14,2) — about 1e12. A double holds every 2-decimal value
    // exactly to MAX_SAFE_INTEGER / 100 ≈ 9.0e13, some ninety times
    // further out, which is why the comparison is safe.
    let compared = 0;

    for (const price of ["0.01", "0.25", "0.50", "2.61", "115.15", "999.99", "12345.67"]) {
      for (let qty = 1; qty <= 20000; qty++) {
        const exact = new Prisma.Decimal(qty).mul(price);
        if (exact.greaterThan("999999999999.99")) continue;

        const viaFloat = selectTier({ tiers }, exact.toNumber()).tierIndex;
        expect([price, qty, viaFloat]).toEqual([price, qty, exactTier(exact)]);
        compared++;
      }
    }

    expect(compared).toBeGreaterThan(100000);
  });

  it("agrees exactly ON each tier boundary, where a flip would show first", () => {
    for (const bound of [50_000, 200_000]) {
      for (const delta of ["-0.01", "0.00", "0.01"]) {
        const total = new Prisma.Decimal(bound).plus(delta);
        expect([bound, delta, selectTier({ tiers }, total.toNumber()).tierIndex]).toEqual([
          bound,
          delta,
          exactTier(total),
        ]);
      }
    }
  });

  it("never derives a stored amount from the tier number", () => {
    // The whole justification rests on this: the number picks an index
    // and nothing else. It is mentioned exactly twice — once assigned,
    // once passed to selectTier — and the call it is passed to is that
    // one. Matched on the collapsed source because the call spans lines.
    const mentions = CODE.match(/totalValueForTierSelection/g) ?? [];
    expect(mentions).toHaveLength(2);

    const collapsed = CODE.replace(/\s+/g, " ");
    expect(collapsed).toContain("const totalValueForTierSelection = totalValueDecimal.toNumber();");
    expect(collapsed).toMatch(/selectTier\([^)]*totalValueForTierSelection\s*\)/);

    // And the stored amount comes from the Decimal, not from it.
    expect(collapsed).toContain("totalValueInclTaxAmount: totalValueDecimal.toFixed(2)");
  });
});

describe("the API's own call into the tax computation", () => {
  it("produces the corrected split for the case that used to be wrong", () => {
    // The same call shape `computeSnapshotFields` makes.
    const result = computeTaxSnapshot({
      unitPriceInclTax: new Prisma.Decimal("2.61").toFixed(2),
      ratePercent: new Prisma.Decimal("20").toFixed(2),
      ruleCode: "SA_VAT",
      ruleVersion: "1",
    });

    expect(result.unitPriceExclTaxAmount).toBe("2.18");
    expect(result.unitTaxAmount).toBe("0.43");
  });

  it("round-trips a Prisma.Decimal price without losing a digit", () => {
    const stored = new Prisma.Decimal("9999999999.99");
    const result = computeTaxSnapshot({
      unitPriceInclTax: stored.toFixed(2),
      ratePercent: "0.00",
      ruleCode: "SA_VAT",
      ruleVersion: "1",
    });

    expect(result.unitPriceExclTaxAmount).toBe("9999999999.99");
    expect(new Prisma.Decimal(result.unitPriceExclTaxAmount).equals(stored)).toBe(true);
  });

  it("canonicalises the stored rate to the scale its column holds", () => {
    expect(CODE).toContain("new Prisma.Decimal(String(taxResult.ratePercent)).toFixed(2)");
  });
});
