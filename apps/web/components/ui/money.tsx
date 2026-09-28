import type { ReactNode } from "react";
import { formatMoney, formatMoneyParts } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/i18n/routing";
import { Riyal, type RiyalTone } from "./riyal";

/**
 * AN AMOUNT, WITH THE OFFICIAL RIYAL SYMBOL WHERE THE CODE WAS.
 *
 * ONE COMPONENT FOR EVERY AMOUNT ON THE PLATFORM, which is the whole
 * point of it: the symbol's size, its colour and where it sits
 * relative to the digits are decided once here, so a dashboard figure,
 * a table cell and a checkout total cannot drift into three different
 * treatments of the same mark.
 *
 * DISPLAY ONLY. Nothing here parses, adds or rounds. The amount is the
 * decimal string the server sent, `SAR` is still the code on the wire
 * and in every payload, and `formatMoney` — which returns the whole
 * amount as text — is untouched and still used wherever a string is
 * what is needed.
 *
 * THE SYMBOL IS ALWAYS ON THE LEFT, in Arabic and in English. `Intl`
 * puts the currency before the number in one and after it in the
 * other; the owner chose one side for the whole platform, and this is
 * where that is decided — once, for every amount on every screen.
 *
 * `dir="ltr"` ON THE PAIR. An amount is an LTR run in both languages —
 * the digits already are — and isolating it stops the bidi algorithm
 * from reordering a number, its symbol and whatever text happens to
 * sit beside them. It is what the marks `Intl` embeds in the string
 * were doing, done where it can be seen.
 *
 * A SCREEN READER HEARS WORDS. The drawing is `aria-hidden`; the
 * currency is announced from the same text `Intl` would have printed,
 * so nothing a reader hears has changed.
 *
 * A CURRENCY THAT IS NOT THE RIYAL RENDERS AS TEXT. The platform is
 * Saudi riyals everywhere today, and a second currency arriving later
 * must print its own code rather than borrow this symbol.
 */

/** The code the platform prices in. Everything else falls back to text. */
const SAR = "SAR";

export interface MoneyProps {
  /** The decimal string the API sent. Never a number. */
  amount: string;
  currency: string;
  locale: AppLocale;
  /**
   * What to render when the amount is not a number the API should have
   * sent. A malformed price must never appear as "NaN" or as "0.00" —
   * a zero is a claim about what something costs.
   */
  fallback?: ReactNode;
  /** Height of the symbol, as a multiple of the current font size. */
  em?: number;
  /** The symbol's colour: the identity teal, or the text around it. */
  tone?: RiyalTone;
  className?: string;
}

export function Money({
  amount,
  currency,
  locale,
  fallback = null,
  em,
  tone,
  className,
}: MoneyProps) {
  const parts = formatMoneyParts(amount, currency, locale);
  if (!parts) return <>{fallback}</>;

  if (currency !== SAR) {
    // Not the riyal: the whole amount as `Intl` writes it, code and all.
    return <span className={className}>{formatMoney(amount, currency, locale)}</span>;
  }

  return (
    <span
      dir="ltr"
      className={cn("whitespace-nowrap", className)}
      data-testid="money"
    >
      {/* THE SYMBOL LEADS, IN BOTH LANGUAGES — the owner's instruction,
          and it settles something `Intl` does not decide the same way
          twice: it puts the currency BEFORE the number in English and
          AFTER it in Arabic, which gave the platform two habits for one
          mark. One side everywhere is what lets an amount be recognised
          at a glance on any screen, in either language.

          A THIN SPACE, not a word space: the symbol belongs to the
          figure it introduces rather than standing beside it. */}
      <Riyal em={em} tone={tone} />
      <span className="sr-only">{parts.currency}</span>
      {" "}
      {parts.number}
    </span>
  );
}
