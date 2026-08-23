import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PortalNav } from "@/components/shell/portal-nav";
import {
  SUPPLIER_NAV_DESTINATIONS,
  SupplierNav,
  type SupplierNavKey,
} from "@/components/shell/supplier-nav";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Every supplier page, discovered from disk.
 *
 * Hardcoding this list would mean a page added later silently escapes
 * the rules below — which is exactly how one screen ends up with its
 * own AppShell, its own cache directive, or a client-side role check.
 */
function supplierPages(
  dir = join(ROOT, "app", "[locale]", "supplier"),
  prefix = "supplier"
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return supplierPages(join(dir, entry.name), `${prefix}/${entry.name}`);
    return entry.name === "page.tsx" ? [`${prefix}/page.tsx`] : [];
  });
}

const SUPPLIER_PAGES = supplierPages();

const LAYOUT = read("app/[locale]/supplier/layout.tsx");
const DASHBOARD = read("app/[locale]/supplier/page.tsx");
const ACCOUNT = read("app/[locale]/supplier/account/page.tsx");
const SUPPLIER_DATA = read("lib/supplier-data.ts");

// --------------------------------------------------------------- guard

/**
 * The guard, exercised rather than grepped.
 *
 * `redirect()` throws Next's control-flow signal in production, so the
 * mock throws too: that is what proves nothing after the call runs for
 * a visitor who fails the check, rather than the body being produced
 * and then hidden.
 */
class RedirectSignal extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}

const getSessionMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

