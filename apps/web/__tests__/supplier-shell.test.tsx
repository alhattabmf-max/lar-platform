import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PortalTopNav } from "@/components/portal/portal-top-nav";
import { portalPages } from "@/components/portal/portal-nav";
import { SUPPLIER_PORTAL_MAP } from "@/components/supplier/supplier-portal-nav";

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
  prefix = "supplier",
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return supplierPages(join(dir, entry.name), `${prefix}/${entry.name}`);
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

const nav = vi.hoisted(() => ({ pathname: "/ar-SA/supplier" }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
  usePathname: () => nav.pathname,
}));

vi.mock("@/lib/session", () => ({
  getSession: () => getSessionMock(),
  ForbiddenRoleError: class ForbiddenRoleError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

const { requireRoleOrRedirect, portalPathFor } =
  await import("@/lib/auth-redirects");

function sessionFor(
  accountType: "TRADER" | "SUPPLIER",
  profileComplete = true,
) {
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
    // Defaults to FINISHED, because that is the ordinary case these
    // tests are about. The unfinished case has its own test below.
    profile: {
      complete: profileComplete,
      missing: profileComplete ? [] : ["mainBranch"],
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

    expect(await redirectFrom(requireRoleOrRedirect("ar-SA", "SUPPLIER"))).toBe(
      "/ar-SA/login",
    );
  });

  it("sends a TRADER to /unauthorized, not to login", async () => {
    // Signing in again with the same account would change nothing, so
    // pointing them at a login form would be misleading.
    getSessionMock.mockResolvedValue(sessionFor("TRADER"));

    expect(await redirectFrom(requireRoleOrRedirect("ar-SA", "SUPPLIER"))).toBe(
      "/ar-SA/unauthorized",
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
      "/en-SA/unauthorized",
    );
  });

  it("routes a signed-in supplier to the segment this batch builds", async () => {
    // `portalPathFor` has always pointed here; until 8E.3 there was no
    // page behind it, so the one thing the product did with a supplier
    // account was redirect it to a 404.
    expect(portalPathFor("ar-SA", "SUPPLIER")).toBe("/ar-SA/supplier");
    expect(
      existsSync(join(ROOT, "app", "[locale]", "supplier", "page.tsx")),
    ).toBe(true);
  });

  it("LETS a supplier with no branch into the portal", async () => {
    // It used to divert them to a page of their own, which meant the
    // one screen they were allowed to see was a form. An incomplete
    // record now closes the commercial work that genuinely needs the
    // data and nothing else: the dashboard opens, says what is missing,
    // and links to the section that fixes it.
    getSessionMock.mockResolvedValue(sessionFor("SUPPLIER", false));

    const session = await requireRoleOrRedirect("ar-SA", "SUPPLIER");
    expect(session.company.accountType).toBe("SUPPLIER");
  });

  it("checks the ROLE before the profile, so a trader is still refused", async () => {
    // Otherwise a trader with no branch would be invited to complete a
    // profile for a portal they may never enter.
    getSessionMock.mockResolvedValue(sessionFor("TRADER", false));

    expect(await redirectFrom(requireRoleOrRedirect("ar-SA", "SUPPLIER"))).toBe(
      "/ar-SA/unauthorized",
    );
  });

  it("calls requireRoleOrRedirect for the SUPPLIER role in the layout", () => {
    expect(strip(LAYOUT)).toContain(
      'requireRoleOrRedirect(appLocale, "SUPPLIER")',
    );
  });

  it("guards before rendering any child", () => {
    const code = strip(LAYOUT);

    expect(code.indexOf("requireRoleOrRedirect")).toBeLessThan(
      code.indexOf("return ("),
    );
  });

  it("re-guards on every page, so moving one cannot unguard it", () => {
    for (const page of SUPPLIER_PAGES) {
      expect(strip(read(`app/[locale]/${page}`)), page).toContain(
        'requireRoleOrRedirect(appLocale, "SUPPLIER")',
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
    for (const page of [
      ...SUPPLIER_PAGES.map((p) => `app/[locale]/${p}`),
      "app/[locale]/supplier/layout.tsx",
    ]) {
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
    for (const request of requests)
      expect(request).toContain('cache: "no-store"');
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
        path,
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
      expect(strip(read(`app/[locale]/${page}`)), page).not.toContain(
        "force-dynamic",
      );
    }
  });

  it("generates no static params for a private segment", () => {
    for (const page of [
      ...SUPPLIER_PAGES.map((p) => `app/[locale]/${p}`),
      "app/[locale]/supplier/layout.tsx",
    ]) {
      expect(strip(read(page)), page).not.toContain("generateStaticParams");
    }
  });
});

// --------------------------------------------------------------- chrome

describe("the shell is applied exactly once", () => {
  /**
   * THE WORKSPACE FRAME, NOT THE STOREFRONT'S.
   *
   * The segment used to wrap itself in `AppShell` — the marketplace
   * header, the category bar and the public footer. A supplier working
   * through orders is not shopping, and this batch replaced that chrome
   * with the control panel's: a navy rail and a white bar, the same
   * ones the console wears.
   */
  it("wraps the segment in the portal chrome at the layout", () => {
    // Through the portal's OWN client entry, which is where the nav map
    // is bound. A layout that passed the map itself would be handing a
    // Lucide icon — a function — across the server boundary, and React
    // refuses to serialise one: every request 500s.
    expect(strip(LAYOUT)).toContain("<SupplierChrome");
    expect(strip(read("components/supplier/supplier-chrome.tsx"))).toContain(
      "<PortalChrome",
    );
  });

  it("no longer dresses the workspace as a storefront", () => {
    expect(strip(LAYOUT)).not.toContain("<AppShell");
  });

  it("does not re-wrap the chrome inside a supplier page", () => {
    // The layout supplies it once; a page repeating it would nest
    // sidebars, bars and skip links.
    for (const page of SUPPLIER_PAGES) {
      const source = strip(read(`app/[locale]/${page}`));
      expect(source, page).not.toContain("<AppShell");
      expect(source, page).not.toContain("<PortalChrome");
      expect(source, page).not.toContain("<SupplierChrome");
    }
  });

  it("uses one chrome in the whole segment, counted", () => {
    const occurrences = [
      strip(LAYOUT),
      ...SUPPLIER_PAGES.map((page) => strip(read(`app/[locale]/${page}`))),
    ]
      .join("\n")
      .match(/<SupplierChrome/g);

    expect(occurrences).toHaveLength(1);
  });

  it("shares the frame with the console rather than copying it", () => {
    // Two copies of a rail that must agree on the active marker, the
    // collapse, the drawer and the direction would be free to drift.
    expect(strip(read("components/supplier/supplier-chrome.tsx"))).toContain(
      "@/components/portal/portal-chrome",
    );
    expect(strip(read("components/admin/control-panel-chrome.tsx"))).toContain(
      "@/components/portal/portal-chrome",
    );
  });

  it("shares the components WITHOUT sharing the session", () => {
    // The line this batch had to hold. The company portals read `/me`
    // with the `sid` cookie through `requireRoleOrRedirect`; the
    // console reads `/admin/auth/me` with `asid`. Neither loader,
    // guard nor cookie crosses over.
    const layout = strip(LAYOUT);

    expect(layout).toContain("requireRoleOrRedirect");
    expect(layout).not.toContain("admin-session");
    expect(layout).not.toContain("getAdminSession");
    expect(layout).not.toContain("admin-data");
    expect(layout).not.toContain("AdminSignOut");
  });
});

// ------------------------------------------------------------------ nav

describe("navigation", () => {
  /**
   * THE NAVIGATION THE CONSOLE WEARS, bound to the supplier's own map.
   *
   * The shared portal navigation, across the top:
   * navy from the identity tokens, an accent underline beneath the
   * active item, Lucide icons, and one button opening a column at phone
   * widths. The RENDERER is shared with the console and the other
   * company portal; the DESTINATIONS are not, and cannot be — it draws
   * the map it is handed and knows of no other.
   */
  const PAGE_LABELS: Record<string, string> = {};
  for (const page of portalPages(SUPPLIER_PORTAL_MAP))
    PAGE_LABELS[page.key] = `page:${page.key}`;

  const GROUP_LABELS: Record<string, string> = {};
  for (const group of SUPPLIER_PORTAL_MAP.groups)
    GROUP_LABELS[group.key] = `group:${group.key}`;

  const LABELS = {
    navLabel: "تنقل لوحة التحكم",
    closeMenu: "إغلاق القائمة",
    openMenu: "فتح القائمة",
    groupNames: GROUP_LABELS,
    pageNames: PAGE_LABELS,
  };

  const MAP = SUPPLIER_PORTAL_MAP;

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

  function renderNav(pathname = "/ar-SA/supplier") {
    nav.pathname = pathname;
    return render(
      <PortalTopNav
        basePath="/ar-SA/supplier"
        map={SUPPLIER_PORTAL_MAP}
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
    ).toHaveAttribute("href", "/ar-SA/supplier");
  });

  it("builds every href from the portal root and the segment", async () => {
    const user = userEvent.setup();
    renderNav();
    await openEveryGroup(user);

    for (const page of portalPages(SUPPLIER_PORTAL_MAP)) {
      const link = screen.getByTestId(`nav-page-${page.key}`);
      const expected = page.segment
        ? `/ar-SA/supplier/${page.segment}`
        : "/ar-SA/supplier";
      expect([page.key, link.getAttribute("href")]).toEqual([
        page.key,
        expected,
      ]);
    }
  });

  it("has a real page behind every destination it links to", () => {
    // A link with no page is a 404 the reader reaches by following our
    // own menu; a page with no link is unreachable.
    for (const page of portalPages(SUPPLIER_PORTAL_MAP)) {
      const expected = page.segment
        ? `supplier/${page.segment}/page.tsx`
        : "supplier/page.tsx";
      expect(SUPPLIER_PAGES, page.key).toContain(expected);
    }
  });

  it("names ONLY the supplier's own destinations", () => {
    // The security line this batch had to hold: a shared renderer must
    // not become a way for one portal's links to reach another's
    // reader.
    renderNav();

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^\/ar-SA\/supplier(\/|$)/);
    }
  });

  it("marks the current page for assistive technology AND for the eye", async () => {
    const user = userEvent.setup();
    renderNav("/ar-SA/supplier/products");
    await openGroupOf(user, "products");

    const current = screen.getByTestId("nav-page-products");
    expect(current).toHaveAttribute("aria-current", "page");
    // Colour alone would leave the state invisible to a reader who
    // cannot separate two dark blues, so there is an accent marker too.
    // The accent underline is the BAR's affordance and is drawn on the
    // group holding the page; inside the panel the page carries
    // `aria-current` and full weight. Both are checked.
    expect(screen.getByTestId("nav-page-products").className).toContain(
      "font-semibold",
    );
  });

  it("keeps a DETAIL screen marked as its section", async () => {
    const user = userEvent.setup();
    renderNav("/ar-SA/supplier/orders/abc-123");
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

    for (const page of portalPages(SUPPLIER_PORTAL_MAP)) {
      expect(
        screen.getByTestId(`nav-page-${page.key}`).className,
        // A destination in a rail is not a control: it keeps the
        // 44px target, from `--nav-item-height` rather than from a
        // class added by hand.
      ).toContain("min-h-nav");
    }
  });

  it("makes every destination a real link, not a click handler", async () => {
    const user = userEvent.setup();
    renderNav("/ar-SA/supplier");

    for (const group of MAP.groups) {
      await user.click(screen.getByTestId(`nav-group-${group.key}`));
      for (const page of group.pages) {
        expect(screen.getByTestId(`nav-page-${page.key}`).tagName).toBe("A");
      }
    }
  });

  it("offers a panel on a phone, opened and closed by one named button", async () => {
    const user = userEvent.setup();
    renderNav("/ar-SA/supplier");

    const button = screen.getByTestId("portal-menu-button");
    expect(button).toHaveAttribute("aria-label", "فتح القائمة");

    await user.click(button);
    expect(screen.getByTestId("portal-nav-drawer")).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-label", "إغلاق القائمة");

    await user.click(button);
    expect(screen.queryByTestId("portal-nav-drawer")).toBeNull();
  });

  it("draws nothing while the panel is shut", () => {
    renderNav("/ar-SA/supplier");

    expect(screen.queryByTestId("portal-nav-drawer")).toBeNull();
  });

  it("closes the panel on Escape", async () => {
    const user = userEvent.setup();
    renderNav("/ar-SA/supplier");

    await user.click(screen.getByTestId("portal-menu-button"));
    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("portal-nav-drawer")).toBeNull();
  });

  /**
   * IT USED TO SAY "once collapsed". The rail could be narrowed to
   * icons, and the rule was that an icon with neither a name nor a
   * tooltip is a guess. There is no collapsed state on a top bar — but
   * the rule behind it is unchanged and still worth holding: no
   * destination is ever named by its icon alone.
   */
  it("names every destination in words, never by its icon alone", async () => {
    const user = userEvent.setup();
    renderNav();
    await openEveryGroup(user);

    for (const page of portalPages(SUPPLIER_PORTAL_MAP)) {
      const link = screen.getByTestId(`nav-page-${page.key}`);
      expect([page.key, link.textContent?.trim()]).toEqual([
        page.key,
        PAGE_LABELS[page.key],
      ]);
    }
  });

  it("shares the rail with the console rather than copying it", () => {
    // Two copies of a rail that must agree on the active marker, the
    // collapse and the drawer would be free to drift.
    expect(read("components/supplier/supplier-chrome.tsx")).toContain(
      "@/components/portal/portal-chrome",
    );
    expect(read("app/[locale]/admin/layout.tsx")).toContain(
      "ControlPanelShell",
    );
    expect(read("components/admin/control-panel-chrome.tsx")).toContain(
      "@/components/portal/portal-chrome",
    );
  });

  it("uses no direction-specific spacing anywhere in the segment", () => {
    // `ml-`/`mr-`/`text-left` mirror the wrong way under RTL. Logical
    // properties (`ms-`/`me-`/`ps-`/`pe-`) follow the writing direction,
    // so one set of classes is correct in both locales.
    const sources = [
      LAYOUT,
      DASHBOARD,
      read("components/portal/portal-top-nav.tsx"),
      read("components/portal/portal-chrome.tsx"),
      ...SUPPLIER_PAGES.map((page) => read(`app/[locale]/${page}`)),
    ];

    for (const source of sources) {
      expect(source).not.toMatch(/className="[^"]*\b(ml|mr|pl|pr)-\d/);
      expect(source).not.toMatch(/\btext-(left|right)\b/);
    }
  });

  it("builds hrefs from the rendered locale, never a baked-in one", () => {
    nav.pathname = "/en-SA/supplier";
    render(
      <PortalTopNav
        basePath="/en-SA/supplier"
        map={SUPPLIER_PORTAL_MAP}
        labels={LABELS}
        pathname="/en-SA/supplier"
      />,
    );

    expect(screen.getByTestId("nav-page-dashboard")).toHaveAttribute(
      "href",
      "/en-SA/supplier",
    );
  });
});

