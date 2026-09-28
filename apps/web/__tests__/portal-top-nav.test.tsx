import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PortalTopNav } from "@/components/portal/portal-top-nav";
import { CONTROL_PANEL_MAP } from "@/components/admin/control-panel-nav";
import { SUPPLIER_PORTAL_MAP } from "@/components/supplier/supplier-portal-nav";
import { TRADER_PORTAL_MAP } from "@/components/trader/trader-portal-nav";
import { portalPages, type PortalNavMap } from "@/components/portal/portal-nav";

/**
 * The navigation across the top of every portal.
 *
 * WHAT THIS REPLACED. A rail down the side of all three portals, which
 * took a fifth of the width from every table on every screen — and a
 * console is where wide tables are read.
 *
 * ALL THREE PORTALS ARE RUN THROUGH THE SAME CASES, because one
 * component draws all three and a rule that held for the console and
 * not the buyer would be the drift this file exists to prevent.
 *
 * AND BOTH DIRECTIONS. Every position here is expressed logically —
 * `start`, `end`, `inset-inline` — so Arabic and English are the same
 * component with no branch. The cases that could break under RTL are
 * the ones asserted on the class, not on a pixel.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const PORTALS: { name: string; map: PortalNavMap; base: string }[] = [
  { name: "console", map: CONTROL_PANEL_MAP, base: "/ar-SA/admin" },
  { name: "supplier", map: SUPPLIER_PORTAL_MAP, base: "/ar-SA/supplier" },
  { name: "buyer", map: TRADER_PORTAL_MAP, base: "/ar-SA/trader" },
];

function labelsFor(map: PortalNavMap) {
  const groupNames: Record<string, string> = {};
  for (const group of map.groups) groupNames[group.key] = `group:${group.key}`;
  const pageNames: Record<string, string> = {};
  for (const page of portalPages(map)) pageNames[page.key] = `page:${page.key}`;
  return {
    navLabel: "تنقل اللوحة",
    openMenu: "فتح القائمة",
    closeMenu: "إغلاق القائمة",
    groupNames,
    pageNames,
  };
}

function renderNav(map: PortalNavMap, base: string, pathname: string) {
  return render(
    <PortalTopNav
      basePath={base}
      map={map}
      labels={labelsFor(map)}
      pathname={pathname}
    />,
  );
}

describe.each(PORTALS)("$name — where the reader is", ({ map, base }) => {
  it("names the navigation region", () => {
    renderNav(map, base, base);

    expect(
      screen.getByRole("navigation", { name: "تنقل اللوحة" }),
    ).toBeInTheDocument();
  });

  it("marks the portal root as the current page", () => {
    renderNav(map, base, base);

    expect(screen.getByTestId(`nav-page-${map.home.key}`)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("underlines the group holding the current page, and only that one", async () => {
    const group = map.groups[0];
    const page = group.pages[0];
    renderNav(map, base, `${base}/${page.segment}`);

    const active = screen.getByTestId(`nav-group-${group.key}`);
    // COLOUR IS NOT THE ONLY SIGNAL: the accent underline is drawn
    // inside the active item, and the label goes to full weight beside
    // it. An underline told apart only by hue says nothing to a reader
    // who cannot separate those hues.
    expect(
      within(active).getByTestId("nav-active-underline"),
    ).toBeInTheDocument();
    expect(active.className).toContain("font-semibold");

    for (const other of map.groups.slice(1)) {
      expect(
        within(screen.getByTestId(`nav-group-${other.key}`)).queryByTestId(
          "nav-active-underline",
        ),
      ).toBeNull();
    }
  });

  /**
   * A DETAIL SCREEN BELONGS TO ITS SECTION. Somebody three levels into
   * one record still has to be able to see which part of the portal
   * they are in.
   */
  it("keeps a detail screen marked as its section", async () => {
    const user = userEvent.setup();
    const group = map.groups[0];
    const page = group.pages[0];
    renderNav(map, base, `${base}/${page.segment}/some-record-id`);

    expect(
      within(screen.getByTestId(`nav-group-${group.key}`)).getByTestId(
        "nav-active-underline",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId(`nav-group-${group.key}`));
    expect(screen.getByTestId(`nav-page-${page.key}`)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not mark the root once the reader has left it", () => {
    const page = map.groups[0].pages[0];
    renderNav(map, base, `${base}/${page.segment}`);

    expect(
      screen.getByTestId(`nav-page-${map.home.key}`),
    ).not.toHaveAttribute("aria-current");
  });
});

