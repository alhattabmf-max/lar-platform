import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_CODES } from "@platform/types";
import { routing } from "@/i18n/routing";

const MESSAGES_DIR = join(__dirname, "..", "messages");

function load(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8"));
}

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

const ar = load("ar-SA");
const en = load("en-SA");

describe("locale configuration", () => {
  it("keeps ar-SA as the default and ships en-SA alongside it", () => {
    expect(routing.defaultLocale).toBe("ar-SA");
    expect([...routing.locales].sort()).toEqual(["ar-SA", "en-SA"]);
  });
});

describe("message catalogues", () => {
  it("have identical key sets in both locales", () => {
    expect(flatten(ar).sort()).toEqual(flatten(en).sort());
  });

  it("cover every namespace the 8B shell needs", () => {
    for (const namespace of [
      "shell",
      "common",
      "pagination",
      "states",
      "errors",
    ]) {
      expect(ar).toHaveProperty(namespace);
      expect(en).toHaveProperty(namespace);
    }
  });

  it("cover every error code in the shared catalogue", () => {
    const arCodes = Object.keys(
      (ar.errors as { codes: Record<string, string> }).codes,
    );
    const enCodes = Object.keys(
      (en.errors as { codes: Record<string, string> }).codes,
    );

    for (const code of Object.values(ERROR_CODES)) {
      expect(arCodes).toContain(code);
      expect(enCodes).toContain(code);
    }
  });

  it("no longer uses PROJECT_NAME as a brand string", () => {
    expect(JSON.stringify(ar)).not.toContain("PROJECT_NAME");
    expect(JSON.stringify(en)).not.toContain("PROJECT_NAME");
  });

  it("provides a translated branding fallback in both locales", () => {
    expect((ar.shell as Record<string, string>).brandFallback).toBeTruthy();
    expect((en.shell as Record<string, string>).brandFallback).toBeTruthy();
    expect((ar.shell as Record<string, string>).brandFallback).not.toBe(
      (en.shell as Record<string, string>).brandFallback,
    );
  });

  it("has no empty message values", () => {
    for (const [locale, messages] of [
      ["ar-SA", ar],
      ["en-SA", en],
    ] as const) {
      const walk = (value: unknown, path: string): void => {
        if (typeof value === "string") {
          expect(value.trim(), `${locale}:${path}`).not.toBe("");
          return;
        }
        for (const [key, child] of Object.entries(
          value as Record<string, unknown>,
        )) {
          walk(child, path ? `${path}.${key}` : key);
        }
      };
      walk(messages, "");
    }
  });

  it("formats every ICU plural message in both locales", () => {
    // A malformed ICU pattern or a missing plural category throws only
    // when the message is actually formatted — which, for the
    // marketplace, means in production. Formatting them here moves that
    // failure into the test run.
    //
    // Arabic needs six categories (zero/one/two/few/many/other); English
    // needs two. Feeding the counts that select each one is the only way
    // to prove none of them is missing.
    const COUNTS = [0, 1, 2, 3, 11, 100];

    for (const locale of ["ar-SA", "en-SA"] as const) {
      const t = createTranslator({
        locale,
        messages: locale === "ar-SA" ? ar : en,
        namespace: "marketplace",
        onError: (error) => {
          throw error;
        },
      });

      for (const count of COUNTS) {
        expect(t("resultCount", { count })).toBeTruthy();
        expect(t("card.closesInDays", { days: count })).toBeTruthy();
      }
    }
  });

  it("formats every message that takes a named argument", () => {
    const cases = [
      {
        namespace: "pagination",
        key: "status",
        values: { page: 2, lastPage: 7 },
      },
      { namespace: "policies", key: "version", values: { label: "v1.0" } },
      { namespace: "auth.resetPassword", key: "tooShort", values: { min: 8 } },
      // Was register.location.accuracy, which read out how precisely
      // the browser had found a company. Registration no longer asks
      // where a company is, so the key is gone; the shell header keeps
      // this case honest with a placeholder that still exists.
      {
        namespace: "shell",
        key: "nav.openCategory",
        values: { name: "أدوات" },
      },
    ] as const;

    for (const locale of ["ar-SA", "en-SA"] as const) {
      for (const { namespace, key, values } of cases) {
        const t = createTranslator({
          locale,
          messages: locale === "ar-SA" ? ar : en,
          namespace,
          onError: (error) => {
            throw error;
          },
        });

        const formatted = t(key, values);
        expect(formatted, `${locale}:${namespace}.${key}`).toBeTruthy();
        // An unsubstituted placeholder means the catalogue and the call
        // site disagree about the argument's name.
        expect(formatted, `${locale}:${namespace}.${key}`).not.toMatch(
          /\{[a-zA-Z]+\}/,
        );
      }
    }
  });

  it("covers every namespace the Batch 8 public surfaces need", () => {
    for (const namespace of ["home", "marketplace", "policies"]) {
      expect(ar).toHaveProperty(namespace);
      expect(en).toHaveProperty(namespace);
    }
  });

  /**
   * The marketplace shows the SUPPLIER'S shipping origin, not a
   * delivery destination — a trader picks where goods go later, at
   * checkout. Calling it a delivery city on the marketplace told a
   * browsing trader the opposite of the truth, and these assertions
   * exist so it cannot drift back.
   */
  describe("shipping origin is never called a delivery city", () => {
    const marketplace = (m: Record<string, unknown>) =>
      m.marketplace as Record<string, Record<string, string>>;

    it("labels the marketplace filter as the shipping origin", () => {
      // THE REGION IS THE FILTER NOW, and it inherits the same
      // obligation: it is where the goods SHIP FROM. A bare «المنطقة»
      // would read as the trader's own region, which is the exact
      // confusion this block exists to prevent.
      expect(marketplace(ar).filters.region).toBe("منطقة الشحن");
      expect(marketplace(en).filters.region).toBe("Shipping origin region");
      // The city refines it, and says the same thing.
      expect(marketplace(ar).filters.city).toBe("مدينة الشحن");
      expect(marketplace(en).filters.city).toBe("Shipping origin city");
    });

    it("labels the card and detail city as 'ships from'", () => {
      // Rendered as `{label}: {city}` — "يُشحن من: الرياض".
      expect(marketplace(ar).card.city).toBe("يُشحن من");
      expect(marketplace(en).card.city).toBe("Ships from");
    });

    it("no longer says 'delivery city' anywhere in the marketplace", () => {
      for (const messages of [ar, en]) {
        const serialised = JSON.stringify(marketplace(messages));

        expect(serialised).not.toContain("مدينة التسليم");
        expect(serialised).not.toContain("Fulfilment city");
        expect(serialised).not.toContain("Delivery city");
      }
    });

    it("keeps the company's OWN address wording untouched", () => {
      // The company's own city is a genuine address, not a supplier
      // origin, and must not pick up the origin wording.
      //
      // IT MOVED, WITH THE FIELD. Registration no longer asks where a
      // company is — the first branch is collected afterwards, from
      // "complete your profile" — so the key that has to hold this
      // line is that step's, not the registration form's.
      expect((ar.completeProfile as Record<string, string>).city).toBe(
        "المدينة",
      );
      expect((en.completeProfile as Record<string, string>).city).toBe("City");
      expect((ar.register as Record<string, unknown>).city).toBeUndefined();
    });

    it("distinguishes shipping origin from delivery in English", () => {
      const filter = marketplace(en).filters.city.toLowerCase();

      expect(filter).toContain("shipping origin");
      expect(filter).not.toContain("delivery");
      expect(filter).not.toContain("fulfilment");
    });

    it("describes the landing page by shipping ORIGIN too, now as a region", () => {
      // The card shows the REGION rather than the city — a city is too
      // fine a grain to judge an offer by. What matters here is
      // unchanged: it is where goods ship FROM, never where they go.
      const arDescription = (ar.home as Record<string, string>).description;
      const enDescription = (en.home as Record<string, string>).description;

      expect(arDescription).toContain("منطقة الشحن");
      expect(enDescription.toLowerCase()).toContain("shipping region");

      expect(arDescription).not.toContain("التوصيل");
      expect(enDescription.toLowerCase()).not.toContain("delivery");
    });
  });

  it("makes no affirmative tax-invoice or ZATCA claim", () => {
    // The mandatory NOT_A_TAX_INVOICE warning is not built yet (it
    // arrives with documents in 8D), but the prohibition on affirmative
    // claims applies from the first message file onward.
    const FORBIDDEN_CLAIMS = [
      /فاتورة ضريبية (معتمدة|مصدقة|رسمية|صحيحة)/,
      /ZATCA/i,
      /زاتكا/,
      /هيئة الزكاة/,
      /tax invoice (certified|approved|compliant|valid)/i,
      /e-?invoic(e|ing) compliant/i,
      /\bClearance\b/i,
    ];

    for (const messages of [ar, en]) {
      const serialised = JSON.stringify(messages);
      for (const pattern of FORBIDDEN_CLAIMS) {
        expect(pattern.test(serialised)).toBe(false);
      }
    }
  });
});
