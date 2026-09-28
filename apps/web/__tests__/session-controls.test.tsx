import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Signing in and signing out, as the header and the portals present it.
 *
 * WHAT WAS WRONG. The top bar offered "sign in" to everybody, signed in
 * or not. There was no sign-out control anywhere outside the admin
 * console, so a company user could not leave the product at all; and
 * the public offer page invited a signed-in visitor to create a second
 * account. All three are the same defect — chrome that never asks who
 * is looking at it.
 *
 * The header is an async Server Component, so it is AWAITED and then
 * rendered. That exercises the real branch rather than grepping for
 * it: what is asserted is the control a reader actually receives.
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const getSessionMock = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/ar-SA",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

// The header's own reference data. None of it is what these tests are
// about, so each is reduced to the smallest shape that renders.
vi.mock("@/lib/marketplace-data", () => ({
  loadTaxonomy: () => Promise.resolve({ ok: true, data: [] }),
}));
vi.mock("@/lib/site-content", () => ({
  getSiteContent: () =>
    Promise.resolve({ headerNav: [], footerLinks: [], faq: [] }),
}));

const TEXTS: Record<string, string> = {
  "header.signIn": "تسجيل الدخول",
  "header.register": "تسجيل",
  "header.signInOrRegister": "دخول أو تسجيل",
  "header.signOut": "تسجيل الخروج",
  "header.signingOut": "جارٍ تسجيل الخروج…",
  "header.switchLocale": "Switch to English",
  "header.language": "اللغة",
  logoAlt: "الشعار",
  goHome: "الصفحة الرئيسية",
  "nav.home": "الرئيسية",
  "nav.viewAll": "كل الفرص",
  "nav.label": "التصنيفات",
  "nav.openCategory": "افتح {name}",
  brandFallback: "المنصة",
  skipToContent: "تخطَّ إلى المحتوى",
};

vi.mock("next-intl/server", () => ({
  getTranslations: () =>
    Promise.resolve(
      Object.assign((key: string) => TEXTS[key] ?? key, { rich: () => null }),
    ),
}));

const { PlatformTopbar, RowControls } =
  await import("@/components/shell/platform-topbar");
const { SignOutButton } = await import("@/components/auth/sign-out-button");

const BRANDING = {
  logoUrl: null,
  nameAr: null,
  nameEn: null,
  theme: null,
} as never;

const SESSION = {
  userId: "u-1",
  email: "owner@example.com",
  emailVerificationStatus: "VERIFIED",
  role: "OWNER",
  status: "ACTIVE",
  company: {
    id: "c-1",
    crNumber: "1010101010",
    legalName: "Example Co.",
    accountType: "TRADER",
    verificationStatus: "VERIFIED",
  },
  profileComplete: true,
};

async function renderHeader(locale: "ar-SA" | "en-SA" = "ar-SA") {
  // THE BAR ITSELF, not the public wrapper around it. The account
  // control lives in the one shared bar now, and `Header` is what puts
  // the category strip under it.
  const signedIn = await import("@/lib/session").then((m) => m.getSession());
  return render(
    await PlatformTopbar({
      locale,
      branding: BRANDING,
      audience: signedIn ? "company" : "visitor",
    }),
  );
}