describe.each(PORTALS)("$name — the group panels", ({ map, base }) => {
  it("opens a group on press, and says what it governs", async () => {
    const user = userEvent.setup();
    const group = map.groups[0];
    renderNav(map, base, base);

    const button = screen.getByTestId(`nav-group-${group.key}`);
    // A DISCLOSURE, NOT A LINK. A group is a heading; making it
    // navigate would send people to a page they did not ask for.
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId(`nav-panel-${group.key}`)).toBeInTheDocument();
  });

  it("keeps one panel open at a time", async () => {
    if (map.groups.length < 2) return;
    const user = userEvent.setup();
    const [first, second] = map.groups;
    renderNav(map, base, base);

    await user.click(screen.getByTestId(`nav-group-${first.key}`));
    await user.click(screen.getByTestId(`nav-group-${second.key}`));

    // Two panels over each other is two answers to one question.
    expect(screen.queryByTestId(`nav-panel-${first.key}`)).toBeNull();
    expect(screen.getByTestId(`nav-panel-${second.key}`)).toBeInTheDocument();
  });

  it("closes a panel by pressing its own name again", async () => {
    const user = userEvent.setup();
    const group = map.groups[0];
    renderNav(map, base, base);

    const button = screen.getByTestId(`nav-group-${group.key}`);
    await user.click(button);
    await user.click(button);

    expect(screen.queryByTestId(`nav-panel-${group.key}`)).toBeNull();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const group = map.groups[0];
    renderNav(map, base, base);

    await user.click(screen.getByTestId(`nav-group-${group.key}`));
    await user.keyboard("{Escape}");

    expect(screen.queryByTestId(`nav-panel-${group.key}`)).toBeNull();
  });
});

describe.each(PORTALS)("$name — every destination is a real link", ({ map, base }) => {
  it("builds every href from the portal root and the segment", async () => {
    const user = userEvent.setup();
    renderNav(map, base, base);

    // Open every panel so all destinations are in the document.
    for (const group of map.groups) {
      await user.click(screen.getByTestId(`nav-group-${group.key}`));
      for (const page of group.pages) {
        expect(screen.getByTestId(`nav-page-${page.key}`)).toHaveAttribute(
          "href",
          `${base}/${page.segment}`,
        );
      }
    }

    expect(screen.getByTestId(`nav-page-${map.home.key}`)).toHaveAttribute(
      "href",
      base,
    );
  });

  /**
   * ONLY THIS PORTAL'S OWN. Nothing in the component knows another
   * portal exists — it renders the map it is handed — and this is what
   * proves it for each of the three.
   */
  it("names no destination outside this portal", async () => {
    const user = userEvent.setup();
    renderNav(map, base, base);
    for (const group of map.groups) {
      await user.click(screen.getByTestId(`nav-group-${group.key}`));
    }

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").toMatch(
        new RegExp(`^/(ar|en)-SA/${map.root}(/|$)`),
      );
    }
  });

  it("renders links, not click handlers on plain elements", async () => {
    const user = userEvent.setup();
    renderNav(map, base, base);
    await user.click(screen.getByTestId(`nav-group-${map.groups[0].key}`));

    for (const page of map.groups[0].pages) {
      expect(screen.getByTestId(`nav-page-${page.key}`).tagName).toBe("A");
    }
  });
});

