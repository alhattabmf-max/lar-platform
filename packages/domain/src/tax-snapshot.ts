import { Decimal } from "decimal.js";

/**
 * The tax split, computed exactly.
 *
 * This module used to take and return JS numbers, divide in binary
 * double, and round with `Math.round((value + Number.EPSILON) * 100) / 100`.
 * That is wrong, and provably so: `Number.EPSILON` (2.22e-16) is smaller
 * than one ULP for any value above about 2, so the guard lifted nothing,
 * and the `* 100` step is where the precision was actually lost —
 * `2.175 * 100` is `217.49999999999997`, so `Math.round` returned 217 and
 * the exclusive amount came out a cent low.
 *
 * At a 15% rate the division never lands on an exact half-cent, so nothing
 * was visibly wrong. At 20% it was wrong for 0.61% of two-decimal prices,
 * and at 100% for 3.28% of them. Both figures are written to
 * `Decimal(12,2)` columns, frozen at publish, and reconciled against for
 * the life of the listing — so "rarely wrong" is not a defence.
 *
 * Everything below is `Decimal`. There is no `Number`, no `Math.round` and
 * no `Number.EPSILON` on this path, and the inputs and outputs are decimal
 * STRINGS so a caller cannot reintroduce a float at the boundary.
 *
 * `decimal.js` directly, never Prisma's re-export: this package is pure
 * domain logic and must not depend on the database client.
 */

/** Money and the tax rate both cross this boundary at scale 2. */
export const TAX_MONEY_SCALE = 2;
export const TAX_RATE_SCALE = 2;

/**
 * The largest value the price's own column, `Decimal(12,2)`, can hold.
 *
 * Enforced here as well as in the request DTO. The DTO is the first line
 * and gives the better error message; this is the function's own
 * precondition, so a caller that reaches it another way — a background
 * job, a future endpoint — cannot compute a snapshot on a value the
 * column would silently round or reject.
 */
export const TAX_PRICE_MAX = "9999999999.99";

/** ROUND_HALF_UP, stated once so both roundings below cannot diverge. */
const ROUNDING = Decimal.ROUND_HALF_UP;

/**
 * Enough working precision that the intermediate quotient is never the
 * thing that loses a digit. A 12,2 amount divided by a 5,2 rate needs
 * nothing close to this.
 */
const DECIMAL = Decimal.clone({ precision: 40, rounding: ROUNDING });

export interface TaxSnapshotInput {
  /**
   * Tax-inclusive unit price as entered by the supplier, as a canonical
   * decimal string at scale 2 — the same representation the column holds.
   */
  unitPriceInclTax: string;
  /** Tax rate percentage, decimal string at scale 2. `"15.00"`, not `15`. */
  ratePercent: string;
  ruleCode: string;
  ruleVersion: string;
}

export interface TaxSnapshot {
  /** Decimal string, scale 2. */
  taxRatePercent: string;
  /** Decimal string, scale 2. */
  unitPriceExclTaxAmount: string;
  /** Decimal string, scale 2. */
  unitTaxAmount: string;
  taxCalculationRuleCode: string;
  taxCalculationRuleVersion: string;
}

export class InvalidTaxInputError extends Error {}

/**
 * Parses a value that must already be a finite decimal.
 *
 * Rejects `NaN`, `Infinity` and anything `Decimal` cannot read. A caller
 * that has validated its input loses nothing; a caller that has not gets
 * an error instead of a snapshot built on garbage.
 */
function parse(value: string, field: string): Decimal {
  let parsed: Decimal;
  try {
    parsed = new DECIMAL(value);
  } catch {
    throw new InvalidTaxInputError(`${field} is not a decimal value: ${JSON.stringify(value)}`);
  }
  if (!parsed.isFinite()) {
    throw new InvalidTaxInputError(`${field} must be finite, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

/**
 * The single, unified rounding rule for this platform's monetary values:
 * round the tax-EXCLUSIVE base to 2 decimals (ROUND_HALF_UP), then derive
 * the tax amount by SUBTRACTION from the fixed, supplier-entered
 * tax-inclusive price.
 *
 * Never round both independently — the two figures must sum back to the
 * inclusive price exactly, and rounding each on its own can break that by
 * a cent. The subtraction is what guarantees the invariant; doing it in
 * `Decimal` is what makes each figure individually right as well.
 */
export function computeTaxSnapshot(input: TaxSnapshotInput): TaxSnapshot {
  const incl = parse(input.unitPriceInclTax, "unitPriceInclTax");
  const rate = parse(input.ratePercent, "ratePercent");

  if (incl.isNegative()) {
    throw new InvalidTaxInputError(`unitPriceInclTax must not be negative, got ${input.unitPriceInclTax}`);
  }
  // Scale is a PRECONDITION, not something to round away. A price with a
  // third decimal is a value the column cannot hold, and quietly rounding
  // it would compute tax on a price the supplier never entered.
  if (incl.decimalPlaces() > TAX_MONEY_SCALE) {
    throw new InvalidTaxInputError(
      `unitPriceInclTax must have at most ${TAX_MONEY_SCALE} decimal places, got ${input.unitPriceInclTax}`
    );
  }
  if (incl.greaterThan(TAX_PRICE_MAX)) {
    throw new InvalidTaxInputError(
      `unitPriceInclTax must not exceed ${TAX_PRICE_MAX}, got ${input.unitPriceInclTax}`
    );
  }
  if (rate.isNegative() || rate.greaterThan(100)) {
    throw new InvalidTaxInputError(`ratePercent must be between 0 and 100, got ${input.ratePercent}`);
  }
  if (rate.decimalPlaces() > TAX_RATE_SCALE) {
    throw new InvalidTaxInputError(
      `ratePercent must have at most ${TAX_RATE_SCALE} decimal places, got ${input.ratePercent}`
    );
  }

  const divisor = new DECIMAL(1).plus(rate.div(100));
  const unitPriceExclTaxAmount = incl.div(divisor).toDecimalPlaces(TAX_MONEY_SCALE, ROUNDING);
  const unitTaxAmount = incl.minus(unitPriceExclTaxAmount).toDecimalPlaces(TAX_MONEY_SCALE, ROUNDING);

  return {
    taxRatePercent: rate.toFixed(TAX_RATE_SCALE),
    unitPriceExclTaxAmount: unitPriceExclTaxAmount.toFixed(TAX_MONEY_SCALE),
    unitTaxAmount: unitTaxAmount.toFixed(TAX_MONEY_SCALE),
    taxCalculationRuleCode: input.ruleCode,
    taxCalculationRuleVersion: input.ruleVersion,
  };
}
