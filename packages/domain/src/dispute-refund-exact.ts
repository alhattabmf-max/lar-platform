import { Decimal } from "decimal.js";

/**
 * Dispute refund arithmetic, exact by construction.
 *
 * The float version in `dispute-settlement.ts` takes `number` and
 * rounds with `Math.round(n * 100) / 100`. Every value on this path is
 * a `Decimal(14,2)` or `Decimal(12,2)` column reconciled against a bank
 * statement, and IEEE-754 binary double cannot represent `125.50`
 * exactly — so the figure that left the database and the figure the
 * arithmetic saw were different numbers that merely printed the same.
 *
 * This module takes decimal STRINGS and returns decimal strings. There
 * is no `Number`, no `parseFloat` and no `toNumber` anywhere in it, and
 * a test asserts that by reading the source.
 *
 * WHY THE ENTRY BALANCES BY CONSTRUCTION, not by luck:
 *
 *   debits  = supplierPayableDebit + commissionReversal
 *           + commissionTaxReversal + shippingRefund
 *
 * and `supplierPayableDebit` is DERIVED as
 * `productRefund − commissionReversal − commissionTaxReversal`, so the
 * two reversals cancel:
 *
 *   debits  = productRefund + shippingRefund = totalRefund = credit
 *
 * Both reversals are rounded to two places BEFORE the subtraction, so
 * the derived figure absorbs whatever those roundings did. The identity
 * holds for every input, not merely for the ones anybody tried.
 *
 * `snapshotSupplierPayableShareAmount` is deliberately NOT an input.
 * The float version declared it and never read it. It is frozen against
 * `MasterOrder.supplierPayableAmount`, which already includes shipping
 * under the 7C formula, and shipping is posted separately to
 * SHIPPING_LIABILITY — using it here would double-count shipping.
 */

/**
 * The rounding this system has always applied.
 *
 * `Math.round(n * 100) / 100` rounds a positive half away from zero, so
 * `ROUND_HALF_UP` is the mode that reproduces it. Every amount on this
 * path is non-negative — the validator rejects a leading minus — so the
 * two are equivalent here, and stating the mode explicitly means a
 * later reader does not have to infer it from a multiplication.
 */
const ROUNDING = Decimal.ROUND_HALF_UP;

/** The scale of every money column in this system. */
const SCALE = 2;

/**
 * A decimal string with exactly two places, as the wire and the
 * database both hold it.
 */
export type ExactMoney = string;

/**
 * Exactly two decimal places, non-negative, no exponent.
 *
 * Deliberately the same shape the API's `@IsDecimalString()` accepts,
 * so a value that passed validation cannot fail here and a value that
 * reaches here without validation still cannot slip through.
 */
const EXACT_MONEY = /^[0-9]+\.[0-9]{2}$/;

export function isExactMoney(value: unknown): value is ExactMoney {
  return typeof value === "string" && EXACT_MONEY.test(value);
}

/**
 * Parses one input, refusing anything that is not already canonical.
 *
 * Throws rather than coercing. `new Decimal("1e3")` succeeds and
 * `new Decimal("NaN")` produces a NaN Decimal that then poisons every
 * subsequent operation silently — so the guard is here, before a value
 * can enter the arithmetic at all.
 */
function parse(value: string, field: string): Decimal {
  if (!isExactMoney(value)) {
    throw new RangeError(
      `${field} must be a canonical two-place decimal string, received ${JSON.stringify(value)}`
    );
  }
  return new Decimal(value);
}

/** Renders a result at the fixed scale. Never `toNumber`. */
function render(value: Decimal): ExactMoney {
  return value.toFixed(SCALE, ROUNDING);
}

