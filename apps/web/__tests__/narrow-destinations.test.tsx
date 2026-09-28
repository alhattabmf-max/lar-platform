import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SUPPLIER_PORTAL_MAP } from "@/components/supplier/supplier-portal-nav";
import { SupplierTopNav } from "@/components/supplier/supplier-top-nav";
import { TRADER_PORTAL_MAP } from "@/components/trader/trader-portal-nav";
import { TraderTopNav } from "@/components/trader/trader-top-nav";
import { portalPages } from "@/components/portal/portal-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE NARROW ROW OF DESTINATIONS, ON THE FRONTS THAT SIGN IN.
 *
 * «انتقل للمورّد والمشتري.» The visitor got the platform's signature
 * first — names parted by hairlines, a wave that slides under the open
 * one and a carton that rolls a full turn as it travels. These cases
 * are what stop the other two fronts from drifting back to a bar of
 * their own.
 *
 * THE ROW IS DERIVED, NEVER LISTED. It is built from the same
 * `tabOrder` the wide screen draws, so a destination cannot exist on
 * one screen and be missing from the other — which is exactly what a
 * second hand-written list here would produce the first time a page
 * was added.
 */
const labelsFor = (map: typeof SUPPLIER_PORTAL_MAP) => ({
  navLabel: "التنقل",
  openMenu: "افتح",
  closeMenu: "أغلق",
  groupNames: Object.fromEntries(map.groups.map((g) => [g.key, g.key])),
  pageNames: Object.fromEntries([
    [map.home.key, map.home.key],
    ...portalPages(map).map((page) => [page.key, page.key]),
  ]),
});

/** The narrow arrangement is asked of the controls, not of a flag. */
const CONTROLS = <span data-testid="row-controls" />;