describe.each(PORTALS)("$name — on a phone", ({ map, base }) => {
  it("collapses to one named button rather than a row that scrolls sideways", () => {
    renderNav(map, base, base);

    const button = screen.getByTestId("portal-menu-button");
    expect(button).toHaveAttribute("aria-label", "فتح القائمة");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("portal-nav-drawer")).toBeNull();
  });

  it("opens a column of every destination, grouped", async () => {
    const user = userEvent.setup();
    renderNav(map, base, base);

    await user.click(screen.getByTestId("portal-menu-button"));

    const drawer = screen.getByTestId("portal-nav-drawer");
    for (const group of map.groups) {
      expect(within(drawer).getByText(`group:${group.key}`)).toBeInTheDocument();
      for (const page of group.pages) {
        expect(
          within(drawer).getByText(`page:${page.key}`),
        ).toBeInTheDocument();
      }
    }
  });

  it("renames its own control when open, and closes on Escape", async () => {
    const user = userEvent.setup();
    renderNav(map, base, base);

    await user.click(screen.getByTestId("portal-menu-button"));
    expect(screen.getByTestId("portal-menu-button")).toHaveAttribute(
      "aria-label",
      "إغلاق القائمة",
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("portal-nav-drawer")).toBeNull();
  });

  /**
   * NOTHING SCROLLS SIDEWAYS. The panel is a column with its own
   * vertical scroll and a viewport cap; the row of groups is hidden
   * below `lg` entirely rather than squeezed.
   */
  it("caps the panel's own height instead of the page's width", async () => {
    const user = userEvent.setup();
    renderNav(map, base, base);
    await user.click(screen.getByTestId("portal-menu-button"));

    const drawer = screen.getByTestId("portal-nav-drawer");
    expect(drawer.className).toContain("overflow-y-auto");
    expect(drawer.className).not.toContain("overflow-x");
  });
});

describe.each(PORTALS)("$name — every destination is legible", ({ map, base }) => {
  /**
   * THE DEFECT THIS PINS. The inactive items were written as
   * `text-primary-foreground/85`. The token behind that class is
   * `var(--color-on-primary)`, a plain hex with no `<alpha-value>`
   * placeholder — so Tailwind could not build a colour from the `/85`
   * modifier and dropped the declaration entirely. Every inactive
   * destination fell back to the inherited near-black `text-content`
   * and measured 1.07:1 against the navy band. Only the active item,
   * which never carried the modifier, could be read.
   *
   * The rule is therefore stated on the CLASS, because that is where
   * it broke: no opacity modifier on the bar's own text colour.
   */
  it("dims no destination with an opacity modifier on the text colour", () => {
    const group = map.groups[0];
    renderNav(map, base, base);

    for (const el of [
      screen.getByTestId(`nav-page-${map.home.key}`),
      screen.getByTestId(`nav-group-${group.key}`),
    ]) {
      expect(el.className).toContain("text-primary-foreground");
      expect(el.className).not.toMatch(/text-primary-foreground\/\d/);
    }
  });

  it("gives the active item the same colour as the rest", () => {
    const group = map.groups[0];
    renderNav(map, base, `${base}/${group.pages[0].segment}`);

    const active = screen.getByTestId(`nav-group-${group.key}`);
    const inactive = screen.getByTestId(`nav-page-${map.home.key}`);

    // Both fully legible; the active one differs by WEIGHT and by the
    // underline, not by being the only one bright enough to read.
    expect(active.className).toContain("text-primary-foreground");
    expect(inactive.className).toContain("text-primary-foreground");
    expect(active.className).toContain("font-semibold");
    expect(inactive.className).not.toContain("font-semibold");
  });
});

describe("the bar reads the same in both directions", () => {
  const source = `${process.cwd()}/components/portal/portal-top-nav.tsx`;

  it("positions everything logically, with no locale branch", async () => {
    const { readFileSync } = await import("node:fs");
    // COMMENTS STRIPPED FIRST. A note explaining that Arabic opens the
    // panel leftwards is exactly the reasoning this rule exists to
    // record, and banning the word in prose would push it out of the
    // file it belongs in.
    const text = readFileSync(source, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    // `start`/`end` follow the document's direction; `left`/`right` do
    // not, and a second source of truth for which way a page reads is a
    // bug waiting for a third locale.
    expect(text).not.toMatch(/\bleft-0\b|\bright-0\b/);
    expect(text).not.toContain("ar-SA");
    expect(text).not.toMatch(/locale\s*===/);
    expect(text).toContain("start-0");
  });
});