beforeEach(() => {
  getSessionMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ------------------------------------------------------- 10, 11, 14

describe("the header's account control", () => {
  it("offers a VISITOR sign in", async () => {
    getSessionMock.mockResolvedValue(null);
    await renderHeader();

    const link = screen.getByTestId("header-sign-in");
    expect(link).toHaveTextContent("تسجيل الدخول");
    expect(link).toHaveAttribute("href", "/ar-SA/login");
    expect(screen.queryByTestId("sign-out")).toBeNull();
  });

  it("offers a SIGNED-IN user sign out, in the same place", async () => {
    getSessionMock.mockResolvedValue(SESSION);
    await renderHeader();

    expect(screen.getByTestId("sign-out")).toHaveTextContent("تسجيل الخروج");
    expect(screen.queryByTestId("header-sign-in")).toBeNull();
  });

  it("carries an exit icon on the sign-out control", async () => {
    getSessionMock.mockResolvedValue(SESSION);
    const { container } = await renderHeader();

    const icon = screen.getByTestId("sign-out").querySelector("svg");
    expect(icon).not.toBeNull();
    // Decorative: the word beside it carries the meaning, so an
    // announced icon would be read twice.
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(container).toBeTruthy();
  });

  it("shows a signed-in user NO way to register", async () => {
    getSessionMock.mockResolvedValue(SESSION);
    const { container } = await renderHeader();

    expect(container.querySelector('a[href*="/register"]')).toBeNull();
    expect(container.textContent).not.toMatch(/إنشاء حساب/);
  });

  it("wears the same shape either way, so the bar does not jump", async () => {
    getSessionMock.mockResolvedValue(null);
    const visitor = await renderHeader();
    const visitorClass = screen.getByTestId("header-sign-in").className;
    visitor.unmount();

    getSessionMock.mockResolvedValue(SESSION);
    await renderHeader();

    expect(screen.getByTestId("sign-out").className).toBe(visitorClass);
  });

  it("works in English as well as Arabic", async () => {
    TEXTS["header.signOut"] = "Sign out";
    getSessionMock.mockResolvedValue(SESSION);
    await renderHeader("en-SA");

    expect(screen.getByTestId("sign-out")).toHaveTextContent("Sign out");
    TEXTS["header.signOut"] = "تسجيل الخروج";
  });
});

describe("the public row's compact actions", () => {
  it("offers one account entry beside the language action", async () => {
    const { container } = render(
      await RowControls({ locale: "ar-SA", audience: "visitor" }),
    );

    const signIn = screen.getByTestId("header-sign-in");
    const locale = screen.getByTestId("locale-switch");

    expect(signIn).toHaveAttribute("href", "/ar-SA/login");
    expect(signIn).toHaveTextContent("دخول أو تسجيل");
    expect(screen.queryByTestId("header-register")).toBeNull();

    for (const control of [signIn, locale]) {
      expect(control.className).toContain("h-9");
      expect(control.className).toContain("rounded-control");
      expect(control.className).toContain("bg-primary");
      expect(control.className).toContain("text-primary-foreground");
    }

    expect(signIn.querySelector("svg")).toBeNull();
    expect(locale.querySelector("svg")).not.toBeNull();
    expect(locale).toHaveAccessibleName("Switch to English");
    expect(locale).toHaveTextContent("");
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });
});

// ----------------------------------------------------------- 12, 13

describe("signing out", () => {
  let replaced: string[];

  beforeEach(() => {
    replaced = [];
    // jsdom refuses a real navigation, so the one thing this component
    // does to leave is captured rather than performed.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        replace: (to: string) => replaced.push(to),
        href: "http://localhost/ar-SA/trader",
      },
    });
  });

  function renderButton(homeHref = "/ar-SA") {
    return render(
      <SignOutButton
        homeHref={homeHref}
        label="تسجيل الخروج"
        working="جارٍ…"
      />,
    );
  }

  it("ENDS THE SERVER SESSION, rather than only navigating away", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderButton();

    await userEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/api/v1/auth/logout");
    expect(init.method).toBe("POST");
    // The HttpOnly cookie has to travel, or the server cannot know
    // which session to delete.
    expect(init.credentials).toBe("include");
  });

  it("returns to the home page in the CURRENT locale, not to login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    renderButton("/ar-SA");

    await userEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => expect(replaced).toEqual(["/ar-SA"]));
  });

  it("returns to the English home page from the English site", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    renderButton("/en-SA");

    await userEvent.click(screen.getByTestId("sign-out"));

    await waitFor(() => expect(replaced).toEqual(["/en-SA"]));
  });

  it("leaves even when the logout request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    renderButton();

    await userEvent.click(screen.getByTestId("sign-out"));

    // Stranding somebody on a portal they believe they have left is
    // worse than sending them to a page that will tell them the truth.
    await waitFor(() => expect(replaced).toEqual(["/ar-SA"]));
  });

  it("discards the whole document rather than doing a client navigation", () => {
    // A router navigation keeps the running React tree, its module
    // state and Next's cache of already-fetched pages — so the portal
    // could be re-shown from memory without the server being asked.
    const source = read("components/auth/sign-out-button.tsx");

    expect(source).toContain("window.location.replace(homeHref)");
    expect(source).not.toMatch(/router\.(replace|push)\(/);
    // `replace`, not `assign`: the portal must not remain the entry
    // the Back button returns to.
    expect(source).not.toContain("location.assign");
  });
});

// --------------------------------------------------- 13, the guard

