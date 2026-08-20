import { describe, expect, it } from "vitest";
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
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key)
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
    for (const namespace of ["shell", "common", "pagination", "states", "errors"]) {
      expect(ar).toHaveProperty(namespace);
      expect(en).toHaveProperty(namespace);
    }
  });

  it("cover every error code in the shared catalogue", () => {
    const arCodes = Object.keys((ar.errors as { codes: Record<string, string> }).codes);
    const enCodes = Object.keys((en.errors as { codes: Record<string, string> }).codes);

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
      (en.shell as Record<string, string>).brandFallback
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
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          walk(child, path ? `${path}.${key}` : key);
        }
      };
      walk(messages, "");
    }
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
