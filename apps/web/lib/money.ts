import { isMoneyString } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";

/**
 * Money formatting for display.
 *
 * The input is a fixed-scale DECIMAL STRING, which is what the API
 * sends for EVERY amount, on every surface. It is parsed once, here,
 * at the very edge of rendering — never earlier, and never into a
 * value anything else does arithmetic on.
 *
 * There is deliberately no second entry point that accepts a number.
 * One existed while `/trader/opportunities/*` still serialised its
 * unit price through `Decimal.toNumber()`; that endpoint now sends a
 * decimal string like every other, and the number path was removed
 * rather than left available. A tolerated shape is a shape that comes
 * back.
 *
 * This module deliberately offers NO add, multiply or sum. Every total
 * in this product is server-authoritative: the checkout quote is
 * frozen in `quote_snapshots` and the payment provider charges that
 * figure. A client that recomputes a total will eventually disagree
 * with what was actually taken, and the version a person believes is
 * the one on their screen.
 */

/**
 * Latin digits in both locales, stated explicitly.
 *
 * `Intl` defaults ar-SA to Arabic-Indic numerals. That is correct for
 * prose, but `lib/localized.ts` already pins dates to `latn` so a
 * contractual closing date cannot appear in two numbering systems
 * across one product — and an amount is exactly the same problem. A
 * price in ٩٩٥٫٥٠ beside a date in 2026 is the inconsistency that
 * decision exists to prevent, so money follows it.
 */
const NUMBERING_SYSTEM = "latn";

/**
 * Formats a decimal-string amount with its currency.
 *
 * Returns null rather than throwing or guessing when the amount is not
 * a number the API should have sent. A malformed price must render as
 * nothing with a reason, never as "NaN SAR" and never as "0.00" — a
 * zero is a claim about what something costs.
 */
export function formatMoney(
  amount: string,
  currency: string,
  locale: AppLocale
): string | null {
  // The SHARED guard from the contracts package, not a second regex
  // that happens to look similar. A local copy is how the client comes
  // to accept a shape the API never sends, or reject one it does.
  //
  // It is a runtime check, not just a type: this value crossed a JSON
  // boundary, where the declared type is a claim rather than a
  // guarantee. `/^-?\d+(\.\d+)?$/.test(125.5)` passes, because
  // RegExp.test coerces its argument — so a number that slipped through
  // would format cleanly and look completely fine.
  if (!isMoneyString(amount)) return null;

  const value = Number(amount);
  if (!Number.isFinite(value)) return null;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    numberingSystem: NUMBERING_SYSTEM,
  }).format(value);
}

/**
 * A whole-number quantity with its selling unit, e.g. "12 cartons".
 *
 * Grouped per locale, because a five-digit quantity without separators
 * is genuinely hard to read at a glance.
 */
export function formatQuantity(quantity: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale, { numberingSystem: NUMBERING_SYSTEM }).format(quantity);
}

/**
 * A percentage for display, at most one decimal place.
 *
 * `progressPercentage` arrives as a raw float (e.g. 33.33333…), and
 * printing it unrounded is noise. `sharePercentage` is already derived
 * from basis points and is usually whole; both go through here so the
 * two never render in different styles beside each other.
 */
export function formatPercentage(value: number, locale: AppLocale): string | null {
  if (!Number.isFinite(value)) return null;

  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    numberingSystem: NUMBERING_SYSTEM,
  }).format(value / 100);
}