vi.mock("@/lib/session", () => ({
  getSession: () => getSessionMock(),
  ForbiddenRoleError: class ForbiddenRoleError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

const { requireRoleOrRedirect, portalPathFor } = await import("@/lib/auth-redirects");

function sessionFor(accountType: "TRADER" | "SUPPLIER") {
  return {
    userId: "u-1",
    email: "owner@example.com",
    emailVerificationStatus: "VERIFIED",
    role: "OWNER",
    status: "ACTIVE",
    company: {
      id: "c-1",
      crNumber: "1010101010",
      legalName: "Example Supply Co.",
      accountType,
      verificationStatus: "VERIFIED",
    },
  };
}

async function redirectFrom(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.to;
    throw error;
  }
  throw new Error("expected a redirect, but the guard returned normally");
}

beforeEach(() => {
  getSessionMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the supplier segment is guarded on the server", () => {
  it("sends an unauthenticated visitor to login", async () => {
    getSessionMock.mockResolvedValue(null);

    expect(await redirectFrom(requireRoleOrRedirect("ar-SA", "SUPPLIER"))).toBe("/ar-SA/login");
  });

  it("sends a TRADER to /unauthorized, not to login", async () => {
    // Signing in again with the same account would change nothing, so
    // pointing them at a login form would be misleading.
    getSessionMock.mockResolvedValue(sessionFor("TRADER"));

    expect(await redirectFrom(requireRoleOrRedirect("ar-SA", "SUPPLIER"))).toBe(
      "/ar-SA/unauthorized"
    );
  });

  it("lets a SUPPLIER through and hands back the session", async () => {
    getSessionMock.mockResolvedValue(sessionFor("SUPPLIER"));

    const session = await requireRoleOrRedirect("ar-SA", "SUPPLIER");

    expect(session.company.accountType).toBe("SUPPLIER");
  });

  it("redirects in the visitor's own locale", async () => {
    getSessionMock.mockResolvedValue(sessionFor("TRADER"));

    expect(await redirectFrom(requireRoleOrRedirect("en-SA", "SUPPLIER"))).toBe(
      "/en-SA/unauthorized"
    );
  });

  it("routes a signed-in supplier to the segment this batch builds", async () => {
    // `portalPathFor` has always pointed here; until 8E.3 there was no
    // page behind it, so the one thing the product did with a supplier
    // account was redirect it to a 404.
    expect(portalPathFor("ar-SA", "SUPPLIER")).toBe("/ar-SA/supplier");
    expect(existsSync(join(ROOT, "app", "[locale]", "supplier", "page.tsx"))).toBe(true);
  });

  it("calls requireRoleOrRedirect for the SUPPLIER role in the layout", () => {
    expect(strip(LAYOUT)).toContain('requireRoleOrRedirect(appLocale, "SUPPLIER")');
  });

  it("guards before rendering any child", () => {
    const code = strip(LAYOUT);

    expect(code.indexOf("requireRoleOrRedirect")).toBeLessThan(code.indexOf("return ("));
  });

  it("re-guards on every page, so moving one cannot unguard it", () => {
    for (const page of SUPPLIER_PAGES) {
      expect(strip(read(`app/[locale]/${page}`)), page).toContain(
        'requireRoleOrRedirect(appLocale, "SUPPLIER")'
      );
    }
  });

  it("passes no returnTo — an untrusted one would need an allowlist", () => {
    expect(strip(LAYOUT)).not.toMatch(/requireRoleOrRedirect\([^)]*returnTo/);
    expect(strip(LAYOUT)).not.toContain("searchParams");
  });

  it("adds no role logic to middleware", () => {
    const middleware = strip(read("middleware.ts"));

    expect(middleware).not.toContain("SUPPLIER");
    expect(middleware).not.toContain("getSession");
    expect(middleware).not.toContain("requireRole");
  });

  it("protects nothing in the browser", () => {
    // A client-side check is advisory at best: the payload would already
    // have been produced by the time it ran.
    for (const page of [...SUPPLIER_PAGES.map((p) => `app/[locale]/${p}`), "app/[locale]/supplier/layout.tsx"]) {
      const source = read(page);
      expect(source, page).not.toContain('"use client"');
      expect(source, page).not.toContain("useEffect");
      expect(source, page).not.toContain("localStorage");
      expect(source, page).not.toContain("sessionStorage");
    }
  });
});

// ----------------------------------------------------------- data layer

describe("supplier reads never come from a cache", () => {
  const code = strip(SUPPLIER_DATA);

  it("marks every request no-store", () => {
    const requests = code.match(/apiClient\.get<[^>]*>\([^)]*\)/gs) ?? [];

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(request).toContain('cache: "no-store"');
  });

  it("forwards the session cookie on every private read", () => {
    const requests = code.match(/apiClient\.get<[^>]*>\([^)]*\)/gs) ?? [];

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) expect(request).toContain("cookieHeader");
  });

  it("forwards the cookie without reading or parsing it", () => {
    expect(code).toContain("cookieHeader");
    expect(code).not.toContain("JSON.parse");
    expect(code).not.toContain("jwt");
    expect(code).not.toContain("atob");
  });

  it("never opts a signed-in read into revalidation", () => {
    expect(code).not.toContain("revalidate");
    expect(code).not.toContain("force-cache");
  });

  it("uses no cache primitive that could outlive one user's request", () => {
    // React `cache()` is per-request, but unstable_cache is not — it is
    // a cross-request store and must never hold a session's data.
    expect(code).not.toContain("unstable_cache");
    expect(code).not.toContain("revalidateTag");
  });

  it("reads only paths the API actually serves", () => {
    const paths = [...code.matchAll(/`(\/[a-z0-9\-/]*)/gi)].map((m) => m[1]);

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(
        path.startsWith("/supplier/") || path.startsWith("/companies/me/"),
        path
      ).toBe(true);
    }
  });

  it("declares no field the endpoint does not send", () => {
    // The stored IBAN is encrypted and only its last four characters
    // ever reach a supplier-facing response. A declared `iban` here
    // would be a claim someone later "fixes" by making it true.
    expect(code).toContain("ibanLast4");
    expect(code).not.toMatch(/\biban\??:/);
    expect(code).not.toContain("ibanCiphertext");
    expect(code).not.toContain("ibanFingerprint");
    expect(code).not.toContain("latitude");
    expect(code).not.toContain("longitude");
  });
});

describe("private supplier routes are never statically rendered", () => {
  it("declares force-dynamic on the LAYOUT, so the whole segment inherits it", () => {
    expect(strip(LAYOUT)).toContain('export const dynamic = "force-dynamic"');
  });

  it("does not rely on each page repeating the declaration", () => {
    for (const page of SUPPLIER_PAGES) {
      expect(strip(read(`app/[locale]/${page}`)), page).not.toContain("force-dynamic");
    }
  });

  it("generates no static params for a private segment", () => {
    for (const page of [...SUPPLIER_PAGES.map((p) => `app/[locale]/${p}`), "app/[locale]/supplier/layout.tsx"]) {
      expect(strip(read(page)), page).not.toContain("generateStaticParams");
    }
  });
});

// --------------------------------------------------------------- chrome

describe("the shell is applied exactly once", () => {
  it("wraps the segment in AppShell at the layout", () => {
    expect(strip(LAYOUT)).toContain("<AppShell");
  });

  it("does not re-wrap AppShell inside a supplier page", () => {
    // The layout supplies the chrome once; a page repeating it would
    // nest headers, footers and skip links.
    for (const page of SUPPLIER_PAGES) {
      expect(strip(read(`app/[locale]/${page}`)), page).not.toContain("<AppShell");
    }
  });

  it("uses one AppShell in the whole segment, counted", () => {
    const occurrences = [
      strip(LAYOUT),
      ...SUPPLIER_PAGES.map((page) => strip(read(`app/[locale]/${page}`))),
    ]
      .join("\n")
      .match(/<AppShell/g);

    expect(occurrences).toHaveLength(1);
  });

  it("shares the nav renderer with the trader portal rather than copying it", () => {
    // Two copies of a nav that must agree on coming-soon handling,
    // badges and wrapping would be free to drift — and the drift shows
    // up as one portal 404-ing on an unbuilt destination.
    expect(read("components/shell/trader-nav.tsx")).toContain("./portal-nav");
    expect(read("components/shell/supplier-nav.tsx")).toContain("./portal-nav");
  });
});

// ------------------------------------------------------------------ nav

describe("navigation", () => {
  const LABELS: Record<SupplierNavKey, string> = {
    dashboard: "الرئيسية",
    orders: "الطلبات",
    opportunities: "الفرص",
    products: "المنتجات",
    settlements: "المستحقات",
    disputes: "النزاعات",
    replacements: "الاستبدالات",
    notifications: "الإشعارات",
    account: "الحساب",
  };

  const renderNav = (unreadCount?: number) =>
    render(
      <SupplierNav
        locale="ar-SA"
        navLabel="تنقل حساب المورّد"
        labels={LABELS}
        comingSoonLabel="قريبًا"
        unreadCount={unreadCount}
      />
    );

  it("is a landmark with an accessible name", () => {
    renderNav();

    expect(screen.getByRole("navigation", { name: "تنقل حساب المورّد" })).toBeInTheDocument();
  });

  it("uses links for navigation, never buttons", () => {
    renderNav();

    expect(screen.getByRole("link", { name: "الرئيسية" })).toHaveAttribute("href", "/ar-SA/supplier");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("links every BUILT destination and no unbuilt one", () => {
    renderNav();

    for (const destination of SUPPLIER_NAV_DESTINATIONS) {
      const label = LABELS[destination.key];
      const link = screen.queryByRole("link", { name: new RegExp(label) });

      expect([destination.key, link !== null]).toEqual([destination.key, destination.built]);
    }
  });

  it("has a real page behind every destination it links to", () => {
    // A link with no page is a 404 the reader reaches by following our
    // own menu; a page with no link is unreachable.
    for (const destination of SUPPLIER_NAV_DESTINATIONS.filter((d) => d.built)) {
      const expected = destination.segment
        ? `supplier/${destination.segment}/page.tsx`
        : "supplier/page.tsx";

      expect(SUPPLIER_PAGES, destination.key).toContain(expected);
    }
  });

  it("renders an unbuilt destination as inert text, not a link that 404s", () => {
    // Phase 8E ships every destination, so there is none left to render
    // inert. The RULE is what matters, and it is asserted directly on the
    // renderer with a synthetic unbuilt item — the day a tenth
    // destination is declared ahead of its page, this still holds.
    render(
      <PortalNav
        navLabel="nav"
        items={[{ key: "future", label: "قادم", href: null, comingSoonLabel: "قريبًا" }]}
      />
    );

    expect(screen.queryByRole("link", { name: "قادم" })).not.toBeInTheDocument();
    expect(screen.getByText("قادم").closest("span")).toHaveAttribute("aria-disabled", "true");
    // It explains itself rather than being hidden: a gap in the menu is
    // harder to understand than an item that says it is not ready.
    expect(screen.getByText("قريبًا")).toBeInTheDocument();
  });

  it("has every supplier destination built, with no coming-soon left", () => {
    renderNav();

    expect(SUPPLIER_NAV_DESTINATIONS.filter((d) => !d.built)).toHaveLength(0);
    expect(screen.queryByText("قريبًا")).not.toBeInTheDocument();
  });

  it("shows an unread badge only when there is something unread", () => {
    const { unmount } = renderNav(3);
    expect(screen.getByText("3")).toBeInTheDocument();
    unmount();

    renderNav(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("carries the unread badge on the notifications link", () => {
    renderNav(5);

    const notifications = screen.getByRole("link", { name: /الإشعارات/ });
    expect(notifications).toHaveAttribute("href", "/ar-SA/supplier/notifications");
    expect(within(notifications).getByText("5")).toBeInTheDocument();
  });

  it("keeps the badge on an item even while its screen is unbuilt", () => {
    // Knowing something is waiting matters most while the screen for it
    // is still being built. Asserted on the renderer, since no supplier
    // destination is unbuilt any more.
    render(
      <PortalNav
        navLabel="nav"
        items={[{ key: "future", label: "قادم", href: null, comingSoonLabel: "قريبًا", badge: 5 }]}
      />
    );

    const item = screen.getByText("قادم").closest("span")!;
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(within(item).getByText("5")).toBeInTheDocument();
  });

  it("wraps instead of scrolling sideways at a narrow viewport", () => {
    const { container } = renderNav();
    const list = container.querySelector("ul")!;

    // `flex-wrap` is what keeps 360px free of horizontal overflow.
    expect(list.className).toContain("flex-wrap");
    expect(list.className).not.toContain("overflow-x");
  });

  it("gives every item a 44px touch target", () => {
    const { container } = renderNav();

    const targets = container.querySelectorAll("li > a, li > span[aria-disabled]");
    expect(targets.length).toBe(SUPPLIER_NAV_DESTINATIONS.length);
    for (const target of targets) {
      expect(target.className).toContain("min-h-11");
    }
  });

  it("uses no direction-specific spacing anywhere in the segment", () => {
    // `ml-`/`mr-`/`text-left` mirror the wrong way under RTL. Logical
    // properties (`ms-`/`me-`/`ps-`/`pe-`) follow the writing direction,
    // so one set of classes is correct in both locales.
    const sources = [
      LAYOUT,
      DASHBOARD,
      read("components/shell/portal-nav.tsx"),
      read("components/shell/supplier-nav.tsx"),
      ...SUPPLIER_PAGES.map((page) => read(`app/[locale]/${page}`)),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(/className="[^"]*\b(ml|mr|pl|pr)-\d/);
      expect(source).not.toMatch(/\btext-(left|right)\b/);
    }
  });

  it("marks up the items as a list", () => {
    renderNav();

    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(
      SUPPLIER_NAV_DESTINATIONS.length
    );
  });

  it("builds hrefs from the rendered locale, never a baked-in one", () => {
    render(
      <SupplierNav
        locale="en-SA"
        navLabel="nav"
        labels={LABELS}
        comingSoonLabel="Coming soon"
      />
    );

    expect(screen.getByRole("link", { name: "الرئيسية" })).toHaveAttribute("href", "/en-SA/supplier");
  });
});

// ------------------------------------------------------------ dashboard

describe("the dashboard shows only real data", () => {
  const code = strip(DASHBOARD);

  it("renders no invented metric or chart", () => {
    for (const fake of ["Math.random", "chart", "sparkline", "revenue", "growth", "trend", "mock"]) {
      expect(code.toLowerCase()).not.toContain(fake.toLowerCase());
    }
  });

  it("reads only endpoints that exist", () => {
    for (const reader of [
      "loadFinancialReadiness",
      "loadSupplierOrders",
      "loadSupplierDisputes",
      "loadSupplierReplacements",
      "loadSupplierSettlements",
      "loadSupplierUnreadCount",
    ]) {
      expect(code, reader).toContain(reader);
    }
  });

  it("isolates each panel behind its own Suspense boundary", () => {
    expect((code.match(/<Suspense/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("gives every panel a loading, error and empty state", () => {
    expect((code.match(/<LoadingState/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((code.match(/<ErrorState/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((code.match(/<EmptyState/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("puts what needs attention before the rest", () => {
    expect(code.indexOf("NeedsAttentionPanel")).toBeLessThan(code.indexOf("FulfilmentPanel"));
    expect(code.indexOf("NeedsAttentionPanel")).toBeLessThan(code.indexOf("SettlementsPanel"));
  });

  it("shows nothing at all when nothing needs attention", () => {
    // An empty "needs attention" card would train people to ignore it.
    expect(code).toContain("if (rows.length === 0 && unchecked.length === 0) return null");
  });

  it("never reports all-clear on a category it could not read", () => {
    // A false all-clear on a fulfilment deadline is worse than an error
    // message, so an unread category is listed as unchecked.
    expect(code).toContain("unchecked.push");
    expect(code).toContain('role="alert"');
  });

  it("uses server-computed flags rather than deriving them in the UI", () => {
    expect(code).toContain("hasOverduePreparation");
    expect(code).toContain("awaitingSupplierResponse");
    expect(code).toContain("awaitingSupplierAction");
  });

  it("says when a count came from a capped page instead of the whole list", () => {
    expect(code).toContain("countedFromRecent");
    expect(code).toMatch(/total > \w+\.data\.items\.length/);
  });

  it("does no money arithmetic", () => {
    // Every amount is a server-authoritative decimal string, formatted
    // at the edge of rendering. A client that recomputes a total will
    // eventually disagree with the transfer that actually happened.
    expect(code).toContain("formatMoney");
    expect(code).not.toMatch(/netAmount\s*[+\-*/]/);
    expect(code).not.toMatch(/parseFloat|Number\(\s*\w*[Aa]mount/);
    expect(code).not.toMatch(/reduce\([^)]*[Aa]mount/);
  });

  it("renders a raw enum through a translation, never bare", () => {
    expect(code).toContain("status(`payoutOutcome.${latest.outcome}`)");
    // `${latest.outcome}` inside the message key is the correct use; a
    // bare `{latest.outcome}` in JSX would put the enum on the screen.
    expect(code).not.toMatch(/[^$]\{\s*latest\.outcome\s*\}/);
  });

  it("renders no raw HTML", () => {
    expect(code).not.toContain("dangerouslySetInnerHTML");
  });
});

// -------------------------------------------------------------- account

describe("account pages are honestly read-only", () => {
  // The section pages, without the overview that links to them.
  const accountPages = SUPPLIER_PAGES.filter(
    (page) => page.startsWith("supplier/account/") && page !== "supplier/account/page.tsx"
  );

  it("builds a page for each of the four sections", () => {
    expect(accountPages).toHaveLength(4);
  });

  it("offers no edit affordance while no write screen exists", () => {
    for (const page of ["supplier/account/page.tsx", ...accountPages]) {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source, page).not.toMatch(/<Button\b/);
      expect(source, page).not.toContain("onSubmit");
    }
  });

  it("says plainly that the pages are view-only", () => {
    expect(strip(ACCOUNT)).toContain("readOnlyNotice");
  });

  it("gives every deep page a breadcrumb back", () => {
    for (const page of accountPages) {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source, page).toContain("breadcrumbLabel");
      expect(source, page).toContain("backToAccount");
    }
  });

  it("has a real page behind every section the overview links to", () => {
    const hrefs = [...strip(ACCOUNT).matchAll(/supplier\/account\/([a-z-]+)`/g)].map((m) => m[1]);

    expect(hrefs.length).toBeGreaterThan(0);
    for (const segment of hrefs) {
      expect(SUPPLIER_PAGES, segment).toContain(`supplier/account/${segment}/page.tsx`);
    }
  });

  it("points every readiness item at a page that exists", () => {
    // Telling someone to fix something and leaving them nowhere to fix
    // it is worse than not mentioning it.
    const hrefs = [...strip(ACCOUNT).matchAll(/href:\s*"([a-z-]+)"/g)].map((m) => m[1]);

    expect(hrefs.length).toBeGreaterThanOrEqual(2);
    for (const segment of hrefs) {
      expect(SUPPLIER_PAGES, segment).toContain(`supplier/account/${segment}/page.tsx`);
    }
  });

  it("renders facts, never a JSON dump", () => {
    for (const page of accountPages) {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source, page).not.toContain("JSON.stringify");
      expect(source, page).not.toContain("<pre");
    }
  });

  it("can only ever mask an identifier, never trim a full one", () => {
    const bank = strip(read("app/[locale]/supplier/account/bank-account/page.tsx"));

    expect(bank).toContain("ibanLast4");
    expect(bank).not.toContain("slice(-4)");
    // `bankAccount.iban` is a message KEY — a label. What must not exist
    // is a full value read off the account object.
    expect(bank).not.toMatch(/account\.iban(?!Last4)/);
    expect(bank).not.toContain("ibanCiphertext");
  });

  it("makes no coordinate a primary display", () => {
    for (const page of accountPages) {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source, page).not.toContain("latitude");
      expect(source, page).not.toContain("longitude");
    }
  });

  it("gives every account read its own error and empty state", () => {
    // Three of the four read an endpoint; the company page reads /me
    // through the session and has nothing of its own to fail.
    const reading = accountPages.filter((page) => strip(read(`app/[locale]/${page}`)).includes("load"));

    expect(reading).toHaveLength(3);
    for (const page of reading) {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source, page).toContain("<ErrorState");
      expect(source, page).toContain("<EmptyState");
    }
  });

  it("treats a missing profile as an answer, not an error", () => {
    const billing = strip(read("app/[locale]/supplier/account/billing/page.tsx"));

    // `!data` renders an empty state; only `!ok` renders an error.
    expect(billing).toMatch(/!invoicing\.ok \?[\s\S]*?<ErrorState/);
    expect(billing).toMatch(/!invoicing\.data \?[\s\S]*?<EmptyState/);
  });

  it("never shows a bare status without its next step", () => {
    const bank = strip(read("app/[locale]/supplier/account/bank-account/page.tsx"));

    expect(bank).toContain("<StatusWithAction");
    expect(bank).toContain("bankAccount.action.");
  });

  it("makes no tax-invoice claim on the billing page", () => {
    // Comments stripped: the file's own documentation says these things
    // are absent, and a raw-text search would find the denial.
    const billing = strip(read("app/[locale]/supplier/account/billing/page.tsx"));

    for (const forbidden of ["ZATCA", "zatca", "qrCode", "QR", "clearance", "taxInvoice"]) {
      expect(billing, forbidden).not.toContain(forbidden);
    }
  });
});