describe("the dashboard shows only real data", () => {
  const code = strip(DASHBOARD);
  const cards = strip(read("components/supplier/dashboard-cards.tsx"));
  const chart = strip(read("components/supplier/sales-chart.tsx"));
  const panels = strip(read("components/supplier/dashboard-panels.tsx"));
  const service = strip(
    readFileSync(
      join(ROOT, "..", "api", "src", "dashboard", "supplier-dashboard.service.ts"),
      "utf8",
    ),
  );

  /**
   * WHAT CHANGED, AND WHAT DID NOT.
   *
   * The page was rebuilt to the owner's approved reference: four cards,
   * a sales line, the running listings, the settlement movement, the
   * five fulfilment stages, and what needs attention. What did NOT
   * change is the rule these cases exist for — every figure is this
   * supplier's own, computed by the database, and a figure that cannot
   * be computed is said to be missing rather than drawn.
   *
   * IT IS ONE READ NOW, not six. The page used to count the LENGTHS of
   * six list responses, which answers "how many are on the first page"
   * rather than "how many are there" — which is why the old cases
   * about capped pages are gone WITH the capping, not instead of it.
   */
  it("gives the head NO row — it hands it up to the open tab's strip", () => {
    // «احذف الصف اللي أنا مصوّره وانقله للشريط حق اللسان في الرئيسية».
    // The last-updated time, the refresh and the period chooser stood
    // in a row above the cards; they are rendered into the strip now,
    // so the dashboard begins at its first figure.
    const header = strip(read("components/supplier/dashboard-header.tsx"));

    // A PORTAL, NOT A PROP THROUGH THE LAYOUT. Both controls need what
    // only this page has — the instant its figures were read, and the
    // period the reader chose — so the RENDERED row moves and the data
    // stays exactly where it is read.
    expect(header).toContain("createPortal");
    expect(header).toContain("PORTAL_STRIP_SLOT");

    // THE SLOT IS NAMED ONCE, in the strip, and imported by the page.
    const bar = read("components/portal/portal-page-bar.tsx");
    expect(bar).toContain('export const PORTAL_STRIP_SLOT = "portal-strip-slot"');
    expect(bar).toContain("id={PORTAL_STRIP_SLOT}");
    // Empty on every page that hands it nothing.
    expect(bar).toContain("empty:hidden");

    // AND THE HEADING STAYS IN THE PAGE'S OWN TREE, where a reader
    // walking the document expects the page's name.
    expect(header).toContain('<h1 className="sr-only">{labels.title}</h1>');
  });

  it("gives the head ONE row, and spends none of it on decoration", () => {
    const header = strip(read("components/supplier/dashboard-header.tsx"));

    // A SENTENCE UNDER THE TITLE. «نبض تجارتك في مكان واحد» said the
    // same words to every supplier forever — the decoration the owner
    // struck off the platform — and it pushed every figure down.
    expect(header).not.toContain("labels.subtitle");
    expect(header).not.toContain("subtitle: string");
    for (const catalogue of ["messages/ar-SA.json", "messages/en-SA.json"]) {
      const dashboard = JSON.parse(read(catalogue)).supplier.dashboard;
      expect([catalogue, dashboard.subtitle]).toEqual([catalogue, undefined]);
      // The CHART's own subtitle is a different key and stays: it names
      // what the line plots, which the card's title alone does not.
      expect([catalogue, typeof dashboard.sales.subtitle]).toEqual([
        catalogue,
        "string",
      ]);
    }
    expect(strip(DASHBOARD)).not.toContain('subtitle: t("subtitle")');

    // THE PERIOD CHOOSER WRAPPED ONTO A LINE OF ITS OWN. `Select`
    // carries `w-full`, which is right in a form column and, in this
    // wrapping toolbar, meant 100% OF THE ROW. `cn` joins classes
    // rather than merging them, so a `w-auto` on the element would
    // have lost to the skin in the stylesheet's own order — the box
    // around it is what sizes it, the same way the console's own
    // period picker does.
    expect(header).toMatch(
      /<span className="flex items-center">\s*<Select/,
    );
    expect(header).not.toMatch(/<Select[^>]*className="[^"]*w-(auto|fit)/s);
  });

  it("spends the page's vertical space by the card token, not by hand", () => {
    // MEASURED: 977px tall at 1600×900 — 77 of them past the fold —
    // and the four figures did not start until y=323. Every gap on the
    // page was 16px written as `gap-4`, where the system's own measure
    // between surfaces is 8. It is 900 and y=263 now.
    const page = strip(DASHBOARD);
    expect(page).not.toContain("gap-4");
    expect(page).toContain("gap-card-gap");
    expect(cards).not.toContain("gap-4");
  });

  it("invents no number and no trend", () => {
    for (const fake of ["Math.random", "mock", "sample", "placeholder", "dummy"]) {
      expect(code.toLowerCase(), fake).not.toContain(fake.toLowerCase());
      expect(chart.toLowerCase(), fake).not.toContain(fake.toLowerCase());
      expect(panels.toLowerCase(), fake).not.toContain(fake.toLowerCase());
    }
  });

  it("reads ONE endpoint, and it exists", () => {
    expect(code).toContain("loadSupplierDashboard");
    // The six list reads it replaced are gone from this page.
    for (const old of [
      "loadSupplierOrders",
      "loadSupplierDisputes",
      "loadSupplierReplacements",
      "loadSupplierSettlements",
    ]) {
      expect(code, old).not.toContain(old);
    }
  });

  it("draws the chart from the series and from nothing else", () => {
    // No smoothing that invents a value between two points, no
    // projection past the last one, no baseline shifted to flatter it.
    expect(chart).toContain("series.paidOrders");
    expect(chart).not.toMatch(/interpolat|smooth|extrapolat|forecast/i);
  });

  it("says it has no sales rather than drawing a flat line at zero", () => {
    // A flat line across an empty month is a chart claiming a trend.
    expect(chart).toContain("sales-chart-empty");
    expect(chart).toContain("everySold");
  });

  it("never nets refunds off the line", () => {
    // Netting makes a good week look like a bad one and gives no way
    // to tell the two apart.
    expect(chart).toContain("refundsSeparate");
    // The refund total is READ and rendered; it never enters the
    // arithmetic that produces the points.
    expect(chart).toContain("series.refunded");
    // THE POINTS COME FROM `paidOrders` ALONE. The refund total is read
    // and rendered beside the line; it never enters the arithmetic that
    // produces a point.
    expect(chart).toContain("series.paidOrders.map((p) => Number(p.value))");
    // Nothing subtracts it from anything.
    expect(chart).not.toMatch(/[-+*/]\s*Number\(series\.refunded/);
    expect(chart).not.toMatch(/refunded\s*[-+]/);
  });

  it("shows nothing at all when nothing needs attention", () => {
    // An always-full panel of zeroes trains people to ignore it.
    expect(panels).toContain("attention-clear");
    // Each row is built only when its own count is above zero.
    expect(panels).toContain("attention.ordersAwaitingPreparation > 0 &&");
    expect(panels).toContain("attention.disputesAwaitingResponse > 0 &&");
    expect(panels).toContain("attention.replacementsAwaitingAction > 0 &&");
    expect(panels).toContain("rows.length === 0");
  });

  it("draws five fulfilment stages whatever the data", () => {
    // A stage with no rows is a zero; a stage that vanished would read
    // as a stage the platform does not have.
    expect(panels).toContain("ORDER_ALLOCATION_STATUSES.map");
    expect(service).toContain("byStatus.get(status) ?? 0");
  });

  it("does no money arithmetic in the browser", () => {
    // Every amount is a server-authoritative decimal string, formatted
    // at the edge of rendering. A client that recomputes a total will
    // eventually disagree with the transfer that actually happened.
    for (const source of [cards, chart, panels]) {
      // `Money` IS that formatting — it splits the same decimal
      // string through the same module and draws the riyal symbol,
      // which no formatted string can carry.
      expect(source).toContain("<Money");
      expect(source).not.toContain("parseFloat");
      expect(source).not.toMatch(/reduce\([^)]*[Aa]mount/);
    }
  });

  it("says «no comparison» rather than «0%» when there is no previous window", () => {
    // A supplier's first month has no predecessor, and «+0%» would be
    // a claim that nothing moved.
    expect(cards).toContain("noComparison");
    expect(cards).toContain("change === null");
  });

  it("says «not paid yet» rather than a transfer of zero", () => {
    // `lastTransfer` is null until there has been one: a zero with a
    // date of "never" reads as a transfer that happened for nothing.
    expect(panels).toContain("settlements-none");
    expect(service).toContain("lastTransfer");
    expect(service).toContain(": null;");
  });

  it("scopes every figure to the company in the SESSION, never a parameter", () => {
    const controller = strip(
      readFileSync(
        join(ROOT, "..", "api", "src", "dashboard", "supplier-dashboard.controller.ts"),
        "utf8",
      ),
    );
    expect(controller).toContain("session.companyId");
    expect(controller).toContain("RequireSupplierGuard");
    // No route parameter could name another company.
    expect(controller).not.toContain("@Param");
  });

  it("reuses the console's own arithmetic rather than defining it twice", () => {
    // Two definitions of "paid orders" is how a supplier's screen comes
    // to disagree with an administrator's about the same week.
    expect(service).toContain("admin/dashboard/dashboard-period");
    expect(service).toContain("SUM(total_amount)");
  });

  it("renders no raw HTML", () => {
    for (const source of [code, cards, chart, panels]) {
      expect(source).not.toContain("dangerouslySetInnerHTML");
    }
  });
});