describe("the supplier's narrow row", () => {
  it("carries every tab the wide row carries, in the same order", () => {
    render(
      <SupplierTopNav
        basePath="/ar-SA/supplier"
        map={SUPPLIER_PORTAL_MAP}
        labels={labelsFor(SUPPLIER_PORTAL_MAP)}
        pathname="/ar-SA/supplier/orders"
        mobileControls={CONTROLS}
      />,
    );

    // The owner's order, and no «الإشعارات» or «بياناتي»: those have a
    // bell and a glyph of their own in the row above.
    for (const key of ["dashboard", "products", "opportunities", "orders", "followUp"]) {
      expect(screen.getByTestId(`nav-row-${key}`)).toHaveAttribute(
        "href",
        key === "dashboard"
          ? "/ar-SA/supplier"
          : `/ar-SA/supplier/${key === "followUp" ? "follow-up" : key}`,
      );
    }
    expect(screen.queryByTestId("nav-row-notifications")).toBeNull();
    expect(screen.queryByTestId("nav-row-account")).toBeNull();
  });

  it("says which one is open, and says it once", () => {
    render(
      <SupplierTopNav
        basePath="/ar-SA/supplier"
        map={SUPPLIER_PORTAL_MAP}
        labels={labelsFor(SUPPLIER_PORTAL_MAP)}
        pathname="/ar-SA/supplier/products"
        mobileControls={CONTROLS}
      />,
    );

    // A FRONT'S ROOT PREFIXES EVERY PAGE UNDER IT, so a plain
    // `startsWith` would light «الرئيسية» everywhere. The longest match
    // is the one you are actually inside.
    expect(screen.getByTestId("nav-row-products")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("nav-row-dashboard")).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("the buyer's narrow row", () => {
  it("is the buyer's own four, the market among them", () => {
    render(
      <TraderTopNav
        basePath="/ar-SA/trader"
        map={TRADER_PORTAL_MAP}
        labels={labelsFor(TRADER_PORTAL_MAP)}
        pathname="/ar-SA/trader/orders"
        mobileControls={CONTROLS}
      />,
    );

    // «أضف كلمة السوق في المشتري بجانب الرئيسية، لأن الشريط يطلع في
    //  الرئيسية.» It hung under the home tab by `covers` for one
    // design, which is what put a row of categories on the buyer's
    // own dashboard.
    for (const key of ["dashboard", "opportunities", "orders", "followUp"]) {
      expect(screen.getByTestId(`nav-row-${key}`)).toBeTruthy();
    }
    // AND IT IS SECOND, where the visitor's row puts it.
    // THE NARROW ROW'S OWN IDS. Both rows are in the document and
    // the stylesheet chooses between them, so the wide one's names
    // answer to `nav-row-wide-` and have to be left out here.
    expect(
      [...document.querySelectorAll('[data-testid^="nav-row-"]')]
        .map((el) => el.getAttribute("data-testid") ?? "")
        .filter(
          (id) =>
            !id.startsWith("nav-row-wide") &&
            !id.endsWith("-wave") &&
            !id.endsWith("-carton"),
        )[1],
    ).toBe("nav-row-opportunities");
  });
});

describe("the account, opened into the row", () => {
  const draw = () =>
    render(
      <UserMenu
        inline
        recordHref="/ar-SA/supplier/account"
        labels={{
          open: "حسابي",
          record: "بياناتي",
          signOut: "خروج",
          signingOut: "…",
        }}
        signOut={<button type="button">خروج</button>}
      />,
    );

  it("is shut until it is pressed, and pressing again shuts it", async () => {
    const user = userEvent.setup();
    draw();

    const glyph = screen.getByTestId("user-menu");
    expect(glyph).toHaveAttribute("aria-expanded", "false");

    await user.click(glyph);
    expect(glyph).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("user-menu-record")).toBeTruthy();

    // «كلاهما» — a second press on the glyph is one of the two ways out.
    await user.click(glyph);
    expect(glyph).toHaveAttribute("aria-expanded", "false");
  });

  it("draws the words IN the row, not over the page", async () => {
    const user = userEvent.setup();
    draw();
    await user.click(screen.getByTestId("user-menu"));

    // NOTHING FLOATS. The whole point of the inline shape is that the
    // row re-shares its own width — «أيقونة الإشعارات والبحث تتمدّد
    //  ناحية الشعار، والشعار يكون ثابت». An absolutely positioned panel
    // would cover the search instead of moving it.
    const panel = screen.getByTestId("user-menu-panel");
    expect(panel.className).not.toContain("absolute");
    expect(panel.className).not.toContain("shadow");
  });

  it("keeps «خروج» out of the tab order while it is shut", () => {
    draw();
    // A link inside a zero-width `overflow-hidden` box is still
    // focusable; `invisible` is what actually removes it.
    expect(screen.getByTestId("user-menu-panel").className).toContain(
      "invisible",
    );
  });
});

const read = (relative: string) =>
  readFileSync(join(__dirname, "..", relative), "utf8");

describe("the strips, and what is left of them", () => {
  it("keeps five pixels of the identity and nothing else", () => {
    // «بنلغي الشريط من جميع الصفحات ونكتفي بالشريط الخمسة بكسل اللي
    //  نفس الرئيسية.»
    //
    // THREE SURFACES CAME OFF: the orange band the categories stood
    // on, the navy page bar with a colour run in it, and
    // `MarketBand`, which drew a SECOND search field under the row of
    // names on the two fronts that sign in.
    const nav = read("components/portal/folder-tab-nav.tsx");
    expect(nav).toContain('className="h-[5px] bg-accent-interactive"');
    // AT EVERY WIDTH: it is the foot of the chrome and what the wave
    // stands on, and the wide screen is where there is most room to
    // show a signature.
    expect(nav).not.toContain('h-[5px] bg-accent-interactive lg:hidden');
    expect(nav).not.toContain("chrome-run-strip");
    expect(nav).not.toContain("category-band-fold");

    // AND NO FRONT BUILDS THE SECOND SEARCH ANY MORE.
    for (const front of [
      "app/[locale]/trader/layout.tsx",
      "app/[locale]/supplier/layout.tsx",
    ]) {
      expect([front, read(front).includes("MarketBand")]).toEqual([
        front,
        false,
      ]);
    }
  });

  it("stands the categories in the page, on the market route alone", () => {
    // «التصنيفات أو أي معلومات في الأشرطة تبقى في الصفحة بنفس خلفية
    //  الصفحة، مع تغيير لون الكتابة للبرتقالي.»
    //
    // ASKED IN THE FRONT'S OWN FILE, not in the shared chrome. It
    // was one condition up there for a build, and then the console
    // handed in a band whose rule is a different question entirely
    // — which SECTION is open. One condition could not say both.
    //
    // `startsWith` AND NOT `===`, so an offer's own page keeps the
    // categories: a reader who opened one offer is still shopping.
    for (const front of [
      "components/visitor/visitor-chrome.tsx",
      "components/trader/trader-chrome.tsx",
    ]) {
      const source = read(front);
      expect([front, source.includes("band={onMarket ? categoryBand : null}")]).toEqual([
        front,
        true,
      ]);
      expect([
        front,
        source.includes("pathname.startsWith(`${basePath}/opportunities`)"),
      ]).toEqual([front, true]);
    }

    // AND IT IS THE PAGE CARD THEY STAND ON, not the site's ground —
    // «حطّيت مسافة بين الشريط والتصنيفات وخلّيتها في خلفية الموقع
    //  وليس بطاقة الصفحة». They are the first thing INSIDE the sheet,
    // pulled up by exactly the sheet's own top padding so the five
    // pixels of orange and the first category touch.
    const chrome = read("components/portal/portal-chrome.tsx");
    expect(chrome).toContain('<div className="-mt-2 lg:-mt-3">{band}</div>');

    // AND IT IS ONE COMPONENT AT EVERY WIDTH. The wide screen drew
    // its own categories in the page bar and the phone drew these —
    // two answers to one question is how they come to disagree.
    const band = read("components/portal/category-band.tsx");
    expect(band).not.toContain("lg:hidden");
    expect(band).not.toContain("bg-accent-interactive");

    // THE INK CARRIES WHAT THE SURFACE USED TO — 4.8:1 on the page's
    // ground.
    const row = read("components/portal/nav-row.tsx");
    expect(row).toContain("text-accent-interactive");

    // WHITE SURVIVES IN ONE PLACE ONLY: inside the panel a name opens,
    // which IS a dark surface — see `bg-band-panel`. Everything the
    // row draws on the page's own ground is the identity's orange.
    const panelAt = row.indexOf("-panel`}");
    expect(panelAt).toBeGreaterThan(0);
    expect(row.slice(0, panelAt)).not.toContain("text-primary-foreground");
  });
});