// --------------------------------------------------------------- locale

describe("message parity for the supplier namespace", () => {
  const ar = JSON.parse(read("messages/ar-SA.json"));
  const en = JSON.parse(read("messages/en-SA.json"));

  const flatten = (value: unknown, prefix = ""): string[] =>
    typeof value !== "object" || value === null
      ? [prefix]
      : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
          flatten(v, prefix ? `${prefix}.${k}` : k)
        );

  it("ships the supplier namespace in both locales", () => {
    expect(ar.supplier).toBeDefined();
    expect(en.supplier).toBeDefined();
  });

  it("has identical keys in both", () => {
    expect(flatten(ar.supplier).sort()).toEqual(flatten(en.supplier).sort());
  });

  it("covers every nav destination in both locales", () => {
    for (const destination of SUPPLIER_NAV_DESTINATIONS) {
      expect(ar.supplier.nav[destination.key], destination.key).toBeTruthy();
      expect(en.supplier.nav[destination.key], destination.key).toBeTruthy();
    }
  });

  it("translates every enum the portal renders", () => {
    expect(Object.keys(ar.supplier.status.bankAccount).sort()).toEqual([
      "PENDING_VERIFICATION",
      "REJECTED",
      "SUPERSEDED",
      "VERIFIED",
    ]);
    expect(Object.keys(ar.supplier.status.payoutOutcome).sort()).toEqual([
      "EXECUTED",
      "ZERO_BALANCE",
    ]);
  });

  it("pairs every bank-account status with an action", () => {
    // `StatusWithAction` requires an action by construction; this
    // proves one exists for each status the API can send.
    expect(Object.keys(ar.supplier.account.bankAccount.action).sort()).toEqual(
      Object.keys(ar.supplier.status.bankAccount).sort()
    );
  });

  it("exposes no internal technical term to the reader", () => {
    const serialised = JSON.stringify([ar.supplier, en.supplier]).toLowerCase();

    for (const internal of [
      "masterorder",
      "allocation_status",
      "objectkey",
      "outbox",
      "prisma",
      "undefined",
      "null,",
    ]) {
      expect(serialised, internal).not.toContain(internal);
    }
  });

  it("never shows the word 'supplier' to an Arabic reader", () => {
    // VALUES only. Keys are field and enum names from the contracts —
    // `supplierPayableShareAmount` is one — and a reader never sees a
    // key. What must not contain the word is the text on the screen.
    const values = flatten(ar.supplier).map((key) =>
      String(key.split(".").reduce<unknown>((node, part) => (node as never)[part], ar.supplier))
    );

    for (const value of values) {
      expect(value.toLowerCase(), value).not.toContain("supplier");
    }
  });

  it("puts no English prose in the Arabic namespace", () => {
    // ICU structure is Latin by necessity — `{count, plural, one {…}}`
    // — so the argument names and keywords are stripped before the
    // check, and what remains must be the message text alone.
    const ICU =
      /[{}#]|=\d+|\b(count|company|items|name|index|price|unit|funded|target|max|min|scale|reason|quantity|delivered|total|megabytes|types|minHours|maxDays|minQuantity|maxQuantity|plural|select|selectordinal|one|two|few|many|other)\b/g;

    // Image format names. They are written in Latin in Arabic prose
    // too — "الصيغ المقبولة: JPEG" is correct, and transliterating them
    // would be worse than leaving them.
    const PROPER_NOUNS = /\b(JPEG|PNG|WebP)\b/g;

    const offenders = flatten(ar.supplier)
      .map((key) => {
        const value = key
          .split(".")
          .reduce<Record<string, unknown> | string>(
            (node, part) => (node as Record<string, unknown>)[part] as never,
            ar.supplier
          );
        return { key, text: String(value).replace(PROPER_NOUNS, " ").replace(ICU, " ") };
      })
      .filter((entry) => /[A-Za-z]/.test(entry.text));

    expect(offenders).toEqual([]);
  });

  it("shows no raw enum value as message TEXT", () => {
    // Enum names are keys here, which is correct. A SCREAMING_CASE
    // value would mean a status reaching the reader undecoded.
    const values = flatten(ar.supplier).map((key) =>
      String(
        key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], ar.supplier)
      )
    );

    // Underscore-separated, which is the shape every enum in this
    // product actually has — PENDING_VERIFICATION, ZERO_BALANCE,
    // ACTION_REQUIRED. A bare run of capitals would also flag JPEG.
    for (const value of values) {
      expect(value, value).not.toMatch(/\b[A-Z]+_[A-Z_]+\b/);
    }
  });
});

