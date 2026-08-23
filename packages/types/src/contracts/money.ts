/**
 * The one representation of money on the wire.
 *
 * Every monetary amount in every contract is a fixed-scale DECIMAL
 * STRING — `"0.00"`, `"125.50"`, `"-75.25"` — and never a JSON number.
 *
 * The reason is not style. These figures come from PostgreSQL
 * `Decimal(12,2)` and `Decimal(14,2)` columns and are reconciled
 * against bank statements. JSON has one numeric type, IEEE-754 binary
 * double, in which 125.50 is not representable exactly. Serialising
 * through it means the value that left the database and the value the
 * client received are different numbers that merely print the same,
 * and every downstream sum inherits the drift. A string crosses the
 * wire as the digits the database actually stored.
 *
 * Three rules follow, and each is enforced by a test rather than
 * trusted to care:
 *
 *  1. No `Decimal.toNumber()` or `Number(...)` in a serializer that
 *     produces one of these fields. `Decimal.toFixed(SCALE)` only.
 *  2. No arithmetic on money in any client. Every total is
 *     server-authoritative; a recomputed one is a second source of
 *     truth that will eventually disagree with what was charged.
 *  3. No cosmetic formatting in the API. No thousands separators, no
 *     currency symbol, no locale digits — those are presentation, and
 *     baking them in makes the value unparseable. The canonical form
 *     is what `toFixed` produces and nothing else.
 */

/** The scale of every money column in this system. */
export const MONEY_SCALE = 2;

/**
 * The canonical form: optional minus, at least one integer digit, a
 * dot, exactly `MONEY_SCALE` fraction digits.
 *
 * Anchored at both ends, so `"12.50 SAR"`, `"1,250.00"` and `"1.2e3"`
 * are all rejected rather than partially matched. `"12.5"` is rejected
 * too: a trailing zero carries information about scale, and dropping
 * it is the first step toward a value that gets re-parsed as a float.
 */
export const MONEY_STRING_PATTERN = /^-?\d+\.\d{2}$/;

/**
 * A money amount as it appears on the wire.
 *
 * A documentation alias rather than a branded type: these values are
 * produced by the API and consumed as data, so a brand would force
 * every JSON boundary to cast, which teaches people to cast. The
 * runtime guard below is what actually holds the line.
 */
export type MoneyString = string;

/** True when `value` is exactly a canonical money string. */
export function isMoneyString(value: unknown): value is MoneyString {
  return typeof value === "string" && MONEY_STRING_PATTERN.test(value);
}

/**
 * A pattern for a decimal string at an arbitrary scale.
 *
 * Money is always `MONEY_SCALE`, but a few non-money decimals cross the
 * wire at their own precision — a tax rate at `Decimal(5,2)`, a package
 * content quantity at `Decimal(10,3)`. This exists so those can be
 * validated at their REAL precision instead of being waved through or,
 * worse, checked against the money scale and quietly rejected.
 */
export function decimalStringPattern(scale: number): RegExp {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`decimalStringPattern: scale must be a non-negative integer, got ${scale}`);
  }
  return scale === 0 ? /^-?\d+$/ : new RegExp(`^-?\\d+\\.\\d{${scale}}$`);
}

/** True when `value` is a canonical decimal string at `scale`. */
export function isDecimalString(value: unknown, scale: number): value is string {
  return typeof value === "string" && decimalStringPattern(scale).test(value);
}

/**
 * Asserts a value is canonical money, naming the field when it is not.
 *
 * For use at a serializer boundary in a test or an assertion — the
 * failure names the field, so a broken mapper is identified rather
 * than merely detected.
 */
export function assertMoneyString(value: unknown, field: string): asserts value is MoneyString {
  if (!isMoneyString(value)) {
    throw new TypeError(
      `${field} must be a fixed-scale decimal string with ${MONEY_SCALE} fraction digits, got ${JSON.stringify(value)}`
    );
  }
}

/**
 * The largest value each money column in this system can hold.
 *
 * PostgreSQL `numeric(p,s)` allows `p - s` digits before the point, so
 * `Decimal(14,2)` tops out at twelve integer digits and `Decimal(12,2)`
 * at ten. Exceeding it is not a rounding problem — it is
 * `numeric field overflow`, a 500 raised by the driver after the
 * request has already been accepted.
 *
 * Declared here so the API can refuse an over-large amount with a 400
 * that names the field, and so a test can assert the boundary against
 * the same literal the validator uses.
 *
 * The dispute refund columns — `DisputeDecision.productRefundAmountInclTax`,
 * `.shippingRefundAmount` and `RefundObligation.amount` — are
 * `Decimal(14,2)`. The allocation snapshot's `shippingFeeAmount` is
 * `Decimal(12,2)`, and it is the tighter of the two bounds a shipping
 * refund actually has to satisfy.
 */
export const DECIMAL_14_2_MAX = "999999999999.99";
export const DECIMAL_12_2_MAX = "9999999999.99";

/** Integer digits each precision allows, for a bound check without parsing. */
export const DECIMAL_14_2_INTEGER_DIGITS = 12;
export const DECIMAL_12_2_INTEGER_DIGITS = 10;

/**
 * True when a canonical money string fits a column with
 * `integerDigits` digits before the point.
 *
 * Works on the STRING, deliberately. Parsing to compare would put a
 * float back on a path whose whole purpose is to keep one out, and the
 * digit count is the exact question `numeric(p,s)` asks.
 *
 * Leading zeros are counted as written: `"0000000000001.00"` has
 * thirteen integer characters but is one riyal. It is rejected anyway,
 * because a canonical amount does not carry them and accepting one
 * would mean this function disagrees with `MONEY_STRING_PATTERN` about
 * what canonical means.
 */
export function fitsDecimalPrecision(value: string, integerDigits: number): boolean {
  if (!isMoneyString(value)) return false;
  const digits = value.replace("-", "").split(".")[0];
  return digits.length <= integerDigits;
}
