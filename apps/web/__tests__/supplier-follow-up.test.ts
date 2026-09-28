import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPLIER_PORTAL_MAP } from "@/components/supplier/supplier-portal-nav";
import { portalPages } from "@/components/portal/portal-nav";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const AR = JSON.parse(read("messages/ar-SA.json"));
const EN = JSON.parse(read("messages/en-SA.json"));
const PAGE = read("app/[locale]/supplier/follow-up/page.tsx");
const SECTIONS = read("components/supplier/follow-up-sections.tsx");

/**
 * «المتابعة» — three tabs became one screen.
 *
 * The owner's instruction: «حط لسان جديد باسم المتابعة واحذف تبويب لسان
 * المنازعات والاستبدالات والتسويات وصمّمها على شكل بطاقات داخل صفحة
 * اللسان الجديد… واجعل بطاقة التسويات العلوية وتكون على امتداد الصفحة
 * وبطاقتين تحته متوازية».
 */
describe("the follow-up tab", () => {
  it("is one destination where three used to be", () => {
    const keys = [SUPPLIER_PORTAL_MAP.home, ...portalPages(SUPPLIER_PORTAL_MAP)].map(
      (page) => page.key,
    );

    expect(keys).toContain("followUp");
    for (const gone of ["disputes", "replacements", "settlements", "billing"]) {
      expect([gone, keys.includes(gone)]).toEqual([gone, false]);
    }
  });

  it("names it «المتابعة», and the row carries it", () => {
    expect(AR.supplier.nav.followUp).toBe("المتابعة");
    expect(EN.supplier.nav.followUp).toBe("Follow-up");
    expect(read("components/supplier/supplier-top-nav.tsx")).toContain('"followUp"');
  });

  it("lays the three out as the owner drew them", () => {
    // The money across the whole width on top; the two that can ask
    // something of a supplier side by side beneath it.
    // FROM THE MARKUP, not the imports — those are alphabetical and
    // say nothing about what is drawn where.
    const body = strip(PAGE).slice(strip(PAGE).indexOf("return ("));

    expect(body.indexOf("<SettlementsSection")).toBeLessThan(
      body.indexOf("<DisputesSection"),
    );
    expect(body).toContain("lg:grid-cols-2");
    expect(body.indexOf("lg:grid-cols-2")).toBeGreaterThan(
      body.indexOf("<SettlementsSection"),
    );
    // The settlements card is NOT inside that two-column row.
    expect(body.slice(body.indexOf("lg:grid-cols-2"))).not.toContain(
      "<SettlementsSection",
    );
  });

  it("loads each card on its own, so a slow read holds only its card", () => {
    // Three reads behind one Suspense would hold the whole screen for
    // the slowest of them.
    expect((strip(PAGE).match(/<Suspense/g) ?? [])).toHaveLength(3);
  });

  it("moves the rows rather than rewriting them", () => {
    // The same loaders, the same fifty, the same statuses translated
    // the same way — what changed is where they are read.
    for (const loader of [
      "loadSupplierSettlements",
      "loadSupplierDisputes",
      "loadSupplierReplacements",
    ]) {
      expect([loader, SECTIONS.includes(loader)]).toEqual([loader, true]);
    }
    // And every row still opens its own page: the detail screens are
    // where the work is actually done.
    for (const detail of [
      "/supplier/settlements/${settlement.id}",
      "/supplier/disputes/${dispute.id}",
      "/supplier/replacement-obligations/${replacement.id}",
    ]) {
      expect([detail, SECTIONS.includes(detail)]).toEqual([detail, true]);
    }
  });
});

describe("«الاستبدالات» is «المرتجعات» now", () => {
  it("renames what the supplier READS, in both languages", () => {
    // «استبدل كلمة الاستبدالات بالمرتجعات».
    expect(AR.supplier.replacements.title).toBe("المرتجعات");
    expect(EN.supplier.replacements.title).toBe("Returns");
    expect(AR.supplier.dashboard.needsAttention.categories.replacements).toBe(
      "المرتجعات",
    );

    // Every leaf under the supplier's own returns section, and the
    // dashboard's name for it, is free of the old plural.
    const leaves = (node: unknown, out: string[] = []): string[] => {
      if (typeof node === "string") out.push(node);
      else if (node && typeof node === "object")
        for (const value of Object.values(node)) leaves(value, out);
      return out;
    };
    for (const text of leaves(AR.supplier.replacements)) {
      expect([text, /الاستبدالات/.test(text)]).toEqual([text, false]);
    }
  });

  it("leaves the ROUTE and the model alone", () => {
    // A visible name is not an identifier. Renaming the model to follow
    // a label would rewrite every obligation already recorded, and the
    // API's own vocabulary is `replacement`.
    expect(SECTIONS).toContain("replacement-obligations");
    expect(SECTIONS).toContain("loadSupplierReplacements");
  });
});

describe("«الفوترة والضريبة» is one place, not two", () => {
  it("forwards the old page to «بيانات المنشأة», in the reader's language", () => {
    const page = strip(read("app/[locale]/supplier/account/billing/page.tsx"));

    expect(page).toContain("redirect(");
    expect(page).toContain("/supplier/account");
    // The locale travels with them: a supplier reading English is not
    // dropped into Arabic on the way.
    expect(page).toContain("${appLocale}/supplier/account");
  });

  it("shows AND edits those fields in the record, which is why the page went", () => {
    // The page was a second view of two fields the record already both
    // shows and changes. Two places to change one value is how the two
    // come to disagree.
    const record = read("components/company/company-record-card.tsx");
    const section = read("components/company/company-profile-section.tsx");

    expect(section).toContain("billing={");
    expect(section).toContain("invoicingLegalName");
    expect(record).toContain("invoicingLegalName");
    expect(record).toContain("vatNumber");
    // It WRITES them, not just prints them.
    expect(record).toMatch(/companies\/me\/(invoicing-profile|tax-profile)/);
  });

  it("keeps every stored profile, invoice and rate untouched", () => {
    // «لا تحذف البيانات المحفوظة، ولا تمس الفواتير الفعلية أو منطق
    // الضرائب والتسويات». The forward deletes nothing and calls nothing.
    const page = strip(read("app/[locale]/supplier/account/billing/page.tsx"));

    expect(page).not.toContain("apiClient");
    expect(page).not.toMatch(/delete/);
    expect(page).not.toContain("loadSupplierTaxProfile");
    expect(page).not.toContain("loadSupplierInvoicingProfile");
  });
});
