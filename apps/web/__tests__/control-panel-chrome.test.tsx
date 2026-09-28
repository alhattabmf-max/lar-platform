import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ControlPanelChrome } from "@/components/admin/control-panel-chrome";
import { ContextualHelpPanel } from "@/components/admin/contextual-help-panel";
import { Breadcrumbs } from "@/components/admin/breadcrumbs";
import {
  CONTROL_PANEL_GROUPS,
  CONTROL_PANEL_PAGES,
} from "@/components/admin/control-panel-nav";

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Source, for the rules that are about structure rather than render. */
const read = (relative: string) =>
  readFileSync(join(process.cwd(), relative), "utf8");

/**
 * The frame's behaviour: what opens, what closes, and what a reader who
 * cannot see it is told.
 *
 * `usePathname` is bound at import time, so a per-test `doMock` arrives
 * too late. A hoisted holder lets each test set the address before the
 * sidebar renders.
 */
const nav = vi.hoisted(() => ({ pathname: "/ar-SA/admin/companies" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  // The language switch inside the bar keeps the query across a change.
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: { post: vi.fn().mockResolvedValue({}) },
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
}));

const GROUP_NAMES: Record<string, string> = {};
for (const group of CONTROL_PANEL_GROUPS)
  GROUP_NAMES[group.key] = `group:${group.key}`;

const PAGE_NAMES: Record<string, string> = {};
for (const page of CONTROL_PANEL_PAGES)
  PAGE_NAMES[page.key] = `page:${page.key}`;

const LABELS = {
  navLabel: "تنقل لوحة التحكم",
  closeMenu: "إغلاق القائمة",
  openMenu: "فتح القائمة",
  groupNames: GROUP_NAMES,
  pageNames: PAGE_NAMES,
};

/**
 * THE CONSOLE'S WHOLE FRAME, composed.
 *
 * WHY THIS EXISTS. The three portals now share one chrome, and the
 * thing that binds a portal's destinations to it is a `"use client"`
 * entry that imports its own map. Get that wrong — hand the map across
 * the server boundary instead — and every request 500s with
 * «Functions cannot be passed directly to Client Components», because a
 * Lucide icon is a function. TypeScript passes. `next build`
 * prerenders 123 pages. Only a request finds it.
 *
 * The buyer's and the supplier's portals are checked against a running
 * server. The console cannot be, without an operator's credentials, so
 * its composition is exercised here instead: the same components, the
 * same props, assembled the same way.
 */
