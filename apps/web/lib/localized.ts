import { routing, type AppLocale } from "@/i18n/routing";

/**
 * True only for a locale this app actually ships.
 *
 * Both formatters below take `AppLocale`, but that is a COMPILE-TIME
 * claim and every page makes it with an unchecked `locale as AppLocale`
 * on a value that came out of the URL. One request shape defeats the
 * check that is supposed to make the cast safe:
 *
 *     GET /ar-SA.x/opportunities/<id>
 *
 * `middleware.ts` matches `/((?!api|_next|.*\..*).*)`, so ANY path
 * segment containing a dot skips next-intl entirely and is never
 * validated. The route still matches `[locale]`, the page still renders,
 * and `Intl.DateTimeFormat("ar-SA.x")` throws
 * `RangeError: Incorrect locale information provided`. The layout's
 * `notFound()` produces the 404 the visitor sees, so the failure is
 * invisible to them and fills the server log instead — which is exactly
 * how it went unnoticed.
 *
 * Guarding against the app's OWN locale list rather than asking `Intl`
 * what it will accept: `Intl` tolerates plenty of well-formed tags this
 * product does not ship (`fr`, `und`, `xx`), and formatting a date in
 * one of those would be a different bug wearing the same disguise.
 */
export function isAppLocale(locale: string): locale is AppLocale {
  return (routing.locales as readonly string[]).includes(locale);
}

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
  // Same contract as the unparseable date below: refuse, return null,
  // let the caller omit the row. Throwing here takes down a whole
  // server-rendered page for a value that never came from this app.
  if (!isAppLocale(locale)) return null;

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
  if (!isAppLocale(locale)) return null;

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
