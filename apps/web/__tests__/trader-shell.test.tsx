import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TraderNav } from "@/components/shell/trader-nav";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Every trader page, discovered from disk.
 *
 * Hardcoding this list would mean a page added later silently escapes
 * the rules below — which is exactly how one screen ends up with its
 * own AppShell, its own cache directive, or an edit button.
 */
function traderPages(dir = join(ROOT, "app", "[locale]", "trader"), prefix = "trader"): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return traderPages(join(dir, entry.name), `${prefix}/${entry.name}`);
    return entry.name === "page.tsx" ? [`${prefix}/page.tsx`] : [];
  });
}

const TRADER_PAGES = traderPages();

const LAYOUT = read("app/[locale]/trader/layout.tsx");
const DASHBOARD = read("app/[locale]/trader/page.tsx");
const TRADER_DATA = read("lib/trader-data.ts");

describe("the trader segment is guarded on the server", () => {
  it("calls requireRoleOrRedirect for the TRADER role", () => {
    expect(strip(LAYOUT)).toContain('requireRoleOrRedirect(appLocale, "TRADER")');
  });

  it("guards before rendering any child", () => {
    const code = strip(LAYOUT);

    // The guard throws Next's redirect signal, so the body is never
    // produced for an unauthorised visitor rather than produced and
    // hidden.
    expect(code.indexOf("requireRoleOrRedirect")).toBeLessThan(code.indexOf("return ("));
  });

  it("re-guards on the page itself, so moving it cannot unguard it", () => {
    expect(strip(DASHBOARD)).toContain('requireRoleOrRedirect(appLocale, "TRADER")');
  });

  it("passes no returnTo — an untrusted one would need an allowlist", () => {
    expect(strip(LAYOUT)).not.toMatch(/requireRoleOrRedirect\([^)]*returnTo/);
    expect(strip(LAYOUT)).not.toContain("searchParams");
  });

  it("adds no role logic to middleware", () => {
    const middleware = strip(read("middleware.ts"));

    expect(middleware).not.toContain("TRADER");
    expect(middleware).not.toContain("getSession");
    expect(middleware).not.toContain("requireRole");
  });

  it("keeps the shared shell, so branding, theme, locale and dir survive", () => {
    expect(strip(LAYOUT)).toContain("<AppShell");
  });
});

describe("trader reads never come from a cache", () => {
  it("marks every request no-store", () => {
    const code = strip(TRADER_DATA);
    const requests = code.match(/apiClient\.get<[^>]*>\([^)]*\)/gs) ?? [];

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(request).toContain('cache: "no-store"');
  });

  it("never opts a signed-in read into revalidation", () => {
    expect(strip(TRADER_DATA)).not.toContain("revalidate");
  });

  it("forwards the cookie without reading or parsing it", () => {
    const code = strip(TRADER_DATA);

    expect(code).toContain("cookieHeader");
    expect(code).not.toContain("JSON.parse");
    expect(code).not.toContain("jwt");
    expect(code).not.toContain("atob");
  });
});

