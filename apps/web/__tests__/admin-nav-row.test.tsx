import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AdminTopNav } from "@/components/admin/admin-top-nav";
import { AdminSectionRow } from "@/components/admin/admin-section-row";
import {
  CONTROL_PANEL_GROUPS,
  CONTROL_PANEL_PAGES,
} from "@/components/admin/control-panel-nav";

/**
 * THE CONSOLE'S ROW OF SECTIONS.
 *
 * «بالنسبة للوحة الإدارة اعتمدها مع الواجهات الثلاث في التصميم.»
 *
 * THE SECTIONS ARE THE ROW, NOT THE SCREENS. Twenty-one destinations on
 * one line is a line nobody can scan, and the wave — which says where
 * you are by moving between names — needs names it can move between.
 * Six sections and the dashboard fit; each opens its screens in the
 * panel every other row on this platform opens.
 */
const BASE = "/ar-SA/admin";

const LABELS = {
  navLabel: "تنقل لوحة التحكم",
  openMenu: "افتح",
  closeMenu: "أغلق",
  groupNames: Object.fromEntries(
    CONTROL_PANEL_GROUPS.map((group) => [group.key, `قسم ${group.key}`]),
  ),
  pageNames: Object.fromEntries(
    CONTROL_PANEL_PAGES.map((page) => [page.key, `صفحة ${page.key}`]),
  ),
};

const draw = (pathname = BASE) =>
  render(<AdminTopNav basePath={BASE} labels={LABELS} pathname={pathname} />);

/** The wide row's names, in order, with the signature's own ids left out. */
const names = () =>
  [...document.querySelectorAll('[data-testid^="nav-row-wide-"]')]
    .map((el) => el.getAttribute("data-testid") ?? "")
    .filter((id) => !id.endsWith("-wave") && !id.endsWith("-carton"))
    .map((id) => id.replace("nav-row-wide-", ""));

describe("the console's row is its sections", () => {
  it("carries the dashboard and every section, and no screen", () => {
    draw();

    expect(names()).toEqual([
      "dashboard",
      ...CONTROL_PANEL_GROUPS.map((group) => group.key),
    ]);

    // NOT THE SCREENS. Twenty-one of them would scroll sideways past
    // twenty names to reach «سجل التدقيق».
    //
    // A SECTION AND ONE OF ITS SCREENS MAY SHARE A KEY — «الطلبات» is
    // both — so the check is that no key which is ONLY a screen made it
    // into the row.
    const sections = new Set<string>(CONTROL_PANEL_GROUPS.map((g) => g.key));
    for (const page of CONTROL_PANEL_PAGES) {
      if (page.key === "dashboard" || sections.has(page.key as string)) continue;
      expect([page.key, names().includes(page.key)]).toEqual([page.key, false]);
    }
  });

  it("opens nothing at all — the section is a plain name", () => {
    // «يُلغى الإطار المنبثق.» A floating frame had to be measured,
    // clamped, portalled past two clipping boxes and closed four
    // ways, and it covered the page it was opening.
    draw();

    const market = CONTROL_PANEL_GROUPS[0];
    const name = screen.getByTestId(`nav-row-wide-${market.key}`);

    expect(name.tagName).toBe("A");
    // A SECTION IS A HEADING WITH NO ROUTE — `/admin/market` has
    // never been one — so the name leads where the section begins.
    expect(name.getAttribute("href")).toBe(
      `${BASE}/${market.pages[0].segment}`,
    );
    expect(name.getAttribute("aria-haspopup")).toBeNull();
    expect(screen.queryByTestId("nav-row-wide-panel")).toBeNull();
  });

  it("draws the open section's screens under the rule instead", () => {
    // «تنزل تحت الشريط البرتقالي عند الضغط على اسم القسم» — and it
    // is derived from the ADDRESS, so back and forward work and a
    // shared link arrives with the row already correct.
    const market = CONTROL_PANEL_GROUPS[0];
    render(
      <AdminSectionRow
        basePath={BASE}
        labels={LABELS}
        pathname={`${BASE}/${market.pages[0].segment}`}
      />,
    );

    const row = screen.getByTestId("admin-section-row");
    const entries = [...row.querySelectorAll("a")].map(
      (a) => a.getAttribute("href") ?? "",
    );
    expect(entries).toEqual(
      market.pages.map((page) => `${BASE}/${page.segment}`),
    );
  });

  it("draws no such row on the dashboard, which belongs to no section", () => {
    // An empty row would be a rule with a gap under it.
    render(<AdminSectionRow basePath={BASE} labels={LABELS} pathname={BASE} />);

    expect(screen.queryByTestId("admin-section-row")).toBeNull();
  });

  it("says which section holds the open screen, not which href matches", () => {
    // THE TRAP THIS EXISTS FOR. The row's own rule is the longest href
    // that prefixes the path, and a section's href is its FIRST screen
    // — so «المالية» would light on `/admin/settlements` and light
    // nothing on the two screens beside it.
    const finance = CONTROL_PANEL_GROUPS.find((g) => g.key === "finance")!;
    for (const page of finance.pages) {
      draw(`${BASE}/${page.segment}`);
      expect([
        page.key,
        screen
          .getByTestId("nav-row-wide-finance")
          .getAttribute("aria-current"),
      ]).toEqual([page.key, "page"]);
      cleanup();
    }
  });

  it("lights the dashboard at the root, and nothing else", () => {
    draw();

    expect(
      screen.getByTestId("nav-row-wide-dashboard").getAttribute("aria-current"),
    ).toBe("page");
    for (const group of CONTROL_PANEL_GROUPS) {
      expect([
        group.key,
        screen.getByTestId(`nav-row-wide-${group.key}`).getAttribute("aria-current"),
      ]).toEqual([group.key, null]);
    }
  });

  it("keeps a deep screen inside its section", () => {
    // A record under a screen is still that screen's section: the
    // console opens rows from lists all day.
    draw(`${BASE}/companies/abc-123`);

    expect(
      screen.getByTestId("nav-row-wide-market").getAttribute("aria-current"),
    ).toBe("page");
  });
});
