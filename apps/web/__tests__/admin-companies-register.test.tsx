import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/ar-SA.json";
import en from "@/messages/en-SA.json";
import { RegisterTabs } from "@/components/admin/register-tabs";
import { CopyValue } from "@/components/admin/copy-value";

/**
 * The companies register, on the promises the design makes.
 *
 * Two of these are assertions about SOURCE rather than about a render,
 * and deliberately so. "There is no actions column" and "a buyer is
 * never offered verification" are properties of the page, not of one
 * set of props — a render test proves the case it was given, while
 * reading the file proves the case that does not exist.
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/** Comments explain the rules; they are not the code that applies them. */
function strip(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const LIST = strip(read("app/[locale]/admin/companies/page.tsx"));
const DETAIL = strip(read("app/[locale]/admin/companies/[id]/page.tsx"));

describe("the register is two tabs, not two screens", () => {
  it("keeps ONE companies entry in the sidebar", () => {
    const nav = strip(read("components/admin/control-panel-nav.ts"));
    // The navigable ENTRIES, not every mention of the word — the union
    // type names it too, and that is a type rather than a link.
    const entries = nav.match(/{ key: "[a-z-]*companies[a-z-]*"/g) ?? [];

    // One route. The split is inside the page, so an operator who does
    // not yet know which kind a company is never has to guess first.
    expect(entries).toHaveLength(1);
    expect(nav).not.toMatch(/key: "suppliers"|key: "traders"|key: "buyers"/);
  });

  it("uses the account type AS the tab, so the two cannot disagree", () => {
    expect(LIST).toMatch(/accountType === "SUPPLIER"/);
    // No second piece of state beside the filter.
    expect(LIST).not.toMatch(/searchParams.*\btab\b/);
  });

  it("defaults to the buyers", () => {
    expect(LIST).toMatch(/requested === "SUPPLIER" \? "SUPPLIER" : "TRADER"/);
  });

  it("renders both tabs with their counts", () => {
    render(
      <NextIntlClientProvider locale="ar-SA" messages={messages}>
        <RegisterTabs
          label="نوع المنشأة"
          tabs={[
            {
              key: "traders",
              label: "المشترون",
              href: "?accountType=TRADER",
              count: 486,
              active: true,
            },
            {
              key: "suppliers",
              label: "الموردون",
              href: "?accountType=SUPPLIER",
              count: 73,
              active: false,
            },
          ]}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId("register-tab-count-traders")).toHaveTextContent(
      "486",
    );
    expect(
      screen.getByTestId("register-tab-count-suppliers"),
    ).toHaveTextContent("73");
    // The one a reader is on is announced, not left to be counted.
    expect(screen.getByTestId("register-tab-traders")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("register-tab-suppliers")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("says «الموردون», never «البائعون»", () => {
    expect(messages.admin.companies.tab.suppliers).toBe("الموردون");
    expect(JSON.stringify(messages.admin.companies)).not.toContain("البائعون");
    expect(en.admin.companies.tab.suppliers).toBe("Suppliers");
  });
});

describe("verification belongs to suppliers alone", () => {
  it("shows the column only on the suppliers tab", () => {
    // Every verification-bearing cell is behind the same guard.
    const guarded = LIST.match(
      /isSupplier \? <TH>\{t\("verificationStatus"\)\}<\/TH> : null/,
    );
    expect(guarded).not.toBeNull();
  });

  it("offers the verification filter only on the suppliers tab", () => {
    expect(LIST).toMatch(
      /isSupplierTab\s*\?\s*\[\s*\{\s*name: "verificationStatus"/,
    );
  });

  it("drops a verification filter carried onto the buyers tab", () => {
    // Not silently applied to a register that has no such field.
    expect(LIST).toMatch(/isSupplierTab \? verificationStatus : undefined/);
  });

  it("offers a buyer no verification card at all", () => {
    // A buyer is never verified. The card is behind BOTH checks — the
    // account type AND a request that actually exists — so a buyer's
    // page cannot render it and neither can a supplier who has never
    // submitted.
    expect(DETAIL).toContain("isSupplier && data.verification ?");
  });

  it("takes the decision through the request, never through a status write", () => {
    // The three outcomes go to the operations endpoints, which decide
    // the OPEN REQUEST inside one transaction. A route that moved the
    // company's verification status directly would verify a supplier
    // with nothing recording what was reviewed — which is what the old
    // "grant supplier" button did.
    const card = read("components/admin/supplier-verification-line.tsx");

    expect(card).toContain("/admin/operations/suppliers/${companyId}/approve");
    expect(card).toContain("/admin/operations/suppliers/${companyId}/return");
    expect(card).toContain("/admin/operations/suppliers/${companyId}/reject");

    // No shortcut that sets the status itself.
    expect(card).not.toContain("verificationStatus");
    expect(card).not.toContain("/verification/reapply");
  });

  it("demands a reason on the two decisions that need one, and not on approval", () => {
    const card = read("components/admin/supplier-verification-line.tsx");

    // A return and a refusal are the only things the supplier reads,
    // so both carry a reason field the confirm button waits on.
    const returnBlock = card.slice(
      card.indexOf("suppliers/${companyId}/return"),
      card.indexOf("suppliers/${companyId}/reject"),
    );
    expect(returnBlock).toContain("reason={{");

    const rejectBlock = card.slice(
      card.indexOf("suppliers/${companyId}/reject"),
    );
    expect(rejectBlock).toContain("reason={{");

    const approveBlock = card.slice(
      card.indexOf("suppliers/${companyId}/approve"),
      card.indexOf("suppliers/${companyId}/return"),
    );
    expect(approveBlock).not.toContain("reason={{");
  });

  it("has no bank account screen at all any more", () => {
    // Two decisions over one supplier produced two queues and a
    // state nobody could explain, so the account stopped being
    // approved on its own and the page became a read. A read that
    // nobody is routed to is a page that should not exist:
    //
    //   «أبغى ألغي صفحة الحسابات البنكية، ما أحتاجها، لأن كل حساب
    //    يخصّ مورّدًا فبالضرورة أدخل للمورّد وتفاصيله.»
    //
    // What it showed is on the supplier's own record now, beside
    // the button that decides the request it belongs to.
    expect(
      existsSync(join(ROOT, "app/[locale]/admin/bank-accounts")),
    ).toBe(false);

    // AND THE RECORD CARRIES IT INSTEAD — the holder, the bank and
    // the last four digits, which is what the evidence is checked
    // against.
    expect(read("components/admin/company-panels.tsx")).toContain(
      "company.bankAccounts.active",
    );
  });

  it("shows a verified supplier a badge, and a buyer nothing at all", () => {
    // The one place verification appears is a badge beside the name,
    // behind both the supplier check and the VERIFIED check.
    expect(DETAIL).toContain(
      'isSupplier && data.verificationStatus === "VERIFIED"',
    );
    expect(DETAIL).toContain("company-verified-badge");
  });
});

describe("the name is the only way in", () => {
  it("has no actions column and no three-dot menu", () => {
    expect(LIST).not.toContain("RowActions");
    expect(LIST).not.toContain("actionsColumn");
    expect(LIST).not.toContain("viewDetails");
  });

  it("does not make the row itself clickable", () => {
    // A whole-row handler opens companies an operator was only trying
    // to select text in.
    expect(LIST).not.toMatch(/<TR[^>]*onClick/);
    expect(LIST).not.toMatch(/<TR[^>]*href/);
  });

  it("links the legal name to the detail page, and keeps its focus ring", () => {
    // The href points at the record and carries `from`, so the detail
    // page's breadcrumb can return the reader to the exact list they
    // left rather than to page one of the default tab.
    expect(LIST).toContain("${basePath}/${company.id}${backLink}");
    expect(LIST).toMatch(/company-link-\$\{company\.id\}/);
    expect(LIST).toMatch(/focus-visible:outline/);
  });

  it("builds that return link from every filter the reader had set", () => {
    const built = LIST.slice(
      LIST.indexOf("const returnTo"),
      LIST.indexOf("const backLink"),
    );

    for (const key of [
      "accountType",
      "search",
      "verificationStatus",
      "operationalStatus",
      "registeredFrom",
      "registeredTo",
      "page",
      "pageSize",
    ]) {
      expect(built).toContain(key);
    }
  });
});

describe("the email cell", () => {
  it("renders the address left-to-right whatever the page direction", async () => {
    render(
      <NextIntlClientProvider locale="ar-SA" messages={messages}>
        <CopyValue
          value="info@future-solutions.sa"
          copyLabel="نسخ البريد الإلكتروني"
          copiedLabel="نُسخ البريد الإلكتروني"
          testId="email"
        />
      </NextIntlClientProvider>,
    );

    // Without this an Arabic row reorders the parts of the address.
    expect(screen.getByTestId("email")).toHaveAttribute("dir", "ltr");
  });

  it("wraps at the separators rather than mid-domain", () => {
    const source = strip(read("components/admin/copy-value.tsx"));
    expect(source).toContain("break-words");
    expect(source).not.toContain("break-all");
  });

  it("offers a copy button with a name, and confirms in place", async () => {
    const user = userEvent.setup();

    const writeText = vi.fn().mockResolvedValue(undefined);
    // AFTER `setup()`, which installs a clipboard stub of its own —
    // defining this first would have it replaced before the click. It
    // is a read-only getter in jsdom, hence `defineProperty`.
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <NextIntlClientProvider locale="ar-SA" messages={messages}>
        <CopyValue
          value="info@future-solutions.sa"
          copyLabel="نسخ البريد الإلكتروني"
          copiedLabel="نُسخ البريد الإلكتروني"
          testId="email"
        />
      </NextIntlClientProvider>,
    );

    const button = screen.getByRole("button", {
      name: "نسخ البريد الإلكتروني",
    });
    await user.click(button);

    expect(writeText).toHaveBeenCalledWith("info@future-solutions.sa");
    // The state IS the label, so a reader who cannot see the tick still
    // hears that it worked.
    expect(
      await screen.findByRole("button", { name: "نُسخ البريد الإلكتروني" }),
    ).toBeInTheDocument();
  });
});

describe("the columns each tab actually has", () => {
  it("gives the buyers orders and no verification", () => {
    const buyerColumns = LIST.slice(
      LIST.indexOf("<THead>"),
      LIST.indexOf("</THead>"),
    );
    expect(buyerColumns).toContain('t("legalName")');
    expect(buyerColumns).toContain('t("crNumber")');
    expect(buyerColumns).toContain('t("ownerEmail")');
    expect(buyerColumns).toContain('t("userCount")');
    expect(buyerColumns).toContain('t("orderCount")');
    expect(buyerColumns).toContain('t("createdAt")');
  });

  it("gives the suppliers products and opportunities", () => {
    const head = LIST.slice(LIST.indexOf("<THead>"), LIST.indexOf("</THead>"));
    expect(head).toContain('t("productCount")');
    expect(head).toContain('t("opportunityCount")');
  });

  it("never sends a zero for a count that was not asked for", () => {
    // `null` and `0` mean different things, and a table that renders a
    // dash for one is telling the truth about the other.
    expect(LIST).toContain("company.productCount ?? ");
    expect(LIST).toContain("company.orderCount ?? ");
  });
});

describe("the search and filter behaviour survives the redesign", () => {
  it("still has no apply button", () => {
    const toolbar = strip(read("components/admin/list-toolbar.tsx"));
    expect(toolbar).not.toMatch(/labels\.apply|"apply"/);
  });

  it("still keeps the state in the query string", () => {
    const toolbar = strip(read("components/admin/list-toolbar.tsx"));
    expect(toolbar).toContain("useSearchParams");
    expect(toolbar).toMatch(/router\.replace|router\.push/);
  });

  it("returns to page one when the tab changes", () => {
    // Page four of the buyers is not page four of the suppliers.
    const href = LIST.slice(
      LIST.indexOf("function tabHref"),
      LIST.indexOf("return (\n    <div"),
    );
    expect(href).not.toContain('set("page"');
  });
});
