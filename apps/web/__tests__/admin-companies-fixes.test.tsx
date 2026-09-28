import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/ar-SA.json";
import en from "@/messages/en-SA.json";
import { Breadcrumbs } from "@/components/admin/breadcrumbs";
import { exportLabelQuery } from "@/lib/admin-export-query";

/**
 * The faults reported from a real session with the register, each
 * pinned by the assertion that would have caught it.
 *
 * Several read SOURCE rather than a render. "The page cannot scroll
 * sideways" and "the toolbar has no Excel button in it" are properties
 * of the file: a render proves the case it was given, while the file
 * proves the case that does not exist.
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LIST = strip(read("app/[locale]/admin/companies/page.tsx"));
const DETAIL = strip(read("app/[locale]/admin/companies/[id]/page.tsx"));
const TOOLBAR = strip(read("components/admin/list-toolbar.tsx"));
const PANELS = strip(read("components/admin/company-panels.tsx"));
const STRIP = strip(read("components/admin/company-activity-strip.tsx"));
const WORKBOOK = strip(read("components/admin/company-workbook-actions.tsx"));
// THE SHARED FRAME. The trail is drawn by `components/portal/`
// now, because all three portals wear the same chrome; the console
// still decides that it wants one.
const CHROME = strip(read("components/portal/portal-chrome.tsx"));

describe("1. the filters", () => {
  it("has ONE control, not a disclosure inside a disclosure", () => {
    // THE FAULT: on the suppliers tab, pressing «تصفية» hid the
    // fields; on the buyers tab none appeared at all. There were two
    // controls over one panel and they disagreed.
    //
    // The card is behind a single «بحث» button now, and there is
    // nothing inside it that hides half of what that button opened.
    expect(TOOLBAR).toContain("list-toolbar-open");
    expect(TOOLBAR).not.toContain("list-toolbar-filters-toggle");
    expect(TOOLBAR).not.toContain("filtersOpen");
  });

  it("renders every field once the card is open", () => {
    // No `lg:` breakpoint deciding which half shows: open is open.
    expect(TOOLBAR).toMatch(/selects\.map/);
    expect(TOOLBAR).toMatch(/dates\.map/);
    expect(TOOLBAR).not.toContain("lg:hidden");
  });

  it("gives the buyers an operational status and a registration date", () => {
    // Buyers have no verification, so those two are the whole filter set
    // beyond the search.
    expect(LIST).toContain('name: "operationalStatus"');
    expect(LIST).toContain('name: "registeredFrom"');
    expect(LIST).toContain('name: "registeredTo"');
  });

  it("gives the suppliers verification ON TOP of those", () => {
    const selects = LIST.slice(
      LIST.indexOf("selects={["),
      LIST.indexOf("dates={["),
    );
    expect(selects).toContain("isSupplierTab");
    expect(selects).toContain('name: "verificationStatus"');
    expect(selects).toContain('name: "operationalStatus"');
  });

  it("offers reset only when something is set", () => {
    expect(TOOLBAR).toContain(
      "const canReset = hasSearch || activeFilters > 0",
    );
    expect(TOOLBAR).toMatch(/canReset \? \(/);
  });

  it("counts a date bound as an active filter", () => {
    expect(TOOLBAR).toMatch(
      /dates\.filter\(\(date\) => \(params\.get\(date\.name\)/,
    );
  });

  it("returns to page one on any change", () => {
    expect(TOOLBAR).toContain('next.delete("page")');
  });

  it("keeps the state in the URL, and searches on a debounce", () => {
    expect(TOOLBAR).toContain("useSearchParams");
    expect(TOOLBAR).toContain("DEBOUNCE_MS");
    expect(TOOLBAR).toMatch(/event\.key !== "Enter"/);
  });

  it("has no apply button anywhere", () => {
    expect(TOOLBAR).not.toMatch(/labels\.apply|"apply"/);
  });
});

describe("Excel shares the search row, and cannot move the fields", () => {
  it("sits in the trigger row, not in the card with the fields", () => {
    // THE FAULT: mixed in among the fields, the buttons moved the
    // search box whenever a tab changed the number of filters. They
    // are on the row ABOVE the card now — the same row as «بحث», at
    // the other end — so nothing they do can push a field around.
    const triggerRow = TOOLBAR.slice(
      TOOLBAR.indexOf("justify-between"),
      TOOLBAR.indexOf("{open ? ("),
    );
    expect(triggerRow).toContain("{actions}");

    const card = TOOLBAR.slice(TOOLBAR.indexOf("{open ? ("));
    expect(card).not.toContain("{actions}");
  });

  it("is handed to the toolbar rather than standing in a row above it", () => {
    // A row of its own cost a row of the page for two buttons.
    const toolbarAt = LIST.indexOf("<ListToolbar");
    expect(LIST.slice(0, toolbarAt)).not.toContain("<CompanyWorkbookActions");
    expect(LIST).toContain("actions={");
  });

  it("carries all three actions", () => {
    expect(WORKBOOK).toContain("labels.exportAction");
    expect(WORKBOOK).toContain("labels.templateAction");
    expect(WORKBOOK).toContain("labels.importAction");
  });
});

describe("2. the management tab loads", () => {
  it("calls the label query from a module that takes no side", () => {
    // THE CRASH: `exportLabelQuery` lived in a `"use client"` module and
    // a server component called it — digest 2316792153.
    const shared = read("lib/admin-export-query.ts");
    expect(shared.trimStart().startsWith('"use client"')).toBe(false);
    expect(shared.trimStart().startsWith('"use server"')).toBe(false);

    expect(DETAIL).toContain('from "@/lib/admin-export-query"');
    expect(DETAIL).not.toMatch(/exportLabelQuery[^\n]*from "@\/components/);
  });

  it("still builds the same query it did before the move", () => {
    const query = exportLabelQuery({
      columns: ["أ", "ب"],
      fileLabel: "س",
      date: "2026-08-26",
    });

    expect(query.get("c1")).toBe("أ");
    expect(query.get("c2")).toBe("ب");
    expect(query.get("fileLabel")).toBe("س");
  });

  it("renders ONE page with no tabs at all", () => {
    // The two halves are gone: an operator looking for a branch's
    // telephone no longer has to know which half held it.
    expect(DETAIL).not.toContain("DetailTabs");
    expect(DETAIL).not.toContain("tab=management");
    expect(DETAIL).not.toContain("<CompanyManagement");
  });

  it("keeps an unexpected failure inside the segment", () => {
    // The admin error boundary is a sibling of the pages, not of the
    // chrome — so a crash on one screen leaves the sidebar working.
    const boundary = read("app/[locale]/admin/error.tsx");
    expect(boundary.trimStart().startsWith('"use client"')).toBe(true);
    expect(boundary).toContain("digest");
  });
});

describe("3. nothing stretches the page", () => {
  it("lets every column shrink instead of widening", () => {
    // A grid track defaults to `min-width: auto` and refuses to shrink
    // below its content — which is how one long address pushed the whole
    // page past the viewport.
    expect(PANELS).toContain("grid min-w-0");
    expect(DETAIL).toContain("flex min-w-0 flex-col");
  });

  it("wraps long values rather than growing the card", () => {
    expect(PANELS).toContain("min-w-0 break-words");
    expect(PANELS).toContain("flex min-w-0 flex-col");
  });

  it("uses no fixed width or min-width that could exceed the screen", () => {
    for (const source of [DETAIL, LIST, PANELS]) {
      expect(source).not.toMatch(/\bw-\[\d+px\]/);
      expect(source).not.toMatch(/\bmin-w-\[\d{3,}px\]/);
      expect(source).not.toMatch(/\bminWidth:/);
    }
  });

  it("scrolls tables inside their own container, never the page", () => {
    expect(LIST).toContain("overflow-x-auto");
    expect(LIST).not.toContain("overflow-x-scroll");
  });

  it("stacks to one column on a phone", () => {
    // One column below `sm`, which is the phone.
    expect(PANELS).toMatch(/grid min-w-0 [^"]*sm:grid-cols-2/);

    // THE ACTIVITY GAUGE IS NO LONGER A GRID and no longer lives here:
    // it moved to the top of the page as one strip. It wraps rather
    // than stacking by breakpoint, and drops the rules between its
    // readings below `sm` — a divider on a wrapped line separates
    // nothing and reads as a stray mark.
    expect(STRIP).toContain("flex-wrap");
  });

  it("does not shrink type or controls to fit", () => {
    expect(DETAIL).not.toMatch(/text-\[\d+px\]/);
    expect(PANELS).not.toMatch(/text-\[\d+px\]/);
  });
});

describe("4. the breadcrumb", () => {
  it("links every entry but the last", () => {
    render(
      <NextIntlClientProvider locale="ar-SA" messages={messages}>
        <Breadcrumbs
          label="مسار التنقل"
          items={[
            { label: "السوق", href: "/ar-SA/admin/companies" },
            {
              label: "المنشآت",
              href: "/ar-SA/admin/companies?accountType=SUPPLIER",
            },
            { label: "مؤسسة النهضة" },
          ]}
        />
      </NextIntlClientProvider>,
    );

    // THE FAULT: «السوق ← المنشآت» was plain text that answered no click.
    expect(screen.getByRole("link", { name: "السوق" })).toHaveAttribute(
      "href",
      "/ar-SA/admin/companies",
    );
    expect(screen.getByRole("link", { name: "المنشآت" })).toHaveAttribute(
      "href",
      "/ar-SA/admin/companies?accountType=SUPPLIER",
    );
    // The current record is not a link to itself.
    expect(screen.queryByRole("link", { name: "مؤسسة النهضة" })).toBeNull();
    expect(screen.getByText("مؤسسة النهضة")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("names the trail for a screen reader", () => {
    render(
      <NextIntlClientProvider locale="ar-SA" messages={messages}>
        <Breadcrumbs
          label="مسار التنقل"
          items={[{ label: "أ", href: "/a" }, { label: "ب" }]}
        />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("navigation", { name: "مسار التنقل" }),
    ).toBeInTheDocument();
  });

  it("gives the chrome's own entries an href", () => {
    // The labels come from the nav dictionary the top bar reads. It was
    // called `sidebar` while the navigation was a rail down the side.
    expect(CHROME).toMatch(
      /label: nav\.groupNames\[here\.group\.key\][^}]*href:/s,
    );
    expect(CHROME).toMatch(
      /label: nav\.pageNames\[here\.page\.key\][^}]*href:/s,
    );
  });

  it("is not drawn in the console at all any more", () => {
    // «ألغِ التعليمات ذي لأنها شرح ولا أحتاج شرح… صحيح، في جميع
    //  الصفحات.»
    //
    // THE ROW UNDER THE RULE ANSWERS WHAT IT ANSWERED: which section
    // is open, and which of its screens this is. The trail said the
    // same sentence in words — and on the orders screen the chrome
    // and the page drew one EACH, so the console showed both.
    //
    // THE COMPONENT SURVIVES, tested above and unused by the
    // console: putting a trail back anywhere is one element.
    // ASKED OF THE CONSOLE'S OWN CHROME. `CHROME` above is the
    // SHARED frame, which still takes a trail — the console is what
    // stopped wanting one.
    const console_ = strip(
      read("components/admin/control-panel-chrome.tsx"),
    );
    expect(console_).toContain("breadcrumbs={null}");
    expect(DETAIL).not.toContain("<Breadcrumbs");

    for (const screen_ of [
      "app/[locale]/admin/orders/page.tsx",
      "app/[locale]/admin/follow-up/page.tsx",
    ]) {
      const source = readFileSync(join(ROOT, screen_), "utf8");
      expect([screen_, source.includes("<Breadcrumbs")]).toEqual([
        screen_,
        false,
      ]);
    }
  });

  it("takes the record's way back with it, and the query it re-encoded", () => {
    // IT WAS MORE THAN AN EXPLANATION on that one screen: its middle
    // entry carried the tab, the search, the filters, the page and
    // the page size the reader arrived with, re-encoded through
    // `URLSearchParams` against an allow-list — the value came from
    // an address bar. All of it went, and the FILE says so in a note
    // that survives this assertion being about code.
    expect(DETAIL).not.toContain("backToRegister");
    expect(DETAIL).not.toContain("rawFrom");
    expect(DETAIL).not.toContain("const allowed = [");
  });
});

describe("5. the email and the registration are separate values", () => {
  it("maps them from separate columns, with no concatenation", () => {
    const service = strip(
      readFileSync(
        join(
          ROOT,
          "..",
          "..",
          "apps",
          "api",
          "src",
          "admin",
          "directory",
          "admin-directory.service.ts",
        ),
        "utf8",
      ),
    );

    expect(service).toContain("ownerEmail: row.users[0]?.email ?? null");
    expect(service).toContain("crNumber: row.crNumber");
    // Nothing joins the two.
    expect(service).not.toMatch(/ownerEmail:.*crNumber/);
    expect(service).not.toMatch(/crNumber:.*email/);
  });

  it("renders each in its own field on the company card", () => {
    const card = PANELS.slice(
      PANELS.indexOf('testId="card-company-details"'),
      PANELS.indexOf('testId="card-branches"'),
    );

    expect(card).toContain('testId="company-cr-number"');
    expect(card).toContain('testId="company-owner-email"');
    expect(card).toContain("labels.email");
  });

  it("labels the field «البريد الإلكتروني للمالك», not «المالك»", () => {
    expect(messages.admin.companyDetail.ownerEmail).toBe(
      "البريد الإلكتروني للمالك",
    );
    expect(en.admin.companyDetail.ownerEmail).toBe("Owner email");
    expect(messages.admin.companies.ownerEmail).toBe(
      "البريد الإلكتروني للمالك",
    );
  });

  it("names the copy button for what it copies", () => {
    expect(messages.admin.companies.copyEmail).toBe("نسخ البريد الإلكتروني");
    expect(messages.admin.companies.copyCrNumber).toBe("نسخ السجل التجاري");
  });

  it("passes the email through untouched", () => {
    const copy = strip(read("components/admin/copy-value.tsx"));
    // One value in, the same value rendered and copied.
    expect(copy).toContain("navigator.clipboard.writeText(value)");
    expect(copy).not.toMatch(/value\s*\+/);
    expect(copy).not.toContain("crNumber");
  });
});

describe("8. no standing explanations", () => {
  it("removed the sentence under the Excel buttons", () => {
    expect(WORKBOOK).not.toContain("importHint");
    expect(messages.admin.companyWorkbook).not.toHaveProperty("importHint");
    expect(messages.admin.companyWorkbook).not.toHaveProperty("exportHint");
    expect(messages.admin.companyWorkbook).not.toHaveProperty("templateHint");
  });

  it("kept the sentence that belongs to a decision, inside the preview", () => {
    // The one an operator must read is attached to the button that
    // acts, not floating above a toolbar.
    expect(WORKBOOK).toContain("labels.previewPartial");
    expect(messages.admin.companyWorkbook.previewPartial).toContain(
      "الصفوف الصالحة",
    );
  });

  it("puts no paragraph under the register's title either", () => {
    const head = LIST.slice(LIST.indexOf("<h1"), LIST.indexOf("<RegisterTabs"));
    expect(head).not.toContain("<p");
  });

  it("puts no paragraph under the detail page's heading", () => {
    const head = DETAIL.slice(
      DETAIL.indexOf("<header"),
      DETAIL.indexOf("</header>"),
    );
    expect(head).not.toContain("<p");
  });

  it("puts no paragraph under any card heading", () => {
    // The cards carry data and controls; a standing sentence under each
    // title is read once and then becomes furniture.
    expect(PANELS).not.toContain("labels.detailsHint");
    expect(PANELS).not.toContain("labels.branchesHint");
    expect(PANELS).not.toContain("labels.activityHint");
  });
});