describe("navigation", () => {
  const items = [
    { key: "dashboard", label: "الرئيسية", href: "/ar-SA/trader" },
    { key: "orders", label: "الطلبات", href: "/ar-SA/trader/orders" },
    { key: "notifications", label: "الإشعارات", href: null, comingSoonLabel: "قريبًا", badge: 3 },
  ];

  it("is a landmark with an accessible name", () => {
    render(<TraderNav navLabel="تنقل حساب التاجر" items={items} />);

    expect(screen.getByRole("navigation", { name: "تنقل حساب التاجر" })).toBeInTheDocument();
  });

  it("uses links for navigation, never buttons", () => {
    render(<TraderNav navLabel="nav" items={items} />);

    expect(screen.getByRole("link", { name: "الرئيسية" })).toHaveAttribute(
      "href",
      "/ar-SA/trader"
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders an unbuilt destination as inert text, not a link that 404s", () => {
    render(<TraderNav navLabel="nav" items={items} />);

    expect(screen.queryByRole("link", { name: /الإشعارات/ })).not.toBeInTheDocument();
    const notifications = screen.getByText("الإشعارات").closest("span")!;
    expect(notifications).toHaveAttribute("aria-disabled", "true");
  });

  it("says why an item is unavailable rather than hiding it", () => {
    // A gap in the menu is harder to understand than an item that
    // explains itself.
    render(<TraderNav navLabel="nav" items={items} />);

    expect(screen.getByText("قريبًا")).toBeInTheDocument();
  });

  it("shows an unread badge only when there is something unread", () => {
    const { rerender } = render(<TraderNav navLabel="nav" items={items} />);
    expect(screen.getByText("3")).toBeInTheDocument();

    rerender(
      <TraderNav
        navLabel="nav"
        items={[{ key: "n", label: "الإشعارات", href: null, badge: 0 }]}
      />
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("wraps instead of scrolling sideways at a narrow viewport", () => {
    const { container } = render(<TraderNav navLabel="nav" items={items} />);
    const list = container.querySelector("ul")!;

    // `flex-wrap` is what keeps 360px free of horizontal overflow.
    expect(list.className).toContain("flex-wrap");
    expect(list.className).not.toContain("overflow-x");
  });

  it("marks up the items as a list", () => {
    render(<TraderNav navLabel="nav" items={items} />);

    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("the dashboard shows only real data", () => {
  const code = strip(DASHBOARD);

  it("renders no invented metric or chart", () => {
    for (const fake of ["Math.random", "chart", "sparkline", "revenue", "growth", "trend"]) {
      expect(code.toLowerCase()).not.toContain(fake.toLowerCase());
    }
  });

  it("reads only endpoints that exist", () => {
    expect(code).toContain("loadTraderOrders");
    expect(code).toContain("loadUnreadNotificationCount");
  });

  it("isolates each panel behind its own Suspense boundary", () => {
    expect((code.match(/<Suspense/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("gives every panel its own error state, so one failure is not fatal", () => {
    expect((code.match(/<ErrorState/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("puts what needs attention before the rest", () => {
    expect(code.indexOf("NeedsAttentionPanel")).toBeLessThan(code.indexOf("OrdersPanel"));
  });

  it("shows nothing at all when nothing needs attention", () => {
    // An empty "needs attention" card would train people to ignore it.
    expect(code).toContain("if (attention.length === 0) return null");
  });

  it("uses server-computed overdue rather than deriving it in the UI", () => {
    expect(code).toContain("hasOverduePreparation");
  });

  it("renders no raw HTML", () => {
    expect(code).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("message parity for the trader namespace", () => {
  const ar = JSON.parse(read("messages/ar-SA.json"));
  const en = JSON.parse(read("messages/en-SA.json"));

  const flatten = (value: unknown, prefix = ""): string[] =>
    typeof value !== "object" || value === null
      ? [prefix]
      : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
          flatten(v, prefix ? `${prefix}.${k}` : k)
        );

  it("ships the trader namespace in both locales", () => {
    expect(ar.trader).toBeDefined();
    expect(en.trader).toBeDefined();
  });

  it("has identical keys in both", () => {
    expect(flatten(ar.trader).sort()).toEqual(flatten(en.trader).sort());
  });

  it("exposes no internal technical term to the reader", () => {
    const serialised = JSON.stringify([ar.trader, en.trader]).toLowerCase();

    for (const internal of [
      "masterorder",
      "allocation_status",
      "payment_pending",
      "outbox",
      "prisma",
      "null",
      "undefined",
    ]) {
      expect(serialised).not.toContain(internal);
    }
  });
});

describe("routing: a real segment, not a route group", () => {
  const appDir = join(ROOT, "app", "[locale]");

  it("serves the dashboard at /trader itself, not /trader/dashboard", () => {
    expect(existsSync(join(appDir, "trader", "page.tsx"))).toBe(true);
    expect(existsSync(join(appDir, "trader", "dashboard"))).toBe(false);
  });

  it("leaves no orphaned (trader) route group behind", () => {
    const groups = readdirSync(appDir).filter((entry) => entry.startsWith("("));

    expect(groups).not.toContain("(trader)");
    expect(existsSync(join(appDir, "(trader)"))).toBe(false);
  });

  it("keeps the public marketplace and the trader view on distinct paths", () => {
    // The collision this segment exists to avoid: a route group adds no
    // URL segment, so (trader)/opportunities and (public)/opportunities
    // would both resolve to /{locale}/opportunities.
    expect(existsSync(join(appDir, "(public)", "opportunities", "page.tsx"))).toBe(true);
    expect(existsSync(join(appDir, "(public)", "opportunities", "[id]", "page.tsx"))).toBe(true);
  });

  it("adds no compatibility redirect for a path that was never published", () => {
    expect(existsSync(join(appDir, "dashboard"))).toBe(false);
  });

  it("guards every trader page through one layout", () => {
    expect(existsSync(join(appDir, "trader", "layout.tsx"))).toBe(true);
  });

  it("does not re-wrap AppShell inside a trader page", () => {
    // The layout supplies the chrome once; a page repeating it would
    // nest headers, footers and skip links.
    for (const page of TRADER_PAGES) {
      expect(strip(read(`app/[locale]/${page}`))).not.toContain("<AppShell");
    }
  });

  it("never shows the word 'trader' to a reader", () => {
    const ar = JSON.parse(read("messages/ar-SA.json"));

    expect(JSON.stringify(ar.trader)).not.toContain("trader");
    expect(JSON.stringify(ar.trader)).not.toContain("Trader");
  });
});

describe("account pages are honestly read-only", () => {
  const overview = strip(read("app/[locale]/trader/account/page.tsx"));
  const company = strip(read("app/[locale]/trader/account/company/page.tsx"));
  const panels = strip(read("components/trader/account-panels.tsx"));

  it("offers no edit affordance while no write screen exists", () => {
    // A button that opens nothing promises an action the product
    // cannot perform.
    for (const source of [overview, company]) {
      expect(source).not.toMatch(/<Button\b/);
      expect(source).not.toContain("onSubmit");
    }
  });

  it("says plainly that the pages are view-only", () => {
    expect(overview).toContain("readOnlyNotice");
  });

  it("renders facts, never a JSON dump", () => {
    expect(company).toContain("<FactList");
    expect(company).not.toContain("JSON.stringify");
    expect(company).not.toContain("<pre");
  });

  it("can only ever mask an identifier, never trim a full one", () => {
    // MaskedValue takes the visible suffix, so a whole IBAN cannot be
    // passed in and relied upon to be hidden.
    expect(panels).toMatch(/last4:\s*string/);
    expect(panels).not.toMatch(/iban/i);
    expect(panels).not.toContain("slice(-4)");
  });

  it("requires a next step beside every status", () => {
    expect(panels).toMatch(/action:\s*string;/);
    expect(panels).not.toMatch(/action\?:\s*string/);
  });

  it("makes no coordinate a primary display", () => {
    for (const source of [overview, company, panels]) {
      expect(source).not.toContain("latitude");
      expect(source).not.toContain("longitude");
    }
  });

  it("gives deep pages a breadcrumb back", () => {
    expect(company).toContain("breadcrumbLabel");
    expect(company).toContain("backToAccount");
  });
});

describe("private trader routes are never statically rendered", () => {
  it("declares force-dynamic on the LAYOUT, so the whole segment inherits it", () => {
    // On the layout rather than each page: a page added later cannot
    // forget it. These pages carry one company's orders, notifications
    // and bank details — a shared-cache copy would be a cross-tenant
    // leak.
    expect(strip(LAYOUT)).toContain('export const dynamic = "force-dynamic"');
  });

  it("does not rely on each page repeating the declaration", () => {
    for (const page of TRADER_PAGES) {
      expect(strip(read(`app/[locale]/${page}`))).not.toContain("force-dynamic");
    }
  });

  it("marks every trader read no-store and never revalidates one", () => {
    const code = strip(TRADER_DATA);

    expect(code).toContain('cache: "no-store"');
    expect(code).not.toContain("revalidate");
    expect(code).not.toContain("force-cache");
  });

  it("uses no cache primitive that could outlive one user's request", () => {
    const code = strip(TRADER_DATA);

    // React `cache()` is per-request, but unstable_cache is not — it is
    // a cross-request store and must never hold a session's data.
    expect(code).not.toContain("unstable_cache");
    expect(code).not.toContain("revalidateTag");
    expect(code).not.toContain('from "react"');
  });

  it("forwards the session cookie on every private read", () => {
    const code = strip(TRADER_DATA);
    const requests = code.match(/apiClient\.get<[^>]*>\([^)]*\)/gs) ?? [];

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(request).toContain("cookieHeader");
  });
});

describe("the account section covers every link it offers", () => {
  const overview = strip(read("app/[locale]/trader/account/page.tsx"));

  it("has a real page behind every section it links to", () => {
    // The overview builds hrefs from a `sections` list. A section
    // pointing at a route with no page is a 404 the reader reaches by
    // following our own navigation.
    const hrefs = [...overview.matchAll(/trader\/account\/([a-z-]+)`/g)].map((m) => m[1]);

    expect(hrefs.length).toBeGreaterThan(0);
    for (const segment of hrefs) {
      expect(TRADER_PAGES).toContain(`trader/account/${segment}/page.tsx`);
    }
  });

  it("subjects every account page to the read-only and breadcrumb rules", () => {
    const pages = TRADER_PAGES.filter(
      (page) => page.startsWith("trader/account/") && page !== "trader/account/page.tsx"
    );
    expect(pages.length).toBeGreaterThanOrEqual(4);

    for (const page of pages) {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source, page).not.toMatch(/<Button\b/);
      expect(source, page).not.toContain("onSubmit");
      expect(source, page).toContain("breadcrumbLabel");
      expect(source, page).toContain("backToAccount");
      expect(source, page).toContain('requireRoleOrRedirect(appLocale, "TRADER")');
      expect(source, page).not.toContain("latitude");
      expect(source, page).not.toContain("longitude");
      expect(source, page).not.toContain("JSON.stringify");
      expect(source, page).not.toContain("<pre");
    }
  });
});

describe("the locations page speaks about delivery, not shipping origin", () => {
  const locations = strip(read("app/[locale]/trader/account/locations/page.tsx"));
  const ar = JSON.parse(read("messages/ar-SA.json"));
  const en = JSON.parse(read("messages/en-SA.json"));

  it("labels the city as the DELIVERY city", () => {
    // The marketplace filter is the supplier's shipping ORIGIN. These
    // are the trader's own branches, which is the one place in the
    // product where "delivery city" is the correct term.
    expect(en.trader.account.locations.city).toBe("Delivery city");
    expect(ar.trader.account.locations.city).toContain("التسليم");
    expect(en.trader.account.locations.city).not.toMatch(/ships? from|origin/i);
  });

  it("resolves a city to its name and never prints the raw id", () => {
    expect(locations).toContain("cityName(location.cityId)");
    expect(locations).not.toMatch(/\{location\.cityId\}/);
  });

  it("survives a failed reference-data read without failing the page", () => {
    // The city list is a separate request. If it fails, the branches
    // still render — with the city omitted, never with an id shown in
    // its place.
    expect(locations).toContain("if (!cities.ok) return null");
    expect(locations).toContain("{city ? <Fact");
  });

  it("renders its own error and empty states rather than throwing", () => {
    expect(locations).toContain("<ErrorState");
    expect(locations).toContain("<EmptyState");
    expect(locations).toContain("requestId={locations.error.requestId}");
  });
});

describe("the bank-account page tells the truth about where money goes", () => {
  const page = strip(read("app/[locale]/trader/account/bank-account/page.tsx"));
  const en = JSON.parse(read("messages/en-SA.json"));

  it("holds no bank details for a trader and does not pretend to", () => {
    // `supplier_bank_accounts` pays SUPPLIERS out. A trader is charged
    // by the provider at checkout, and RefundObligation is keyed to the
    // PaymentAttempt, so a refund reverses that payment.
    const copy = JSON.stringify(en.trader.account.bankAccount);
    expect(copy).toMatch(/no bank account for traders/i);
    expect(copy).toMatch(/same payment method/i);
  });

  it("reads nothing, because there is nothing stored to read", () => {
    expect(page).not.toContain("apiClient");
    expect(page).not.toMatch(/\bload[A-Z]\w*\(/);
  });

  it("shows no IBAN, masked or otherwise", () => {
    expect(page).not.toMatch(/iban/i);
    expect(page).not.toContain("MaskedValue");
  });

  it("offers no form for details the platform does not want", () => {
    expect(page).not.toContain("<input");
    expect(page).not.toMatch(/<Button\b/);
  });
});

describe("the tax profile page states what is declared, not what is certified", () => {
  const page = strip(read("app/[locale]/trader/account/tax-profile/page.tsx"));
  const en = JSON.parse(read("messages/en-SA.json"));
  const ar = JSON.parse(read("messages/ar-SA.json"));

  it("reads the TRADER-scoped endpoint, not the supplier one", () => {
    // `/companies/me/tax-profile` reads supplier_tax_profiles and would
    // be null forever for a trader.
    expect(strip(TRADER_DATA)).toContain('"/trader/settings/tax-profile"');
    expect(strip(TRADER_DATA)).not.toContain('"/companies/me/tax-profile"');
  });

  it("treats a missing profile as a state with a next step, not an error", () => {
    expect(page).toContain("profile.data === null");
    expect(page).toContain("<StatusWithAction");
    expect(page).toContain('tone="warning"');
  });

  it("says the VAT details are self-declared", () => {
    expect(page).toContain("selfDeclaredNotice");
    expect(en.trader.account.taxProfile.selfDeclaredNotice).toMatch(/not verified/i);
    expect(ar.trader.account.taxProfile.selfDeclaredNotice).toContain("لم تُوثَّق");
  });

  it("makes no tax-invoice, ZATCA or clearance claim anywhere", () => {
    const copy = JSON.stringify({
      en: en.trader.account.taxProfile,
      ar: ar.trader.account.taxProfile,
    });
    for (const claim of ["ZATCA", "zatca", "clearance", "Clearance", "QR", "tax invoice", "فاتورة ضريبية", "هيئة الزكاة"]) {
      expect(copy).not.toContain(claim);
    }
  });

  it("shows the VAT number only when the trader says they are registered", () => {
    expect(page).toContain("profile.data.isVatRegistered && profile.data.vatNumber");
  });
});

describe("the trader portal holds no supplier-shaped concept", () => {
  it("has no financial-readiness read left in the trader data layer", () => {
    // The endpoint checks a verified bank account and a supplier
    // invoicing profile. For a trader both are permanently absent, so
    // wiring it up would show them a red state about things that do
    // not apply to them.
    const code = strip(TRADER_DATA);

    expect(code).not.toContain("financial-readiness");
    expect(code).not.toContain("loadFinancialReadiness");
  });

  it("asks for no supplier bank account from any trader page", () => {
    for (const page of TRADER_PAGES) {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source, page).not.toContain("/companies/me/bank-account");
    }
  });
});

describe("the trader listing is the marketplace plus terms", () => {
  const list = strip(read("app/[locale]/trader/opportunities/page.tsx"));
  const detail = strip(read("app/[locale]/trader/opportunities/[id]/page.tsx"));
  const publicCard = strip(read("components/opportunities/opportunity-card.tsx"));

  it("reads the trader endpoint, never the anonymous one", () => {
    expect(strip(TRADER_DATA)).toContain("/trader/opportunities/active?");
    expect(list).not.toContain("loadOpportunities");
    expect(detail).not.toContain("loadOpportunityDetail");
  });

  it("keeps the public card free of every commercial field", () => {
    // The split is enforced by two components, not one with a
    // `showTerms` flag — a flag is one wrong prop away from printing a
    // price on the anonymous marketplace.
    for (const field of [
      "unitPriceInclTaxAmount",
      "targetQuantity",
      "fundedQuantity",
      "unsoldQuantity",
      "progressPercentage",
      "shareQuantity",
      "sharePercentage",
      "expectedPreparationDays",
    ]) {
      expect(publicCard, field).not.toContain(field);
    }
    expect(publicCard).not.toContain("formatMoney");
  });

  it("hands the WHOLE query to the API so no filter is dropped", () => {
    // A loader taking only {page, sort} would let the filters appear to
    // apply while the API returned an unfiltered page.
    expect(list).toContain("loadTraderOpportunities(query)");
    expect(strip(TRADER_DATA)).toContain("toApiQueryString(query)");
  });

  it("narrows nothing on the client", () => {
    for (const source of [list, detail]) {
      expect(source).not.toMatch(/\.filter\(/);
      expect(source).not.toMatch(/\.sort\(/);
    }
  });

  it("submits its filters and pages back to the TRADER listing", () => {
    expect(list).toContain('const TRADER_OPPORTUNITIES_PATH = "trader/opportunities"');
    expect(list).toContain("basePath={TRADER_OPPORTUNITIES_PATH}");
  });

  it("leaves the public listing on the public base path", () => {
    const publicList = strip(read("app/[locale]/(public)/opportunities/page.tsx"));
    expect(publicList).not.toContain("basePath=");
  });
});

describe("trader opportunity terms are displayed, never recomputed", () => {
  const detail = strip(read("app/[locale]/trader/opportunities/[id]/page.tsx"));
  const card = strip(read("components/opportunities/trader-opportunity-card.tsx"));
  const ar = JSON.parse(read("messages/ar-SA.json"));
  const en = JSON.parse(read("messages/en-SA.json"));

  it("computes no total from a price and a quantity", () => {
    // The frozen quote is what the provider charges. A total computed
    // here is a second source of truth, and the one on screen is the
    // one a person believes.
    for (const source of [detail, card]) {
      expect(source).not.toMatch(/unitPrice\w*\s*\*/);
      expect(source).not.toMatch(/\*\s*\w*[Qq]uantity/);
      expect(source).not.toContain("reduce(");
    }
  });

  it("formats every amount from the decimal string the API sends", () => {
    // There is one formatter and it takes a string. The endpoint used
    // to serialise this price through Decimal.toNumber(); both the
    // endpoint and the number-accepting formatter are gone.
    for (const source of [detail, card]) {
      expect(source).toContain("formatMoney(opportunity.unitPriceInclTaxAmount");
      expect(source).not.toContain("formatMoneyFromApiNumber");
      expect(source).not.toMatch(/toFixed\(/);
      expect(source).not.toContain("Number(");
    }
  });

  it("types the pages from the SHARED contract, not a local mirror", () => {
    // A local mirror is how a field gets renamed on one side and not
    // the other — which is exactly what let unitPriceAmount: number
    // live in the web app while the contract said otherwise.
    const data = strip(read("lib/trader-data.ts"));
    expect(data).toContain('export type { TraderOpportunityItem, TraderOpportunityDetail }');
    expect(data).not.toMatch(/^export interface TraderOpportunity /m);
    expect(card).toContain('from "@platform/types"');
  });

  it("states an unavailable price rather than showing a zero", () => {
    // "0.00" would be a claim about what something costs.
    for (const source of [detail, card]) {
      expect(source).toContain("priceUnavailable");
    }
  });

  it("says the price includes VAT without claiming a tax document", () => {
    const copy = JSON.stringify({ ar: ar.trader.opportunities, en: en.trader.opportunities });
    expect(en.trader.opportunities.detail.priceIncludesTax).toMatch(/includes VAT/i);
    for (const claim of ["ZATCA", "zatca", "Clearance", "clearance", "tax invoice", "فاتورة ضريبية", "QR"]) {
      expect(copy, claim).not.toContain(claim);
    }
  });

  it("never calls the unsold quantity available or reserved", () => {
    // It is targetQuantity − fundedQuantity, arithmetic and not a
    // reservation. Checkout's lock is the only authority.
    expect(en.trader.opportunities.unsold).toBe("Unsold quantity");
    expect(en.trader.opportunities.unsold).not.toMatch(/available|remaining|reserved/i);
    expect(en.trader.opportunities.detail.unsoldCaveat).toMatch(/not a reservation/i);
    expect(ar.trader.opportunities.detail.unsoldCaveat).toContain("ليست حجزًا");
    expect(detail).toContain("unsoldCaveat");
  });

  it("describes progress as quantity SOLD, never as funding or a goal", () => {
    // targetQuantity is a supply cap. Nothing unlocks at 100% — every
    // paid order is fulfilled on its own.
    const copy = JSON.stringify({ ar: ar.trader.opportunities, en: en.trader.opportunities });
    expect(en.trader.opportunities.sold).toMatch(/sold/i);
    for (const word of ["funded", "funding", "goal", "target reached", "تمويل", "الهدف"]) {
      expect(copy, word).not.toContain(word);
    }
    expect(en.trader.opportunities.detail.progressCaveat).toMatch(/unlocks nothing/i);
    expect(detail).toContain("progressCaveat");
  });

  it("offers the purchase composer, and posts nothing itself", () => {
    // The page is a Server Component: it renders the composer and
    // supplies the branch list, and the POST happens in the client
    // component where the browser attaches Origin and the session
    // cookie.
    expect(detail).toContain("<PurchaseComposer");
    expect(detail).not.toContain("checkout-sessions");
    expect(detail).not.toContain("apiClient.post");
    expect(detail).not.toContain("purchaseComingSoon");
  });

  it("fetches the branch list on the SERVER and hands it down", () => {
    // So there is no code path in which a location id comes from
    // anywhere but /companies/me/locations, which the API scopes to the
    // caller's company and filters to active rows.
    expect(detail).toContain("loadTraderLocations()");
    expect(detail).toContain("locations={locations}");
  });

  it("passes no coordinate into the composer", () => {
    expect(detail).not.toContain("latitude");
    expect(detail).not.toContain("longitude");
  });

  it("renders the product description as text, never as markup", () => {
    expect(detail).not.toContain("dangerouslySetInnerHTML");
    expect(detail).toContain("whitespace-pre-wrap");
  });

  it("answers an unknown, hidden or expired id with one 404", () => {
    // One indistinguishable answer, so probing ids confirms nothing.
    expect(detail).toContain("result.notFound) notFound()");
    expect(strip(TRADER_DATA)).toContain('result.error.kind === "notFound"');
  });
});

describe("checkout and payment are keyed by the checkout session", () => {
  const checkout = strip(read("app/[locale]/trader/checkout/[checkoutSessionId]/page.tsx"));
  const payment = strip(read("app/[locale]/trader/payment/[checkoutSessionId]/page.tsx"));

  it("names the route parameter after the session, not an attempt", () => {
    // A payment-attempt id would change the URL identity the moment an
    // attempt was created, and a reload after a failed attempt would
    // land on a dead id.
    expect(TRADER_PAGES).toContain("trader/checkout/[checkoutSessionId]/page.tsx");
    expect(TRADER_PAGES).toContain("trader/payment/[checkoutSessionId]/page.tsx");
    for (const source of [checkout, payment]) {
      expect(source).toContain("checkoutSessionId: string");
      expect(source).not.toContain("paymentAttemptId");
    }
  });

  it("reads the session as the single authority on state", () => {
    for (const source of [checkout, payment]) {
      expect(source).toContain("loadCheckoutSession(checkoutSessionId)");
    }
  });

  it("answers an unknown session and another company's alike, with one 404", () => {
    for (const source of [checkout, payment]) {
      expect(source).toContain("result.notFound) notFound()");
    }
  });
});

describe("the checkout page displays the frozen quote and computes nothing", () => {
  const checkout = strip(read("app/[locale]/trader/checkout/[checkoutSessionId]/page.tsx"));
  const summary = strip(read("components/checkout/checkout-summary.tsx"));

  it("derives no total from a price and a quantity", () => {
    // quote_snapshots holds the figure the provider is charged. A
    // client-side total is a second source of truth, and the one on
    // screen is the one a person believes.
    for (const source of [checkout, summary]) {
      expect(source).not.toContain("reduce(");
      expect(source).not.toMatch(/unitPrice\w*\s*\*/);
      expect(source).not.toContain("parseFloat");
    }
  });

  it("formats every amount from its decimal string", () => {
    expect(summary).toContain("formatMoney(");
    expect(summary).not.toContain("formatMoneyFromApiNumber");
    expect(summary).not.toContain("Number(");
    expect(summary).not.toContain("toFixed");
  });

  it("states an unavailable amount rather than rendering a zero", () => {
    expect(summary).toContain("amountUnavailable");
  });

  it("shows each destination's own quantity and shipping fee", () => {
    expect(summary).toContain("allocation.quantity");
    expect(summary).toContain("allocation.shippingFeeAmount");
  });

  it("renders no coordinate for a destination", () => {
    for (const source of [checkout, summary]) {
      expect(source).not.toContain("latitude");
      expect(source).not.toContain("longitude");
    }
  });
});

describe("what checkout offers depends on the session status alone", () => {
  const checkout = strip(read("app/[locale]/trader/checkout/[checkoutSessionId]/page.tsx"));
  const en = JSON.parse(read("messages/en-SA.json"));

  it("covers every status in the contract", () => {
    for (const status of ["LOCKED", "PAYMENT_PENDING", "EXPIRED", "ABANDONED"]) {
      expect(checkout, status).toContain(`case "${status}"`);
    }
    // PAID is handled by the type guard, which also narrows to the
    // variant carrying masterOrderId.
    expect(checkout).toContain("isPaidCheckoutSession(session)");
  });

  it("links a PAID session straight to its order, with no waiting state", () => {
    // The webhook writes PAID and the MasterOrder on one transaction
    // client, so there is no "paid but still finalising" to sit through.
    expect(checkout).toContain("trader/orders/");
    expect(checkout).toContain("session.masterOrderId");
    expect(JSON.stringify(en.trader.checkout)).not.toMatch(/finalis|finaliz/i);
  });

  it("offers payment ONLY from a LOCKED session", () => {
    const locked = checkout.slice(checkout.indexOf('case "LOCKED"'));
    const nextCase = locked.indexOf('case "PAYMENT_PENDING"');
    expect(locked.slice(0, nextCase)).toContain("<StartPaymentButton");
    // A second attempt from PAYMENT_PENDING would be refused by the
    // server anyway; offering it is a promise the product cannot keep.
    expect(checkout.slice(checkout.indexOf('case "PAYMENT_PENDING"'))).not.toContain(
      "<StartPaymentButton"
    );
  });

  it("never calls a held quantity reserved or guaranteed", () => {
    expect(en.trader.checkout.locked.notReserved).toMatch(/not guaranteed until payment/i);
  });
});

describe("starting a payment is one idempotent operation", () => {
  const raw = read("components/checkout/start-payment-button.tsx");
  const button = strip(raw);

  it("holds the key somewhere a RELOAD can find it", () => {
    // A useRef survives a re-render, which covers a double click, and
    // dies with the component — and a reload IS a remount. Someone
    // whose request stalled, who reloads and presses again, would
    // arrive with a fresh key, which the server reads as a NEW payment.
    expect(button).toContain('claimKey("payment-attempt", checkoutSessionId)');
    expect(button).not.toContain("useRef");
    expect(button).not.toMatch(/newIdempotencyKey\(\)/);
  });

  it("uses a key distinct from the checkout-creation one", () => {
    // Two operations, two idempotency scopes on the server
    // (TRADER_CHECKOUT_CREATE and PAYMENT_ATTEMPT_START). One key across
    // both would make a replay of one look like the other.
    expect(button).not.toContain("checkoutSessionKey");
    expect(raw).toContain("PAYMENT_ATTEMPT_START");
  });

  it("guards against a double submit", () => {
    expect(button).toContain("if (submitting) return");
    expect(button).toContain("disabled={submitting}");
  });

  it("shows only a translated message and a request id on failure", () => {
    // Never `error.message` — an English developer string that can
    // carry internal detail.
    expect(button).toContain("root(failure.messageKey)");
    expect(button).toContain("failure.requestId");
    expect(button).not.toContain("failure.message}");
    expect(button).not.toContain("JSON.stringify");
  });

  it("posts to the payment-attempts endpoint and renders none of its body", () => {
    expect(button).toContain("/payment-attempts");
    expect(button).not.toContain("providerReference");
    expect(button).not.toContain("attempt.status");
  });
});

describe("the payment page waits without ever re-posting", () => {
  const payment = strip(read("app/[locale]/trader/payment/[checkoutSessionId]/page.tsx"));
  const poller = strip(read("components/checkout/payment-status-poller.tsx"));
  const en = JSON.parse(read("messages/en-SA.json"));

  it("polls a READ, never a write", () => {
    // A poll that retried a write would create a payment every few
    // seconds.
    expect(poller).toContain("apiClient.get<");
    expect(poller).not.toContain("apiClient.post");
    expect(poller).not.toContain("payment-attempts");
  });

  it("stops polling rather than asking forever", () => {
    expect(poller).toContain("MAX_POLL_MS");
    expect(poller).toContain("setStopped(true)");
    expect(poller).toContain("recheckLabel");
  });

  it("does not start polling a session that is already settled", () => {
    expect(poller).toMatch(/if \(isPollTerminalStatus\(initialStatus\)[^)]*\) return;/);
  });

  it("treats LOCKED as the end of THIS wait, though not of the session", () => {
    // Both failure paths — markAttemptFailedAndRestoreCheckout and
    // handleFailureEvent — mark the attempt FAILED and return the
    // session to LOCKED while the lock is still valid. Waiting on it
    // would poll a hundred times for a change that already happened.
    expect(poller).toContain("export function isPollTerminalStatus");
    expect(poller).toMatch(/isTerminalCheckoutStatus\(status\) \|\| status === "LOCKED"/);
  });

  it("stops the timer and aborts in flight the moment it settles", () => {
    // Rather than relying on the effect's cleanup, which does not run
    // until unmount or a dependency change.
    expect(poller).toContain("function stopNow()");
    expect(poller).toMatch(
      /function stopNow\(\) \{[\s\S]*?clearTimeout\(timer\);[\s\S]*?controller\.abort\(\);/
    );
  });

  it("imports the terminal-status rule rather than restating it", () => {
    // A local copy could call a status terminal here and not on the
    // server, leaving someone waiting on a session already finished.
    expect(poller).toContain('from "@platform/types"');
    expect(poller).not.toMatch(/=== "EXPIRED" \|\| \w+ === "ABANDONED"/);
  });

  it("cleans up its timer when unmounted", () => {
    // Otherwise navigating away leaves a tab requesting indefinitely.
    expect(poller).toContain("cancelled = true");
    expect(poller).toContain("clearTimeout(timer)");
  });

  it("treats a failed poll as unknown, not as a failed payment", () => {
    // The capture is decided by the webhook, not by whether this
    // request succeeded.
    expect(poller).toMatch(/\} catch \{/);
    expect(poller).not.toContain("setFailure");
  });

  it("lets the server decide where a paid session goes", () => {
    // Duplicating the routing decision in the poller is how the two
    // come to disagree. It reads masterOrderId only to detect a
    // response that contradicts its own contract — never to navigate.
    expect(poller).toContain("router.refresh()");
    expect(poller).not.toContain("trader/orders/");
    expect(poller).not.toContain("router.push");
  });

  it("stops on a PAID response carrying no order id", () => {
    // The union guarantees PAID carries one. This pair cannot come from
    // the write path, which commits both together — so seeing it means
    // something is broken, and the honest move is to say so rather than
    // navigate to /trader/orders/null.
    expect(poller).toContain("if (!session.masterOrderId)");
    expect(poller).toContain("setContractError(true)");
  });

  it("declares its polling bounds as named, exported constants", () => {
    // Exported so the fake-timer suite asserts the REAL values rather
    // than a copy that can drift from them.
    expect(poller).toContain("export const POLL_INTERVAL_MS");
    expect(poller).toContain("export const MAX_POLL_MS");
    expect(poller).toContain("export const MAX_POLL_ATTEMPTS");
  });

  it("never lets two requests overlap", () => {
    expect(poller).toContain("if (cancelled || inFlight) return");
    expect(poller).toContain("inFlight = true");
  });

  it("skips polling entirely while the tab is hidden", () => {
    expect(poller).toContain('document.visibilityState === "hidden"');
  });

  it("aborts a request in flight when unmounted", () => {
    expect(poller).toContain("new AbortController()");
    expect(poller).toContain("controller.abort()");
    expect(poller).toContain("signal: controller.signal");
  });

  it("sends a paid session to its order rather than leaving it waiting", () => {
    expect(payment).toContain("isPaidCheckoutSession(session)");
    expect(payment).toContain("redirect(");
    expect(payment).toContain("session.masterOrderId");
  });

  it("sends a session with no attempt back to checkout", () => {
    expect(payment).toContain('session.status === "LOCKED"');
    expect(payment).toContain("trader/checkout/");
  });

  it("offers no cancel control while a capture may be in flight", () => {
    expect(payment).not.toContain("/abandon");
    expect(payment).not.toMatch(/<Button\b/);
  });

  it("says where a refund goes without promising a bank transfer", () => {
    for (const terminal of ["EXPIRED", "ABANDONED"]) {
      const copy = en.trader.payment[terminal].description;
      expect(copy, terminal).toMatch(/same payment method/i);
      expect(copy, terminal).not.toMatch(/bank|IBAN/i);
    }
  });

  it("makes no claim that the browser completes the payment", () => {
    expect(en.trader.payment.pending.description).toMatch(/confirmed by the payment provider/i);
    expect(en.trader.payment.pending.doNotClose).toMatch(/does not affect the payment/i);
  });
});
