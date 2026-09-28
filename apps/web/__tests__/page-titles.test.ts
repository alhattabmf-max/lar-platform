import { describe, expect, it, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const ar = JSON.parse(read("messages/ar-SA.json")) as Record<string, unknown>;
const en = JSON.parse(read("messages/en-SA.json")) as Record<string, unknown>;
const at = (o: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o);

const pages = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + "/" + e.name;
    if (e.isDirectory()) pages(rel, out);
    else if (e.name === "page.tsx") out.push(rel);
  }
  return out;
};

/**
 * WHAT A BROWSER TAB SAYS.
 *
 * Measured before this: 54 of the 85 pages rendered no `<title>` at all
 * — every public page, every sign-in page, and the whole of the buyer's
 * and supplier's portals. Only the console's 32 had one. A tab showed
 * the URL and a bookmark had no name.
 *
 * (My Phase 1 report said 53. It was 54 — `verify-email` was miscounted.)
 */
describe("every page names itself, and then the platform", () => {
  const ALL = pages("app");

  it("leaves no page without a title", () => {
    const untitled = ALL.filter(
      (p) => !/generateMetadata|export const metadata/.test(read(p)),
    );
    expect(untitled).toEqual([]);
  });

  it("names the platform from the identity settings, never from a constant", () => {
    // «لا تكتب Azier Plus ثابتًا داخل عناوين الصفحات… يُجلب من الاسم
    //  التجاري العربي والإنجليزي الموجودين فعلًا في إعدادات الهوية.»
    const helper = read("lib/page-metadata.ts");
    expect(helper).toContain("brandName(branding, locale)");
    expect(helper).toContain("getBranding");
    expect(helper).not.toContain("Azier");
    expect(helper).not.toContain("أزير");

    // AND NO PAGE WRITES A BRAND NAME EITHER.
    for (const p of ALL) {
      const src = read(p);
      expect([p, src.includes("Azier") || src.includes("أزير")]).toEqual([p, false]);
    }
  });

  it("picks the Arabic name for Arabic and the English for English", () => {
    // `brandName` is the chrome's own picker — the mark in the header
    // and the words in the tab cannot disagree about the platform's name.
    const branding = read("lib/branding.ts");
    expect(branding).toContain('locale.startsWith("ar") ? branding.nameAr : branding.nameEn');
  });

  it("reads branding once per request, and from a window short enough to notice a rename", () => {
    // «لا تجعل جلب الاسم لكل صفحة يسبب عشرات الطلبات المتكررة» —
    // `getBranding` is wrapped in React's `cache`, so `generateMetadata`
    // and the page body share one fetch.
    const branding = read("lib/branding.ts");
    expect(branding).toContain("export const getBranding = cache(");
    // «تظهر بعد حفظه دون الحاجة إلى إعادة بناء المنصة» — still true,
    // and still measured live. THIS USED TO REQUIRE `no-store`, which
    // bought that immediacy at the price of an uncached round trip on
    // every page load of the platform.
    //
    // A window of a minute keeps the promise that mattered — a rename
    // shows WITHOUT A REBUILD AND WITHOUT A RESTART — and bounds the
    // delay to something an operator waits out rather than reports as
    // broken. What is asserted is that the window exists and is short;
    // a value creeping up to an hour would fail here.
    expect(branding).toContain("const BRANDING_TTL = 60;");
    expect(branding).toContain("revalidate: BRANDING_TTL");
    expect(branding).not.toContain('cache: "no-store"');
  });

  it("falls back to a translated name, never to undefined or a key", () => {
    const helper = read("lib/page-metadata.ts");
    expect(helper).toContain('shell("platformNameFallback")');
    for (const [label, messages] of [["ar-SA", ar], ["en-SA", en]] as const) {
      const fallback = at(messages, "shell.platformNameFallback");
      expect([label, typeof fallback]).toEqual([label, "string"]);
      expect([label, String(fallback).length > 0]).toEqual([label, true]);
    }
  });

  it("names every page with words that exist in BOTH locales", () => {
    // A title nobody translated would print its own key. Every page's
    // key is checked against both message files.
    const missing: string[] = [];
    for (const p of ALL) {
      const m = read(p).match(/pageTitle\(\s*"([^"]+)"\s*(?:,\s*"([^"]+)"\s*)?\)/);
      if (!m) continue; // the console's pages build their own metadata
      const path = m[1] + "." + (m[2] ?? "title");
      for (const [label, messages] of [["ar", ar], ["en", en]] as const) {
        if (typeof at(messages, path) !== "string") missing.push(`${p} :: ${path} (${label})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("puts the page's own name first and the platform's second", () => {
    const helper = read("lib/page-metadata.ts");
    expect(helper).toContain("`${t(key)} | ${name}`");
  });
});

describe("the title helper, run", () => {
  beforeEach(() => vi.resetModules());

  const load = async (nameAr: string | null, nameEn: string | null) => {
    vi.doMock("@/lib/branding", () => ({
      getBranding: async () => ({ nameAr, nameEn }),
      brandName: (b: { nameAr: string | null; nameEn: string | null }, locale: string) =>
        locale.startsWith("ar") ? b.nameAr : b.nameEn,
    }));
    vi.doMock("next-intl/server", () => ({
      getTranslations: async ({ namespace }: { namespace: string }) => {
        const dict: Record<string, Record<string, string>> = {
          shell: { platformNameFallback: "أزير بلس" },
          "auth.login": { title: "تسجيل الدخول" },
        };
        return (key: string) => dict[namespace]?.[key] ?? `${namespace}.${key}`;
      },
    }));
    return import("@/lib/page-metadata");
  };

  const params = Promise.resolve({ locale: "ar-SA" });

  it("changing the identity name changes the title", async () => {
    // The same page, twice, with only the stored brand name different.
    const first = await load("ازير بلس", "azir plas");
    const before = await first.pageTitle("auth.login")({ params });
    expect(before.title).toBe("تسجيل الدخول | ازير بلس");

    vi.resetModules();
    const second = await load("اسم جديد", "New Name");
    const after = await second.pageTitle("auth.login")({ params });
    expect(after.title).toBe("تسجيل الدخول | اسم جديد");
  });

  it("shows the English name on an English page", async () => {
    const mod = await load("ازير بلس", "azir plas");
    const meta = await mod.pageTitle("auth.login")({
      params: Promise.resolve({ locale: "en-SA" }),
    });
    expect(meta.title).toBe("تسجيل الدخول | azir plas");
  });

  it("shows no undefined and no message key when the name is missing", async () => {
    const mod = await load(null, null);
    const meta = await mod.pageTitle("auth.login")({ params });
    expect(meta.title).toBe("تسجيل الدخول | أزير بلس");
    expect(String(meta.title)).not.toContain("undefined");
    expect(String(meta.title)).not.toContain("platformNameFallback");
  });
});