// -------------------------------------------------------------- routing

describe("routing: a real segment, not a route group", () => {
  const appDir = join(ROOT, "app", "[locale]");

  it("serves the dashboard at /supplier itself, not /supplier/dashboard", () => {
    expect(existsSync(join(appDir, "supplier", "page.tsx"))).toBe(true);
    expect(existsSync(join(appDir, "supplier", "dashboard"))).toBe(false);
  });

  it("leaves no (supplier) route group behind", () => {
    const groups = readdirSync(appDir).filter((entry) => entry.startsWith("("));

    expect(groups).not.toContain("(supplier)");
  });

  it("guards every supplier page through one layout", () => {
    expect(existsSync(join(appDir, "supplier", "layout.tsx"))).toBe(true);
    expect(
      readdirSync(join(appDir, "supplier"), { withFileTypes: true }).filter(
        (entry) => entry.isFile() && entry.name === "layout.tsx"
      )
    ).toHaveLength(1);
  });

  it("keeps the trader segment untouched and separate", () => {
    expect(existsSync(join(appDir, "trader", "page.tsx"))).toBe(true);

    // No supplier page ever LINKS into the trader portal. Importing
    // `components/trader/account-panels` is a different thing entirely
    // and is deliberate: the presentation rules those panels encode —
    // a mask can only be a suffix, a status must carry its next step —
    // are the same rules on both sides of the marketplace.
    for (const page of SUPPLIER_PAGES) {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source, page).not.toMatch(/\$\{[a-zA-Z]+\}\/trader/);
      expect(source, page).not.toMatch(/["'`]\/[a-z-]+\/trader/);
    }
  });
});
