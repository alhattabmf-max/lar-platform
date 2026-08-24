import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, isAppLocale } from "@/lib/localized";
import { formatMoney, formatQuantity } from "@/lib/money";
import { routing, type AppLocale } from "@/i18n/routing";

/**
 * A locale that never came from this app must not crash a page.
 *
 * The bug
 * -------
 * `RangeError: Incorrect locale information provided`, thrown from
 * `new Intl.DateTimeFormat(...)` while server-rendering
 * `/[locale]/opportunities/[id]`.
 *
 * `middleware.ts` matches `/((?!api|_next|.*\..*).*)`. Any path segment
 * containing a DOT is therefore excluded from next-intl's middleware and
 * is never validated — but it still matches the `[locale]` dynamic
 * segment, so the page renders with it. Every page then does an
 * unchecked `locale as AppLocale`, and `Intl` refuses the tag:
 *
 *     GET /ar-SA.x/opportunities/<id>     -> RangeError, every time
 *     GET /foo.bar/opportunities/<id>     -> RangeError, every time
 *     GET /sitemap.xml/opportunities/<id> -> RangeError, every time
 *
 * The visitor sees a 404 because the layout's `notFound()` still wins
 * the response, which is precisely why this was invisible from the
 * outside and only ever showed up in the server log.
 *
 * The fix is at the two formatting choke points rather than in the 20+
 * pages that make the cast, and it follows the contract those functions
 * already had for a bad date: refuse and return null, so the caller
 * omits the row.
 */

/** Exactly the shapes that reach a page through the middleware bypass. */
const BYPASSING_LOCALES = ["ar-SA.x", "foo.bar", "sitemap.xml", "robots.txt", "a.b.c"];

/** Well-formed tags that this product simply does not ship. */
const NOT_OUR_LOCALES = ["fr", "en-US", "und", "xx", "ar"];

const ISO = "2026-09-06T18:57:00.000Z";

describe("locale hardening", () => {
  describe("the premise: these inputs really do make Intl throw", () => {
    it.each(BYPASSING_LOCALES)("Intl refuses %s", (locale) => {
      // If a future Node/ICU stopped throwing, the guards below would
      // still be correct but this file would be testing nothing — so the
      // premise is asserted rather than assumed.
      expect(() => new Intl.DateTimeFormat(locale, { year: "numeric" })).toThrow(RangeError);
      expect(() => new Intl.NumberFormat(locale, { numberingSystem: "latn" })).toThrow(RangeError);
    });
  });

  describe("isAppLocale", () => {
    it.each([...routing.locales])("accepts the shipped locale %s", (locale) => {
      expect(isAppLocale(locale)).toBe(true);
    });

    it.each([...BYPASSING_LOCALES, ...NOT_OUR_LOCALES, ""])("rejects %s", (locale) => {
      expect(isAppLocale(locale)).toBe(false);
    });
  });

  describe("formatDate / formatDateTime", () => {
    it.each(BYPASSING_LOCALES)("returns null instead of throwing for %s", (locale) => {
      expect(() => formatDate(ISO, locale as AppLocale)).not.toThrow();
      expect(formatDate(ISO, locale as AppLocale)).toBeNull();
      expect(() => formatDateTime(ISO, locale as AppLocale)).not.toThrow();
      expect(formatDateTime(ISO, locale as AppLocale)).toBeNull();
    });

    it.each([...routing.locales])("still formats normally for %s", (locale) => {
      expect(formatDate(ISO, locale)).toBeTruthy();
      expect(formatDateTime(ISO, locale)).toBeTruthy();
    });

    it("keeps refusing an unparseable date, the guard it already had", () => {
      expect(formatDate("not-a-date", "ar-SA")).toBeNull();
      expect(formatDateTime("not-a-date", "ar-SA")).toBeNull();
    });
  });

  describe("formatMoney", () => {
    it.each(BYPASSING_LOCALES)("returns null instead of throwing for %s", (locale) => {
      expect(() => formatMoney("2925.00", "SAR", locale as AppLocale)).not.toThrow();
      expect(formatMoney("2925.00", "SAR", locale as AppLocale)).toBeNull();
    });

    it.each([...routing.locales])("still formats normally for %s", (locale) => {
      expect(formatMoney("2925.00", "SAR", locale)).toBeTruthy();
    });

    it("keeps refusing a non-money string, the guard it already had", () => {
      expect(formatMoney("2925", "SAR", "ar-SA")).toBeNull();
    });
  });

  describe("formatQuantity", () => {
    it.each(BYPASSING_LOCALES)("falls back rather than throwing for %s", (locale) => {
      // Declared non-nullable and rendered inline, so it degrades to the
      // default locale instead of returning null.
      expect(() => formatQuantity(12345, locale as AppLocale)).not.toThrow();
      expect(formatQuantity(12345, locale as AppLocale)).toBe(
        formatQuantity(12345, routing.defaultLocale)
      );
    });

    it.each([...routing.locales])("is unchanged for the shipped locale %s", (locale) => {
      expect(formatQuantity(12345, locale)).toBe(
        new Intl.NumberFormat(locale, { numberingSystem: "latn" }).format(12345)
      );
    });
  });
});