describe("the console's frame, assembled", () => {
  const TOPBAR = {
    openMenu: "فتح القائمة",
    switchLocale: "التبديل إلى الإنجليزية",
    accountMenu: "قائمة الحساب",
    help: "المساعدة",
    signOut: "تسجيل الخروج",
    signOutWorking: "جارٍ…",
    twoFactorMissing: "التحقق بخطوتين غير مُفعّل",
  };

  function renderChrome(pathname = "/ar-SA/admin/companies") {
    nav.pathname = pathname;
    return render(
      <ControlPanelChrome
        basePath="/ar-SA/admin"
        nav={LABELS}
        topbar={{ help: TOPBAR.help }}
        // THE MARK AND THE CONTROLS ARRIVE RENDERED, because they are
        // server components the layout builds. Stand-ins are enough:
        // what this file tests is the frame around them.
        brand={<div data-testid="brand-mark" />}
        controls={<div data-testid="row-controls" />}
        mobileControls={<div data-testid="row-controls-narrow" />}
        help={{ title: "المساعدة", close: "إغلاق", empty: "لا يوجد محتوى" }}
        breadcrumbLabel="مسار التنقل"
      >
        <p>محتوى الصفحة</p>
      </ControlPanelChrome>,
    );
  }

  it("renders the navigation, the bar and the page together", () => {
    renderChrome();

    // ACROSS THE TOP, not down the side. The rail took a fifth of the
    // width from every table on every screen, and a console is where
    // wide tables are read.
    // THE ROW OF SECTIONS, in the platform's own shape — «اعتمدها
    //  مع الواجهات الثلاث في التصميم».
    expect(screen.getByTestId("portal-top-nav")).toBeInTheDocument();

    // AND THE MARK AND THE CONTROLS STAND IN IT rather than in a bar
    // above it. The console was the last front still wearing
    // `PlatformTopbar`.
    // TWO OF EACH, and that is the arrangement rather than a fault:
    // the wide row and the narrow one are both in the markup and the
    // stylesheet shows one — see `FolderTabNav`.
    expect(screen.getAllByTestId("brand-mark").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId(/row-controls/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("platform-topbar")).toBeNull();
    expect(screen.getByText("محتوى الصفحة")).toBeInTheDocument();
  });

  it("draws only the CONSOLE's destinations", () => {
    renderChrome();

    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      // Every destination is under the console's own root — in EITHER
      // locale, because the language switch points at this same screen
      // in the other one.
      if (href.startsWith("#")) continue;
      expect(href).toMatch(/^\/(ar|en)-SA\/admin(\/|$)/);
    }
  });

  it("keeps the help control, which only this portal has", () => {
    renderChrome();

    expect(screen.getByTestId("control-panel-help-button")).toBeInTheDocument();
  });

  it("carries NO notification bell, because an administrator has none", () => {
    // The notification tables are keyed to a company and to a `User`,
    // and an administrator is neither.
    renderChrome();

    expect(screen.queryByTestId("portal-notifications")).toBeNull();
  });

  it("assembles no account control of its own any more", () => {
    // The console built an account button, a dropdown, the operator's
    // email and its own sign-out. All four were a fourth top bar. What
    // ends WHICH session is decided once, in `PlatformTopbar`, so this
    // frame cannot pick the wrong one — it no longer picks at all.
    renderChrome();

    expect(screen.queryByTestId("control-panel-account-button")).toBeNull();
    expect(screen.queryByTestId("control-panel-email")).toBeNull();

    // WHAT ENDS WHICH SESSION is still decided once, in the shared
    // controls, so this frame cannot pick the wrong one — it no
    // longer picks at all.
    const bar = read("components/shell/platform-topbar.tsx");
    expect(bar).toContain("<AdminSignOut");
    expect(bar).toContain('audience === "admin"');
  });

  it("draws NO trail on any screen", () => {
    // «ألغِ التعليمات ذي لأنها شرح ولا أحتاج شرح… صحيح، في جميع
    //  الصفحات.»
    //
    // IT SAID WHAT THE ROW UNDER THE RULE SAYS: which section is
    // open, and which of its screens this is. On the orders screen
    // the chrome and the page each drew one, so the console showed
    // both at once — «هنا أنت مكرّر العناوين».
    for (const path of ["/ar-SA/admin", "/ar-SA/admin/companies"]) {
      renderChrome(path);
      expect([
        path,
        screen.queryByRole("navigation", { name: "مسار التنقل" }),
      ]).toEqual([path, null]);
      cleanup();
    }
  });
});
describe("the breadcrumb", () => {
  it("names the trail and marks the last entry as the current page", () => {
    render(
      <Breadcrumbs
        label="مسار التنقل"
        items={[{ label: "السوق" }, { label: "المنشآت" }]}
      />,
    );

    const trail = screen.getByTestId("breadcrumbs");
    expect(trail).toHaveAttribute("aria-label", "مسار التنقل");
    expect(within(trail).getByText("المنشآت")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("never links the page the reader is already on", () => {
    render(
      <Breadcrumbs
        label="Breadcrumb"
        items={[
          { label: "Market", href: "/x" },
          { label: "Organizations", href: "/y" },
        ]}
      />,
    );

    // An anchor to here is a control that does nothing.
    const links = within(screen.getByTestId("breadcrumbs")).queryAllByRole(
      "link",
    );
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("Market");
  });

  it("draws nothing when there is no trail", () => {
    render(<Breadcrumbs label="x" items={[]} />);

    expect(screen.queryByTestId("breadcrumbs")).toBeNull();
  });
});

describe("the help panel", () => {
  const HELP = {
    title: "المساعدة",
    close: "إغلاق المساعدة",
    empty: "لا يتوفر دليل لهذه الصفحة حاليًا.",
  };

  it("says plainly when there is no guide, rather than inventing one", () => {
    // Operating instructions written here would be a second, unversioned
    // manual that goes stale the first time the screen changes.
    render(
      <ContextualHelpPanel
        open
        onClose={vi.fn()}
        labels={HELP}
        pageName="المنشآت"
        body={null}
      />,
    );

    expect(screen.getByTestId("help-empty").textContent).toBe(HELP.empty);
    expect(screen.queryByTestId("help-body")).toBeNull();
  });

  it("names the screen it is about", () => {
    render(
      <ContextualHelpPanel
        open
        onClose={vi.fn()}
        labels={HELP}
        pageName="المنشآت"
        body={null}
      />,
    );

    expect(screen.getByTestId("contextual-help-panel").textContent).toContain(
      "المنشآت",
    );
  });

  it("is a dialog, and says so", () => {
    render(
      <ContextualHelpPanel
        open
        onClose={vi.fn()}
        labels={HELP}
        pageName="x"
        body={null}
      />,
    );

    const panel = screen.getByTestId("contextual-help-panel");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-modal", "true");
    expect(panel).toHaveAttribute("aria-label", HELP.title);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <ContextualHelpPanel
        open
        onClose={onClose}
        labels={HELP}
        pageName="x"
        body={null}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("takes focus when it opens", () => {
    render(
      <ContextualHelpPanel
        open
        onClose={vi.fn()}
        labels={HELP}
        pageName="x"
        body={null}
      />,
    );

    // Otherwise the next Tab walks through the page behind it.
    expect(document.activeElement).toBe(screen.getByTestId("help-close"));
  });

  it("renders approved content when there is some", () => {
    render(
      <ContextualHelpPanel
        open
        onClose={vi.fn()}
        labels={HELP}
        pageName="x"
        body="محتوى معتمد"
      />,
    );

    expect(screen.getByTestId("help-body").textContent).toBe("محتوى معتمد");
    expect(screen.queryByTestId("help-empty")).toBeNull();
  });

  it("draws nothing at all while shut", () => {
    render(
      <ContextualHelpPanel
        open={false}
        onClose={vi.fn()}
        labels={HELP}
        pageName="x"
        body={null}
      />,
    );

    expect(screen.queryByTestId("contextual-help-panel")).toBeNull();
    expect(screen.queryByTestId("help-scrim")).toBeNull();
  });
});
