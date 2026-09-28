import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PortalTopNav } from "@/components/portal/portal-top-nav";
import { portalPages } from "@/components/portal/portal-nav";
import { TRADER_PORTAL_MAP } from "@/components/trader/trader-portal-nav";

/**
 * The sidebar reads `usePathname`, which is bound at import time — a
 * hoisted holder lets each case set the address before it renders.
 */
const nav = vi.hoisted(() => ({ pathname: "/ar-SA/trader" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

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
function traderPages(
  dir = join(ROOT, "app", "[locale]", "trader"),
  prefix = "trader",
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return traderPages(join(dir, entry.name), `${prefix}/${entry.name}`);
    return entry.name === "page.tsx" ? [`${prefix}/page.tsx`] : [];
  });
}

const TRADER_PAGES = traderPages();

const LAYOUT = read("app/[locale]/trader/layout.tsx");
const DASHBOARD = read("app/[locale]/trader/page.tsx");
const TRADER_DATA = read("lib/trader-data.ts");

describe("the trader segment is guarded on the server", () => {
  it("calls requireRoleOrRedirect for the TRADER role", () => {
    expect(strip(LAYOUT)).toContain(
      'requireRoleOrRedirect(appLocale, "TRADER")',
    );
  });

  it("guards before rendering any child", () => {
    const code = strip(LAYOUT);

    // The guard throws Next's redirect signal, so the body is never
    // produced for an unauthorised visitor rather than produced and
    // hidden.
    expect(code.indexOf("requireRoleOrRedirect")).toBeLessThan(
      code.indexOf("return ("),
    );
  });

  it("re-guards on the page itself, so moving it cannot unguard it", () => {
    expect(strip(DASHBOARD)).toContain(
      'requireRoleOrRedirect(appLocale, "TRADER")',
    );
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

  /**
   * THE WORKSPACE FRAME, NOT THE STOREFRONT'S.
   *
   * The segment used to wrap itself in `AppShell` — the marketplace
   * header, the category bar and the public footer. A buyer working
   * through orders is not shopping, and this batch replaced that chrome
   * with the control panel's: a navy rail and a white bar, the same
   * ones the console wears. The theme and the direction still come from
   * the locale layout above, which both shells sit inside.
   */
  it("wraps the segment in the portal chrome at the layout", () => {
    // Through the portal's OWN client entry, which is where the nav map
    // is bound. A layout that passed the map itself would be handing a
    // Lucide icon — a function — across the server boundary, and React
    // refuses to serialise one: every request 500s.
    expect(strip(LAYOUT)).toContain("<TraderChrome");
    expect(strip(read("components/trader/trader-chrome.tsx"))).toContain(
      "<PortalChrome",
    );
  });

  it("no longer dresses the workspace as a storefront", () => {
    expect(strip(LAYOUT)).not.toContain("<AppShell");
  });
});

describe("trader reads never come from a cache", () => {
  it("marks every request no-store", () => {
    const code = strip(TRADER_DATA);
    const requests = code.match(/apiClient\.get<[^>]*>\([^)]*\)/gs) ?? [];

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests)
      expect(request).toContain('cache: "no-store"');
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
  /**
   * THE NAVIGATION THE CONSOLE WEARS, bound to the buyer's own map.
   *
   * The shared portal navigation, across the top: navy
   * from the identity tokens, a lighter panel behind the current page
   * with an accent marker down its leading edge, Lucide icons, and a
   * drawer at phone widths. The RENDERER is shared with the console and
   * the supplier; the DESTINATIONS are not, and cannot be — the rail
   * draws the map it is handed and knows of no other.
   */
  const PAGE_LABELS: Record<string, string> = {};
  for (const page of portalPages(TRADER_PORTAL_MAP))
    PAGE_LABELS[page.key] = `page:${page.key}`;

  const GROUP_LABELS: Record<string, string> = {};
  for (const group of TRADER_PORTAL_MAP.groups)
    GROUP_LABELS[group.key] = `group:${group.key}`;

  const LABELS = {
    navLabel: "تنقل لوحة التحكم",
    closeMenu: "إغلاق القائمة",
    openMenu: "فتح القائمة",
    groupNames: GROUP_LABELS,
    pageNames: PAGE_LABELS,
  };

  const MAP = TRADER_PORTAL_MAP;

  /**
   * Puts every destination in the document at once.
   *
   * THROUGH THE PHONE PANEL, because only one group's panel is open at
   * a time on a wide screen — that is the design, not a limitation, and
   * opening them in turn would only ever leave the last one mounted.
   * The phone panel lists every group and every page together, so it is
   * the honest way to walk the whole map.
   */
  async function openEveryGroup(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId("portal-menu-button"));
  }

  /** Opens the one group holding a page, for a case about that page. */
  async function openGroupOf(
    user: ReturnType<typeof userEvent.setup>,
    pageKey: string,
  ) {
    const group = MAP.groups.find((g) =>
      g.pages.some((page) => page.key === pageKey),
    );
    if (group) await user.click(screen.getByTestId(`nav-group-${group.key}`));
  }

  function renderNav(pathname = "/ar-SA/trader") {
    nav.pathname = pathname;
    return render(
      <PortalTopNav
        basePath="/ar-SA/trader"
        map={TRADER_PORTAL_MAP}
        labels={LABELS}
        pathname={pathname}
      />,
    );
  }

  it("is a landmark with an accessible name", () => {
    renderNav();

    expect(
      screen.getByRole("navigation", { name: "تنقل لوحة التحكم" }),
    ).toBeInTheDocument();
  });

  it("carries no portal name of its own", () => {
    // The rail printed one in its head. The mark in the white bar above
    // is the platform's name, and a second name beneath it was what
    // made one product read as three.
    renderNav();

    expect(screen.queryByTestId("control-panel-name")).toBeNull();
  });

  it("uses links for navigation, never click handlers on plain elements", () => {
    renderNav();

    expect(
      screen.getByRole("link", { name: /page:dashboard/ }),
    ).toHaveAttribute("href", "/ar-SA/trader");
  });

  it("builds every href from the portal root and the segment", async () => {
    const user = userEvent.setup();
    renderNav();
    await openEveryGroup(user);

    for (const page of portalPages(TRADER_PORTAL_MAP)) {
      const link = screen.getByTestId(`nav-page-${page.key}`);
      const expected = page.segment
        ? `/ar-SA/trader/${page.segment}`
        : "/ar-SA/trader";
      expect([page.key, link.getAttribute("href")]).toEqual([
        page.key,
        expected,
      ]);
    }
  });

  it("has a real page behind every destination it links to", () => {
    for (const page of portalPages(TRADER_PORTAL_MAP)) {
      const expected = page.segment
        ? `trader/${page.segment}/page.tsx`
        : "trader/page.tsx";
      expect(TRADER_PAGES, page.key).toContain(expected);
    }
  });

  it("names ONLY the buyer's own destinations", () => {
    // The security line this batch had to hold: a shared renderer must
    // not become a way for one portal's links to reach another's
    // reader. Nothing from the console and nothing from the supplier's
    // portal can appear here.
    renderNav();

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/ar-SA\/trader(\/|$)/);
    }
  });

  it("offers no supplier-only destination", () => {
    // A buyer has no products to list, no settlements to receive and no
    // payout account of the supplier's kind.
    const keys = portalPages(TRADER_PORTAL_MAP).map((page) => page.key);

    for (const supplierOnly of [
      "products",
      "settlements",
      "bankAccount",
      "billing",
    ]) {
      expect(keys).not.toContain(supplierOnly);
    }
  });

  it("marks the current page for assistive technology AND for the eye", async () => {
    const user = userEvent.setup();
    renderNav("/ar-SA/trader/orders");
    await openGroupOf(user, "orders");

    expect(screen.getByTestId("nav-page-orders")).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The accent underline is the BAR's affordance and is drawn on the
    // group holding the page; inside the panel the page carries
    // `aria-current` and full weight. Both are checked.
    expect(screen.getByTestId("nav-page-orders").className).toContain(
      "font-semibold",
    );
  });

  it("keeps a DETAIL screen marked as its section", async () => {
    const user = userEvent.setup();
    renderNav("/ar-SA/trader/orders/abc-123");
    await openGroupOf(user, "orders");

    expect(screen.getByTestId("nav-page-orders")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("gives every destination a 44px touch target", async () => {
    const user = userEvent.setup();
    renderNav();
    await openEveryGroup(user);

    for (const page of portalPages(TRADER_PORTAL_MAP)) {
      expect(
        screen.getByTestId(`nav-page-${page.key}`).className,
        // A destination in a rail is not a control: it keeps the
        // 44px target, from `--nav-item-height` rather than from a
        // class added by hand.
      ).toContain("min-h-nav");
    }
  });

  it("offers a panel on a phone, opened and closed by one named button", async () => {
    const user = userEvent.setup();
    renderNav("/ar-SA/trader");

    const button = screen.getByTestId("portal-menu-button");
    expect(button).toHaveAttribute("aria-label", "فتح القائمة");

    await user.click(button);
    expect(screen.getByTestId("portal-nav-drawer")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-label", "إغلاق القائمة");

    await user.click(button);
    expect(screen.queryByTestId("portal-nav-drawer")).toBeNull();
  });

  it("draws nothing while the panel is shut", () => {
    renderNav("/ar-SA/trader");

    expect(screen.queryByTestId("portal-nav-drawer")).toBeNull();
  });

  it("closes the panel on Escape", async () => {
    const user = userEvent.setup();
    renderNav("/ar-SA/trader");

    await user.click(screen.getByTestId("portal-menu-button"));
    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("portal-nav-drawer")).toBeNull();
  });

  it("makes every destination a real link, not a click handler", async () => {
    const user = userEvent.setup();
    renderNav("/ar-SA/trader");

    for (const group of MAP.groups) {
      await user.click(screen.getByTestId(`nav-group-${group.key}`));
      for (const page of group.pages) {
        expect(screen.getByTestId(`nav-page-${page.key}`).tagName).toBe("A");
      }
    }
  });

  it("builds hrefs from the rendered locale, never a baked-in one", () => {
    nav.pathname = "/en-SA/trader";
    render(
      <PortalTopNav
        basePath="/en-SA/trader"
        map={TRADER_PORTAL_MAP}
        labels={LABELS}
        pathname="/en-SA/trader"
      />,
    );

    expect(screen.getByTestId("nav-page-dashboard")).toHaveAttribute(
      "href",
      "/en-SA/trader",
    );
  });

  it("names every destination and group in both locales", () => {
    const ar = JSON.parse(read("messages/ar-SA.json"));
    const en = JSON.parse(read("messages/en-SA.json"));

    for (const page of portalPages(TRADER_PORTAL_MAP)) {
      expect(ar.trader.nav[page.key], page.key).toBeTruthy();
      expect(en.trader.nav[page.key], page.key).toBeTruthy();
    }
    for (const group of TRADER_PORTAL_MAP.groups) {
      expect(ar.trader.nav.group[group.key], group.key).toBeTruthy();
      expect(en.trader.nav.group[group.key], group.key).toBeTruthy();
    }
    expect(ar.trader.nav.portalName).toBe("لوحة التحكم");
    expect(en.trader.nav.portalName).toBe("Control Panel");
    expect(ar.trader.nav.accountTypeLabel).toBe("مشتري");
  });

  it("shares the frame with the console WITHOUT sharing the session", () => {
    const layout = strip(LAYOUT);
    const entry = strip(read("components/trader/trader-chrome.tsx"));

    expect(entry).toContain("@/components/portal/portal-chrome");
    expect(layout).toContain("requireRoleOrRedirect");
    // No admin loader, guard, session or sign-out crosses over.
    expect(layout).not.toContain("admin-session");
    expect(layout).not.toContain("getAdminSession");
    expect(layout).not.toContain("admin-data");
    expect(layout).not.toContain("AdminSignOut");
  });
});

describe("the buyer's home is the market, not a dashboard", () => {
  const code = strip(DASHBOARD);
  const home = strip(read("components/home/home-content.tsx"));

  /**
   * «والصفحة الرئيسية للمشتري نفس محتوى الصفحة الرئيسية في واجهة
   * الزائر.»
   *
   * IT WAS THREE PANELS of the buyer's own figures — what needed
   * chasing, their latest orders, their unread count. Every one of
   * those is a tab away, and a buyer opening the platform is opening a
   * market. What this holds is that the two fronts really do draw the
   * SAME thing, and that nothing was deleted to arrange it.
   */
  it("draws the visitor's front door, from the one component", () => {
    expect(code).toContain("<HomeContent");
    expect(strip(read("app/[locale]/(public)/page.tsx"))).toContain("<HomeContent");

    // NOT A SECOND COPY. Two pages that agreed on the day they were
    // written is not "the same content".
    expect(code).not.toContain("loadOpportunities");
    expect(code).not.toContain("OpportunityCard");
  });

  it("keeps the one thing a visitor's front has no use for", () => {
    // The completeness banner is not content, it is a blocker being
    // announced: a buyer whose record is incomplete cannot check out.
    expect(code).toContain("<CompletenessBanner");
    expect(home).not.toContain("CompletenessBanner");
  });

  it("deletes none of what the panels used to show", () => {
    // The orders, the notifications and what needs attention are all
    // still served and still named in the row of tabs above.
    for (const page of [
      "app/[locale]/trader/orders/page.tsx",
      "app/[locale]/trader/notifications/page.tsx",
      "app/[locale]/trader/follow-up/page.tsx",
    ]) {
      expect([page, existsSync(join(ROOT, page))]).toEqual([page, true]);
    }
    const order = read("components/trader/trader-top-nav.tsx");
    for (const key of ["orders", "followUp"]) {
      expect([key, order.includes(`"${key}"`)]).toEqual([key, true]);
    }
  });

  it("still guards on the server before anything renders", () => {
    expect(code).toContain('requireRoleOrRedirect(appLocale, "TRADER")');
  });

  it("renders no invented metric or chart, and no raw HTML", () => {
    for (const fake of ["Math.random", "chart", "sparkline", "revenue", "growth", "trend"]) {
      expect(code.toLowerCase()).not.toContain(fake.toLowerCase());
      expect(home.toLowerCase()).not.toContain(fake.toLowerCase());
    }
    expect(code).not.toContain("dangerouslySetInnerHTML");
    expect(home).not.toContain("dangerouslySetInnerHTML");
  });

  it("isolates the offers read behind its own Suspense boundary", () => {
    // A failed listing read degrades to the empty state rather than to
    // an error page, and the rest of the door is drawn while it runs.
    expect((home.match(/<Suspense/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(home).toContain("<EmptyState");

    // AND THE BANNER IS NOT BEHIND ONE — that is a fix, not an
    // oversight. Measured on a hard load of the production build, in
    // both locales: its slot held `<template id="B:0">` and the banner
    // sat in `<div hidden id="S:0">` at the end of `<body>`, 0×0 and
    // never revealed. Same failure the search field spent four builds
    // in, same remedy — and its fallback was `null`, so the space was
    // empty either way while the read ran.
    expect(home).not.toContain("<Suspense fallback={null}>");
  });
});

describe("message parity for the trader namespace", () => {
  const ar = JSON.parse(read("messages/ar-SA.json"));
  const en = JSON.parse(read("messages/en-SA.json"));

  const flatten = (value: unknown, prefix = ""): string[] =>
    typeof value !== "object" || value === null
      ? [prefix]
      : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
          flatten(v, prefix ? `${prefix}.${k}` : k),
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
    expect(
      existsSync(join(appDir, "(public)", "opportunities", "page.tsx")),
    ).toBe(true);
    expect(
      existsSync(join(appDir, "(public)", "opportunities", "[id]", "page.tsx")),
    ).toBe(true);
  });

  it("adds no compatibility redirect for a path that was never published", () => {
    expect(existsSync(join(appDir, "dashboard"))).toBe(false);
  });

  it("guards every trader page through one layout", () => {
    expect(existsSync(join(appDir, "trader", "layout.tsx"))).toBe(true);
  });

  it("does not re-wrap the chrome inside a trader page", () => {
    // The layout supplies it once; a page repeating it would nest
    // sidebars, bars and skip links.
    for (const page of TRADER_PAGES) {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source, page).not.toContain("<AppShell");
      expect(source, page).not.toContain("<PortalChrome");
      expect(source, page).not.toContain("<TraderChrome");
    }
  });

  /**
   * ONE PRODUCT, ONE NAME FOR IT.
   *
   * Both company portals are called «لوحة التحكم», the same as the
   * console — the kind of account is a secondary line in the account
   * menu and nowhere else. The page headings used to read «لوحة
   * التاجر» and «لوحة المورّد», which named the same screen three ways
   * across one product.
   */
  it("names no portal after the kind of account that opens it", () => {
    for (const file of ["messages/ar-SA.json", "messages/en-SA.json"]) {
      const text = read(file);

      for (const banned of [
        "لوحة التاجر",
        "لوحة المشتري",
        "لوحة المورد",
        "لوحة المورّد",
        "Trader dashboard",
        "Supplier dashboard",
        "Buyer dashboard",
      ]) {
        expect([file, banned, text.includes(banned)]).toEqual([
          file,
          banned,
          false,
        ]);
      }
    }
  });

  it("calls both company portals «لوحة التحكم»", () => {
    const ar = JSON.parse(read("messages/ar-SA.json"));
    const en = JSON.parse(read("messages/en-SA.json"));

    for (const portal of ["trader", "supplier", "admin"] as const) {
      expect([portal, ar[portal].nav.portalName]).toEqual([
        portal,
        "لوحة التحكم",
      ]);
      expect([portal, en[portal].nav.portalName]).toEqual([
        portal,
        "Control Panel",
      ]);
    }
  });

  it("never shows the word 'trader' to a reader", () => {
    const ar = JSON.parse(read("messages/ar-SA.json"));

    expect(JSON.stringify(ar.trader)).not.toContain("trader");
    expect(JSON.stringify(ar.trader)).not.toContain("Trader");
  });
});

/**
 * «بيانات المنشأة» — no longer four read-only screens.
 *
 * WHAT CHANGED AND WHY. This section used to be an overview linking to
 * four pages — company, locations, bank account, tax profile — none of
 * which could change anything. That is why a company could not add its
 * own branch, could not name a second contact, and why a supplier
 * looking for «إضافة حساب بنكي» found a status panel with no button.
 * The four are one editable section now; the rules they held that still
 * apply are re-stated here against it.
 *
 * The tax profile keeps its own page: it is a different concern and is
 * still entered only after a supplier is approved.
 */
describe("the company section is editable, and honest about what it is not", () => {
  const account = strip(read("app/[locale]/trader/account/page.tsx"));
  const section = strip(read("components/company/company-profile-section.tsx"));
  const card = strip(read("components/company/company-record-card.tsx"));
  const panels = strip(read("components/trader/account-panels.tsx"));

  it("is the section the sidebar already points at, not a page of its own", () => {
    expect(
      TRADER_PORTAL_MAP.groups.flatMap((g) => g.pages).map((p) => p.segment),
    ).toContain("account");
  });

  it("renders the shared section rather than a portal-specific copy", () => {
    // A buyer and a supplier keep the same record at the same
    // endpoints; two copies would be two places for it to drift.
    expect(account).toContain("<CompanyProfileSection");
    expect(strip(read("app/[locale]/supplier/account/page.tsx"))).toContain(
      "<CompanyProfileSection",
    );
  });

  it("KEEPS the legal name and registration number out of the company's hands", () => {
    // They are what the platform verified the company by. Letting a
    // company edit either from its own portal would let it become a
    // different company after approval; both are changed by an
    // administrator, where the change is recorded.
    expect(card).not.toMatch(/<Input[^>]*record-legal-name/s);
    expect(card).not.toMatch(/record-cr-number[^>]*onChange/s);
  });

  it("says who does change them", () => {
    expect(card).toContain("lockedNotice");
  });

  /**
   * NO COORDINATE IS EVER A FIELD — the buyer's half of the same rule
   * the supplier section carries, restated here rather than shared so
   * that a change to one portal cannot silently pass for the other.
   *
   * It used to forbid the words outright, because the position was a
   * pasted map link. The position is now a pin on a map, so the code
   * names the numbers; what survives is that NOBODY TYPES ONE.
   */
  it("asks no one to type a coordinate, anywhere in the section", () => {
    const dir = join(ROOT, "components", "company");
    for (const file of readdirSync(dir)) {
      const source = strip(readFileSync(join(dir, file), "utf8"));
      expect([file, /<Input[^>]*(latitude|longitude)/is.test(source)]).toEqual([
        file,
        false,
      ]);
      expect([file, /labels\.(latitude|longitude)/.test(source)]).toEqual([
        file,
        false,
      ]);
    }

    // And the section itself binds no control to either number.
    expect(/<Input[^>]*(latitude|longitude)/is.test(section)).toBe(false);

    for (const catalogue of ["messages/ar-SA.json", "messages/en-SA.json"]) {
      const company = JSON.stringify(JSON.parse(read(catalogue)).company);
      expect([catalogue, /latitude|longitude/i.test(company)]).toEqual([
        catalogue,
        false,
      ]);
      expect([catalogue, company.includes("خط العرض")]).toEqual([
        catalogue,
        false,
      ]);
      expect([catalogue, company.includes("خط الطول")]).toEqual([
        catalogue,
        false,
      ]);
    }
  });

  it("can only ever mask an identifier, never trim a full one", () => {
    // The IBAN is encrypted on arrival and never comes back; the card
    // shows the last four digits because that is all the API sends.
    expect(card).toContain("ibanLast4");
    expect(card).not.toContain("slice(-4)");
    expect(panels).toMatch(/last4:\s*string/);
  });

  it("re-guards on the page itself, so moving it cannot unguard it", () => {
    expect(account).toContain('requireRoleOrRedirect(appLocale, "TRADER")');
  });

  it("adds no shell of its own", () => {
    expect(account).not.toContain("<AppShell");
    expect(account).not.toContain("<TraderChrome");
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
      expect(strip(read(`app/[locale]/${page}`))).not.toContain(
        "force-dynamic",
      );
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
    expect(en.trader.account.taxProfile.selfDeclaredNotice).toMatch(
      /not verified/i,
    );
    expect(ar.trader.account.taxProfile.selfDeclaredNotice).toContain(
      "لم تُوثَّق",
    );
  });

  it("makes no tax-invoice, ZATCA or clearance claim anywhere", () => {
    const copy = JSON.stringify({
      en: en.trader.account.taxProfile,
      ar: ar.trader.account.taxProfile,
    });
    for (const claim of [
      "ZATCA",
      "zatca",
      "clearance",
      "Clearance",
      "QR",
      "tax invoice",
      "فاتورة ضريبية",
      "هيئة الزكاة",
    ]) {
      expect(copy).not.toContain(claim);
    }
  });

  it("shows the VAT number only when the trader says they are registered", () => {
    expect(page).toContain(
      "profile.data.isVatRegistered && profile.data.vatNumber",
    );
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
  const detail = strip(read("components/opportunities/opportunity-detail.tsx"));
  const publicCard = strip(
    read("components/opportunities/opportunity-card.tsx"),
  );

  it("reads the trader endpoint, never the anonymous one", () => {
    expect(strip(TRADER_DATA)).toContain("/trader/opportunities/active?");
    expect(list).not.toContain("loadOpportunities");
    expect(detail).not.toContain("loadOpportunityDetail");
  });

  it("keeps the public card free of every TRADER-ONLY field", () => {
    // The split is still enforced by two components rather than one
    // with a `showTerms` flag — a flag is one wrong prop away from
    // printing the wrong thing on the anonymous marketplace.
    //
    // The line MOVED: a visitor now sees price, the three quantities
    // and progress, because that is what lets them judge an offer
    // before creating an account. What stays trader-only is what
    // describes the platform rather than the offer.
    for (const field of [
      "fundedQuantity",
      "sharePercentage",
      "expectedPreparationDays",
    ]) {
      expect(publicCard, field).not.toContain(field);
    }
    // The public card DOES format money now — through the shared
    // formatter, never by printing the decimal string raw, so a visitor
    // sees "287.50 ر.س." rather than "287.50 SAR".
    expect(publicCard).toContain("formatMoney");
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
    expect(list).toContain(
      'const TRADER_OPPORTUNITIES_PATH = "trader/opportunities"',
    );
    expect(list).toContain("basePath={TRADER_OPPORTUNITIES_PATH}");
  });

  it("leaves the public listing on the public base path", () => {
    const publicList = strip(
      read("app/[locale]/(public)/opportunities/page.tsx"),
    );
    expect(publicList).not.toContain("basePath=");
  });
});

describe("trader opportunity terms are displayed, never recomputed", () => {
  // «بطاقة عرض تفاصيل المنتج في صفحة الزائر عدّلها مثل عرض تفاصيل
  // المنتج في صفحة المشتري» — answered by EXTRACTION, so the four
  // cards are one component both fronts render, and the route keeps
  // only what is its own: the loads, the 404, and the composer it
  // hands to the purchase slot.
  const detail = strip(read("components/opportunities/opportunity-detail.tsx"));
  const detailPage = strip(read("app/[locale]/trader/opportunities/[id]/page.tsx"));
  // ONE CARD FOR EVERY FRONT — «لا أريد اختلافًا في شكل بطاقة المنتج
  // في الرئيسية وفي السوق أو أي صفحة تحمل منتجًا معروضًا». The buyer's
  // own card is gone; the front door's card is what every listing
  // draws, so this is the one that must obey the terms rules.
  const card = strip(read("components/opportunities/opportunity-card.tsx"));
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
      expect(source).toContain("amount={opportunity.unitPriceInclTaxAmount}");
      expect(source).toContain("<Money");
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
    expect(data).toContain(
      "export type { TraderOpportunityItem, TraderOpportunityDetail }",
    );
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
    const copy = JSON.stringify({
      ar: ar.trader.opportunities,
      en: en.trader.opportunities,
    });
    expect(en.trader.opportunities.detail.priceIncludesTax).toMatch(
      /includes VAT/i,
    );
    for (const claim of [
      "ZATCA",
      "zatca",
      "Clearance",
      "clearance",
      "tax invoice",
      "فاتورة ضريبية",
      "QR",
    ]) {
      expect(copy, claim).not.toContain(claim);
    }
  });

  it("never calls the unsold quantity available or reserved", () => {
    // It is targetQuantity − fundedQuantity, arithmetic and not a
    // reservation. Checkout's lock is the only authority.
    expect(en.trader.opportunities.unsold).toBe("Unsold quantity");
    expect(en.trader.opportunities.unsold).not.toMatch(
      /available|remaining|reserved/i,
    );
    expect(en.trader.opportunities.detail.unsoldCaveat).toMatch(
      /not a reservation/i,
    );
    expect(ar.trader.opportunities.detail.unsoldCaveat).toContain("ليست حجزًا");
    expect(detail).toContain("unsoldCaveat");
  });

  it("describes progress as quantity SOLD, never as funding or a goal", () => {
    // targetQuantity is a supply cap. Nothing unlocks at 100% — every
    // paid order is fulfilled on its own.
    const copy = JSON.stringify({
      ar: ar.trader.opportunities,
      en: en.trader.opportunities,
    });
    expect(en.trader.opportunities.sold).toMatch(/sold/i);
    for (const word of [
      "funded",
      "funding",
      "goal",
      "target reached",
      "تمويل",
      "الهدف",
    ]) {
      expect(copy, word).not.toContain(word);
    }
    expect(en.trader.opportunities.detail.progressCaveat).toMatch(
      /unlocks nothing/i,
    );
    expect(detail).toContain("progressCaveat");
  });

  it("offers the purchase composer, and posts nothing itself", () => {
    // The page is a Server Component: it renders the composer and
    // supplies the branch list, and the POST happens in the client
    // component where the browser attaches Origin and the session
    // cookie.
    expect(detailPage).toContain("<PurchaseComposer");
    expect(detail).not.toContain("checkout-sessions");
    expect(detail).not.toContain("apiClient.post");
    expect(detail).not.toContain("purchaseComingSoon");
  });

  it("fetches the branch list on the SERVER and hands it down", () => {
    // So there is no code path in which a location id comes from
    // anywhere but /companies/me/locations, which the API scopes to the
    // caller's company and filters to active rows.
    expect(detailPage).toContain("loadTraderLocations()");
    expect(detailPage).toContain("locations={locations}");
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
    expect(detailPage).toContain("result.notFound) notFound()");
    expect(strip(TRADER_DATA)).toContain('result.error.kind === "notFound"');
  });
});

describe("checkout and payment are keyed by the checkout session", () => {
  const checkout = strip(
    read("app/[locale]/trader/checkout/[checkoutSessionId]/page.tsx"),
  );
  const payment = strip(
    read("app/[locale]/trader/payment/[checkoutSessionId]/page.tsx"),
  );

  it("names the route parameter after the session, not an attempt", () => {
    // A payment-attempt id would change the URL identity the moment an
    // attempt was created, and a reload after a failed attempt would
    // land on a dead id.
    expect(TRADER_PAGES).toContain(
      "trader/checkout/[checkoutSessionId]/page.tsx",
    );
    expect(TRADER_PAGES).toContain(
      "trader/payment/[checkoutSessionId]/page.tsx",
    );
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
  const checkout = strip(
    read("app/[locale]/trader/checkout/[checkoutSessionId]/page.tsx"),
  );
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
    expect(summary).toContain("<Money");
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
  const checkout = strip(
    read("app/[locale]/trader/checkout/[checkoutSessionId]/page.tsx"),
  );
  const en = JSON.parse(read("messages/en-SA.json"));

  it("covers every status in the contract", () => {
    for (const status of [
      "LOCKED",
      "PAYMENT_PENDING",
      "EXPIRED",
      "ABANDONED",
    ]) {
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
    expect(
      checkout.slice(checkout.indexOf('case "PAYMENT_PENDING"')),
    ).not.toContain("<StartPaymentButton");
  });

  it("never calls a held quantity reserved or guaranteed", () => {
    expect(en.trader.checkout.locked.notReserved).toMatch(
      /not guaranteed until payment/i,
    );
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
  const payment = strip(
    read("app/[locale]/trader/payment/[checkoutSessionId]/page.tsx"),
  );
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
    expect(poller).toMatch(
      /if \(isPollTerminalStatus\(initialStatus\)[^)]*\) return;/,
    );
  });

  it("treats LOCKED as the end of THIS wait, though not of the session", () => {
    // Both failure paths — markAttemptFailedAndRestoreCheckout and
    // handleFailureEvent — mark the attempt FAILED and return the
    // session to LOCKED while the lock is still valid. Waiting on it
    // would poll a hundred times for a change that already happened.
    expect(poller).toContain("export function isPollTerminalStatus");
    expect(poller).toMatch(
      /isTerminalCheckoutStatus\(status\) \|\| status === "LOCKED"/,
    );
  });

  it("stops the timer and aborts in flight the moment it settles", () => {
    // Rather than relying on the effect's cleanup, which does not run
    // until unmount or a dependency change.
    expect(poller).toContain("function stopNow()");
    expect(poller).toMatch(
      /function stopNow\(\) \{[\s\S]*?clearTimeout\(timer\);[\s\S]*?controller\.abort\(\);/,
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
    expect(en.trader.payment.pending.description).toMatch(
      /confirmed by the payment provider/i,
    );
    expect(en.trader.payment.pending.doNotClose).toMatch(
      /does not affect the payment/i,
    );
  });
});

// ---------------------------------------------------------- the photograph

/**
 * «عند تسجيل الدخول باسم المشتري لا تظهر صور المنتجات».
 *
 * THE PAYLOAD WAS NEVER THE PROBLEM. `TraderOpportunityItem` extends
 * `PublicOpportunityItem` and `TraderOpportunityDetail` extends
 * `PublicOpportunityDetail`, so `imageUrl` and `thumbnailUrl` have
 * always reached a signed-in buyer — the API sends the same two routes
 * to a visitor and to a trader, and both answer 200 with a PNG.
 *
 * The two screens simply never drew them. The anonymous marketplace
 * card rendered `OpportunityImage`; the trader card did not, and the
 * trader detail — the screen «متابعة الشراء» sits on — did not either.
 * So the act of signing in made every product picture on the platform
 * disappear, which is precisely how it was reported.
 */
describe("a buyer sees the product, not just its numbers", () => {
  const card = strip(read("components/opportunities/opportunity-card.tsx"));
  const list = strip(read("app/[locale]/trader/opportunities/page.tsx"));
  const detail = strip(read("components/opportunities/opportunity-detail.tsx"));

  it("draws the thumbnail on the buyer's card", () => {
    expect(card).toContain("OpportunityImage");
    expect(card).toContain("opportunity.thumbnailUrl");
    // The list hands it the same labels the front door builds, which
    // carry the sentence for an offer with no photograph.
    expect(list).toContain("offerCardLabels(");
  });

  it("draws the full picture on the screen the purchase is made from", () => {
    expect(detail).toContain("OpportunityImage");
    expect(detail).toContain("opportunity.imageUrl");
    expect(detail).toContain("priority");
  });

  it("uses the SAME component the marketplace does", () => {
    // A second image component is a second no-image state, a second
    // aspect ratio and a second way for the grid to reflow.
    for (const source of [card, detail]) {
      expect(source).not.toMatch(/<img\b/);
      expect(source).toContain("opportunity-image");
    }
  });
});