export interface DisputeRefundReversalInput {
  /** What the decision refunds of the product, tax included. */
  productRefundAmountInclTax: ExactMoney;
  /** What the decision refunds of the shipping fee. */
  shippingRefundAmount: ExactMoney;
  /** The allocation's frozen product amount, tax included. */
  snapshotProductAmountInclTax: ExactMoney;
  /** The allocation's frozen commission share. */
  snapshotCommissionShareAmount: ExactMoney;
  /** The allocation's frozen commission tax share. */
  snapshotCommissionShareTaxAmount: ExactMoney;
}

export interface DisputeRefundReversal {
  totalRefundAmount: ExactMoney;
  commissionReversalAmount: ExactMoney;
  commissionTaxReversalAmount: ExactMoney;
  supplierPayableDebitAmount: ExactMoney;
}

export function computeDisputeRefundReversalExact(
  input: DisputeRefundReversalInput
): DisputeRefundReversal {
  const productRefund = parse(input.productRefundAmountInclTax, "productRefundAmountInclTax");
  const shippingRefund = parse(input.shippingRefundAmount, "shippingRefundAmount");
  const snapshotProduct = parse(
    input.snapshotProductAmountInclTax,
    "snapshotProductAmountInclTax"
  );
  const snapshotCommission = parse(
    input.snapshotCommissionShareAmount,
    "snapshotCommissionShareAmount"
  );
  const snapshotCommissionTax = parse(
    input.snapshotCommissionShareTaxAmount,
    "snapshotCommissionShareTaxAmount"
  );

  // The ratio is NEVER rounded and never materialised as a fixed-scale
  // value. `productRefund / snapshotProduct` is non-terminating for most
  // inputs — 1/3 of a price is the ordinary case, not the exotic one —
  // so it stays a full-precision Decimal and the rounding happens once,
  // on the product of the multiplication. Rounding the ratio first and
  // multiplying by it would round twice and drift.
  //
  // A zero snapshot product means there is nothing to reverse a
  // commission against. It is guarded rather than divided: Decimal
  // division by zero yields Infinity, which would render as a garbage
  // amount rather than throwing.
  const zero = new Decimal(0);
  const commissionReversal = snapshotProduct.isZero()
    ? zero
    : snapshotCommission.times(productRefund).dividedBy(snapshotProduct);
  const commissionTaxReversal = snapshotProduct.isZero()
    ? zero
    : snapshotCommissionTax.times(productRefund).dividedBy(snapshotProduct);

  // Rounded to the column's scale BEFORE the derivation below, so the
  // derived supplier debit absorbs the rounding and the entry balances.
  const commissionReversalAmount = new Decimal(render(commissionReversal));
  const commissionTaxReversalAmount = new Decimal(render(commissionTaxReversal));

  const supplierPayableDebitAmount = productRefund
    .minus(commissionReversalAmount)
    .minus(commissionTaxReversalAmount);

  return {
    totalRefundAmount: render(productRefund.plus(shippingRefund)),
    commissionReversalAmount: render(commissionReversalAmount),
    commissionTaxReversalAmount: render(commissionTaxReversalAmount),
    supplierPayableDebitAmount: render(supplierPayableDebitAmount),
  };
}

/**
 * True when `amount` is at most `bound`, both canonical decimals.
 *
 * A shared comparison so no caller writes `Number(a) <= Number(b)` for
 * a bounds check — which is how a float re-enters a path that has
 * otherwise been made exact.
 */
export function isWithinExact(amount: ExactMoney, bound: ExactMoney): boolean {
  return parse(amount, "amount").lessThanOrEqualTo(parse(bound, "bound"));
}

/** Sums canonical decimals exactly, at the fixed scale. */
export function sumExact(...amounts: ExactMoney[]): ExactMoney {
  return render(
    amounts.reduce((total, amount, index) => total.plus(parse(amount, `amount[${index}]`)), new Decimal(0))
  );
}

export function isZeroExact(amount: ExactMoney): boolean {
  return parse(amount, "amount").isZero();
}

export function isPositiveExact(amount: ExactMoney): boolean {
  return parse(amount, "amount").greaterThan(0);
}