// -------------------------------------------------------------- account

/**
 * «بيانات المنشأة» — no longer four read-only screens.
 *
 * WHAT CHANGED AND WHY. This section was an overview linking to four
 * pages — company, locations, bank account, billing — and only the last
 * of them still exists. None of the other three could change anything,
 * which is why a supplier could not add its own branch and why one
 * looking for «إضافة حساب بنكي» found a status panel with no button.
 * They are cards inside one editable section now.
 *
 * BILLING KEEPS ITS PAGE: it is a different concern and is still
 * entered only after the supplier is approved.
 */
describe("the company section is editable, and honest about what it is not", () => {
  const section = strip(read("components/company/company-profile-section.tsx"));
  // ONE CARD NOW. The five it replaced are gone, so the rules they
  // carried are read off the one that carries them.
  const card = strip(read("components/company/company-record-card.tsx"));

  it("leaves exactly one account sub-page, and it is billing", () => {
    const accountPages = SUPPLIER_PAGES.filter(
      (page) =>
        page.startsWith("supplier/account/") &&
        page !== "supplier/account/page.tsx",
    );

    expect(accountPages).toEqual(["supplier/account/billing/page.tsx"]);
  });

  it("renders the shared section rather than a supplier-specific copy", () => {
    expect(strip(ACCOUNT)).toContain("<CompanyProfileSection");
    expect(strip(ACCOUNT)).toContain('accountType="SUPPLIER"');
  });

  it("KEEPS the legal name and registration number out of the company's hands", () => {
    // Neither is bound to an input, and no path from this card can
    // change them: an administrator does it, in the console, on the
    // record — which is what the lock beside the number says.
    expect(card).not.toMatch(/<Input[^>]*record-legal-name/s);
    expect(card).not.toMatch(/record-cr-number[^>]*onChange/s);
    expect(card).toContain("lockedNotice");
  });

  it("gives the supplier a real way to add a payout account", () => {
    // The screen this replaces rendered the account's state and nothing
    // else, while `POST companies/me/bank-account` existed all along.
    expect(card).toContain('data-testid="record-iban"');
    expect(card).toContain('apiClient.post("/companies/me/bank-account"');
  });

  it("raises no separate verification for that account", () => {
    // It is reviewed as part of the company's one request; a second,
    // independent approval would be another thing to wait on.
    // The ONE send on this card is the company's own request, at its
    // foot — not a second approval for the account alone.
    expect(
      (card.match(/verification-request/g) ?? []).length,
    ).toBe(1);
  });

  /**
   * NO COORDINATE IS EVER A FIELD.
   *
   * WHAT THIS RULE USED TO SAY, and why it changed. It used to forbid
   * the words `latitude` and `longitude` anywhere in this section at
   * all, because the position was a pasted Google Maps link and a pair
   * of numbers contradicted the one thing that screen was built
   * around. The position is now a PIN somebody drags on a map, so the
   * numbers ARE the answer and the code has to name them.
   *
   * WHAT SURVIVES IS THE PART THAT WAS ALWAYS THE POINT: nobody types
   * a coordinate. No input is bound to one, no label asks for one, and
   * neither catalogue has a word for one — a person points at their
   * own branch and the numbers are read off the map for them.
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

  it("re-guards on the page itself, and adds no shell", () => {
    expect(strip(ACCOUNT)).toContain(
      'requireRoleOrRedirect(appLocale, "SUPPLIER")',
    );
    expect(strip(ACCOUNT)).not.toContain("<AppShell");
    expect(strip(ACCOUNT)).not.toContain("<SupplierChrome");
  });
});

describe("message parity for the supplier namespace", () => {
  const ar = JSON.parse(read("messages/ar-SA.json"));
  const en = JSON.parse(read("messages/en-SA.json"));

  const flatten = (value: unknown, prefix = ""): string[] =>
    typeof value !== "object" || value === null
      ? [prefix]
      : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
          flatten(v, prefix ? `${prefix}.${k}` : k),
        );

  it("ships the supplier namespace in both locales", () => {
    expect(ar.supplier).toBeDefined();
    expect(en.supplier).toBeDefined();
  });

  it("has identical keys in both", () => {
    expect(flatten(ar.supplier).sort()).toEqual(flatten(en.supplier).sort());
  });

  it("covers every nav destination in both locales", () => {
    for (const page of portalPages(SUPPLIER_PORTAL_MAP)) {
      expect(ar.supplier.nav[page.key], page.key).toBeTruthy();
      expect(en.supplier.nav[page.key], page.key).toBeTruthy();
    }
  });

  it("names every GROUP in both locales too", () => {
    // A sidebar section with no name is a blank heading over a list.
    for (const group of SUPPLIER_PORTAL_MAP.groups) {
      expect(ar.supplier.nav.group[group.key], group.key).toBeTruthy();
      expect(en.supplier.nav.group[group.key], group.key).toBeTruthy();
    }
  });

  it("calls the portal «لوحة التحكم» in Arabic and Control Panel in English", () => {
    expect(ar.supplier.nav.portalName).toBe("لوحة التحكم");
    expect(en.supplier.nav.portalName).toBe("Control Panel");
    // The kind of account is a secondary label, not the portal's name.
    expect(ar.supplier.nav.accountTypeLabel).toBe("مورد");
    expect(en.supplier.nav.accountTypeLabel).toBe("Supplier");
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
      Object.keys(ar.supplier.status.bankAccount).sort(),
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
      String(
        key
          .split(".")
          .reduce<unknown>((node, part) => (node as never)[part], ar.supplier),
      ),
    );

    for (const value of values) {
      expect(value.toLowerCase(), value).not.toContain("supplier");
    }
  });

  it("puts no English prose in the Arabic namespace", () => {
    // ICU structure is Latin by necessity — `{count, plural, one {…}}`
    // — so the argument names and keywords are stripped before the
    // check, and what remains must be the message text alone.
    //
    // THE ARGUMENT NAMES ARE LISTED ONE BY ONE, never matched by a
    // loose pattern: `{term}` was added when the catalogue gained a
    // search, and a rule like "any lowercase word inside braces" would
    // let the next English sentence through as an argument name.
    const ICU =
      /[{}#]|=\d+|\b(count|number|company|items|name|index|price|unit|funded|target|max|min|scale|reason|quantity|delivered|total|megabytes|types|minHours|maxDays|minQuantity|maxQuantity|hours|days|mb|term|plural|select|selectordinal|one|two|few|many|other)\b/g;

    // Image format names. They are written in Latin in Arabic prose
    // too — "الصيغ المقبولة: JPEG" is correct, and transliterating them
    // would be worse than leaving them.
    const PROPER_NOUNS = /\b(JPEG|PNG|WebP)\b/g;

    // THE EXAMPLE INSIDE A FIELD THAT HOLDS ENGLISH IS WRITTEN IN
    // ENGLISH. «اسم المنتج بالإنجليزية» is answered in English, so its
    // greyed example — the one the approved reference draws — has to
    // be too: «مثال: Carton» is the example, and «مثال: كرتون» in that
    // box would be an example of the wrong thing. The exemption is
    // narrow on purpose: only a placeholder, and only one belonging to
    // an `…En` field.
    const ENGLISH_BY_DESIGN = /^listings\.form\.placeholders\.\w*En$/;

    const offenders = flatten(ar.supplier)
      .filter((key) => !ENGLISH_BY_DESIGN.test(key))
      .map((key) => {
        const value = key
          .split(".")
          .reduce<Record<string, unknown> | string>(
            (node, part) => (node as Record<string, unknown>)[part] as never,
            ar.supplier,
          );
        return {
          key,
          text: String(value).replace(PROPER_NOUNS, " ").replace(ICU, " "),
        };
      })
      .filter((entry) => /[A-Za-z]/.test(entry.text));

    expect(offenders).toEqual([]);
  });

  it("shows no raw enum value as message TEXT", () => {
    // Enum names are keys here, which is correct. A SCREAMING_CASE
    // value would mean a status reaching the reader undecoded.
    const values = flatten(ar.supplier).map((key) =>
      String(
        key
          .split(".")
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)[part],
            ar.supplier,
          ),
      ),
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
        (entry) => entry.isFile() && entry.name === "layout.tsx",
      ),
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