describe("what stops the Back button restoring a portal", () => {
  const REDIRECTS = read("lib/auth-redirects.ts");

  it("guards the portals on the SERVER, per request", () => {
    // The protection is not the button. It is that every guarded page
    // is produced per request behind `requireRoleOrRedirect`, so a
    // Back that re-fetches the page meets a guard with no session.
    for (const layout of [
      "app/[locale]/trader/layout.tsx",
      "app/[locale]/supplier/layout.tsx",
    ]) {
      const source = read(layout);
      expect(source).toContain('export const dynamic = "force-dynamic"');
      expect(source).toContain("requireRoleOrRedirect(appLocale,");
    }
  });

  it("sends a visitor with no session to login", () => {
    expect(REDIRECTS).toContain(
      "if (!session) redirect(loginPath(locale, returnTo));",
    );
  });

  it("reads every guarded page with no-store, so nothing is served from a cache", () => {
    const session = read("lib/session.ts");

    expect(session).toContain('cache: "no-store"');
  });
});

// ------------------------------------------- 12, the portal menus

describe("sign out lives in the ONE bar, for every audience", () => {
  it("is not buried in a portal menu any more", () => {
    // It used to be inside an account dropdown each portal assembled
    // for itself — the same act, in a different place, behind a
    // different number of clicks depending on where a reader was. The
    // owner's rule: «يتحول زر تسجيل الدخول نفسه إلى زر تسجيل الخروج»,
    // in one place, everywhere.
    //
    // THAT PLACE IS NO LONGER A BAR in three of the four fronts —
    // «احذف الشريط العلوي واعتبر الألسنة هي الشريط العلوي في الثلاث
    // واجهات». It is the far end of the row of tabs, and it is still
    // ONE component: `RowControls`, dressed from the same constants
    // `PlatformTopbar` dresses its own from, in the same file.
    for (const layout of [
      "app/[locale]/trader/layout.tsx",
      "app/[locale]/supplier/layout.tsx",
    ]) {
      const source = read(layout);

      expect(source).not.toContain("<SignOutButton");
      expect(source).not.toContain("accountMenu");
      expect(source).toContain("<RowControls");
      // AND NOT A SECOND ONE ABOVE IT.
      expect(source).not.toContain("<PlatformTopbar");
    }

    // The console keeps its bar, and its bar keeps the control.
    expect(read("components/admin/control-panel-shell.tsx")).toContain(
      "PlatformTopbar",
    );
  });

  it("ends the right session for each audience, decided in ONE place", () => {
    // The console holds `asid` and the two company portals `sid`. The
    // bar picks, so a caller cannot hand it the wrong one.
    const bar = read("components/shell/platform-topbar.tsx");

    expect(bar).toContain('audience === "admin" ? (');
    expect(bar).toContain("<AdminSignOut");
    expect(bar).toContain("<SignOutButton");
  });

  it("lands on the PUBLIC site in the current language, from all three", () => {
    // The console used to return to `/{locale}/admin`, which shows the
    // sign-in form again — leaving looked like failing to.
    const bar = read("components/shell/platform-topbar.tsx");
    expect(bar).toContain("const homeHref = `/${locale}`;");

    for (const control of [
      "components/auth/sign-out-button.tsx",
      "components/admin/admin-sign-out.tsx",
    ]) {
      const source = read(control);
      expect(source).toContain("window.location.replace(homeHref)");
    }
  });

  it("is still present in the admin console", () => {
    const source = read("components/admin/admin-sign-out.tsx");

    expect(source).toContain('apiClient.post("/admin/auth/logout")');
    expect(source).toContain("SignOutIcon");
  });

  it("sits outside the navigation entirely, not among the destinations", () => {
    // A button that ends the session sitting among the links invites
    // the wrong press, and a screen reader should not count it as one
    // of the portal's pages.
    //
    // IT USED TO BE A POSITION CHECK inside one nav component — the
    // sign-out came after the list rather than in it. It is a stronger
    // rule now: the navigation contains no sign-out at all. Ending a
    // session is the white bar's business, and the bar is the one place
    // that decides WHICH session to end.
    const nav = read("components/portal/portal-top-nav.tsx");

    expect(nav).not.toContain("SignOut");
    expect(nav).not.toContain("logout");
    expect(read("components/shell/platform-topbar.tsx")).toContain(
      "<SignOutButton",
    );
  });
});
