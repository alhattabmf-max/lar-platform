import { isMoneyString } from "@platform/types";
import { routing, type AppLocale } from "@/i18n/routing";
import { isAppLocale } from "./localized";

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

  // `AppLocale` is a compile-time claim, and every page makes it with an
  // unchecked cast on a URL segment. A path segment containing a dot
  // skips the i18n middleware entirely (see `isAppLocale`), so this can
  // receive something `Intl` refuses — and an uncaught RangeError here
  // takes down a server-rendered page.
  if (!isAppLocale(locale)) return null;

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
  // Falls back rather than returning null, because this one is declared
  // non-nullable and every caller renders it inline. The only way to
  // reach it with a locale this app does not ship is the dotted-segment
  // middleware bypass described in `isAppLocale` — a request that ends
  // in a 404 regardless, so grouping the digits by the default locale
  // is a strictly better outcome than throwing the page away.
  const safe = isAppLocale(locale) ? locale : routing.defaultLocale;
  return new Intl.NumberFormat(safe, { numberingSystem: NUMBERING_SYSTEM }).format(quantity);
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

/**
 * An amount split into its number and its currency.
 *
 * WHY THIS EXISTS. The Saudi riyal's official symbol has no Unicode
 * code point, so it cannot be a character inside a formatted string —
 * it has to be drawn. Rendering it therefore means knowing where the
 * currency sits in this locale's pattern, which is what `Intl` already
 * decides: before the number in `en-SA`, after it in `ar-SA`.
 *
 * `formatToParts`, NOT A SPLIT ON THE STRING. The currency text, the
 * separators and the bidi marks all vary by locale; asking `Intl` which
 * piece is which is the only way that does not eventually cut an amount
 * in the wrong place.
 *
 * THE BIDI MARKS ARE DROPPED ON PURPOSE. They exist to hold a currency
 * and a number together in one text run, and the two are separate
 * elements here — the component isolates the pair itself, which is the
 * same job done where it can actually be seen.
 *
 * WHERE the currency sits is NOT returned. `Intl` would say "before"
 * in English and "after" in Arabic; the owner settled on one side for
 * the whole platform, so the answer is the component's, not this
 * function's, and a field nothing reads would only invite disagreement.
 *
 * `formatMoney` above is UNCHANGED and stays: an accessible name, a
 * document title and a plain-text export all need the whole amount as
 * one string, and none of them can hold a drawing.
 */
export interface MoneyParts {
  /** The number alone — grouped, two decimals, Latin digits. */
  number: string;
  /** The currency exactly as this locale writes it: «ر.س.» or "SAR". */
  currency: string;
}

export function formatMoneyParts(
  amount: string,
  currency: string,
  locale: AppLocale
): MoneyParts | null {
  // The same three guards `formatMoney` applies, in the same order and
  // for the same reasons — a second entry point that trusts its input
  // is how a malformed amount reaches a screen as "NaN".
  if (!isMoneyString(amount)) return null;
  if (!isAppLocale(locale)) return null;

  const value = Number(amount);
  if (!Number.isFinite(value)) return null;

  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    numberingSystem: NUMBERING_SYSTEM,
  }).formatToParts(value);

  const currencyAt = parts.findIndex((part) => part.type === "currency");
  if (currencyAt === -1) return null;

  const number = parts
    .filter((part) =>
      part.type === "integer" ||
      part.type === "group" ||
      part.type === "decimal" ||
      part.type === "fraction" ||
      part.type === "minusSign"
    )
    .map((part) => part.value)
    .join("");

  return { number, currency: parts[currencyAt]!.value };
}
