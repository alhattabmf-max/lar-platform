import type { AppLocale } from "@/i18n/routing";

/**
 * Picks the Arabic or English side of a bilingual pair.
 *
 * Every catalogue record on this platform stores both languages, so
 * this is a selection, not a translation — and it is written once here
 * rather than as a `locale === "ar-SA" ? x.nameAr : x.nameEn` ternary
 * scattered across screens, where adding a third locale would mean
 * finding every one of them.
 */
export function localized(locale: AppLocale, ar: string, en: string): string;
export function localized(
  locale: AppLocale,
  ar: string | null,
  en: string | null
): string | null;
export function localized(
  locale: AppLocale,
  ar: string | null,
  en: string | null
): string | null {
  return locale === "ar-SA" ? ar : en;
}

/**
 * The business time zone.
 *
 * Pinned rather than left to the runtime: an opportunity's closing time
 * is a commercial deadline, and rendering it in the Node process's
 * local zone on the server and the visitor's zone in the browser would
 * both disagree with each other (a hydration mismatch) and disagree
 * with the deadline the platform actually enforces.
 */
export const BUSINESS_TIME_ZONE = "Asia/Riyadh";

/**
 * Formats an ISO timestamp as a date.
 *
 * `calendar: "gregory"` and `numberingSystem: "latn"` are explicit
 * because `Intl` defaults the ar-SA locale to the Umm al-Qura calendar
 * and Arabic-Indic digits. Both are perfectly correct for prose, but a
 * contractual closing date shown in Hijri next to a Gregorian one
 * elsewhere in the product is a real source of error, so the calendar
 * is fixed to match the stored value.
 *
 * Returns null for an unparseable value rather than "Invalid Date" —
 * the caller then omits the row instead of rendering nonsense.
 */
export function formatDate(iso: string, locale: AppLocale): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(date);
}

/** As `formatDate`, with the time of day — used where the exact cut-off matters. */
export function formatDateTime(iso: string, locale: AppLocale): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(date);
}

/**
 * Whole days from `now` until `iso`, or null if the moment has passed.
 *
 * Deliberately coarse. A precise countdown would need a ticking client
 * clock and would disagree between server render and hydration; "closes
 * in N days" is stable, and the exact timestamp is shown alongside it
 * for anyone who needs the real cut-off.
 */
export function daysUntil(iso: string, now: Date = new Date()): number | null {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;

  const millis = target.getTime() - now.getTime();
  if (millis <= 0) return null;

  return Math.ceil(millis / 86_400_000);
}
