import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VISITOR_PORTAL_MAP } from "@/components/visitor/visitor-portal-nav";
import { VisitorTopNav } from "@/components/visitor/visitor-top-nav";
import { locatePortalPage } from "@/components/portal/portal-nav";

/**
 * THE VISITOR'S FILE TABS.
 *
 * «وصمّم واجهة الزائر بنفس التصميم اللي اعتمدناه لواجهة المشتري
 * والمورد، وحط الألسنة عبارة عن الرئيسية والسوق فقط. وفي شريط السوق حط
 * التصنيفات وعرض الكل… وألغِ البحث اللي في صفحة السوق واكتفِ بأيقونة
 * البحث في لسان السوق.»
 */
const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const BASE = "/ar-SA";

const LABELS = {
  navLabel: "التنقل",
  openMenu: "افتح",
  closeMenu: "أغلق",
  groupNames: { market: "market" },
  pageNames: { home: "home", market: "market" },
};

function draw(pathname = BASE) {
  return render(
    <VisitorTopNav
      basePath={BASE}
      map={VISITOR_PORTAL_MAP}
      labels={LABELS}
      pathname={pathname}
    />,
  );
}

describe("the row", () => {
  it("is ONE tab and no more", () => {
    // «في واجهة الزائر احتفظ بلسان الرئيسية فقط».
    //
    // THE MARKET LOST ITS TAB AND KEPT ITS PAGE. «عرض الكل» in that
    // tab's own strip points at the very address the tab opened, so the
    // two were doors onto one room; the link survives because it sits
    // among the categories that lead to the same list filtered.
    // AND IT IS A NAME NOW, NOT A FOLDER TAB — «ألغِ الألسنة من
    //  التصميم» — so it answers to the row's own id.
    const { container } = draw();
    const shown = [
      ...container.querySelectorAll('[data-testid^="nav-row-wide-"]'),
    ]
      .map((name) => (name as HTMLElement).dataset.testid ?? "")
      .filter((id) => id !== "nav-row-wide-wave" && id !== "nav-row-wide-carton")
      .map((id) => id.replace("nav-row-wide-", ""));

    expect(shown).toEqual(["home"]);
    expect(VISITOR_PORTAL_MAP.groups).toHaveLength(0);
  });

  it("sends its one tab to the locale root", () => {
    draw();
    expect(screen.getByTestId("nav-row-wide-home").getAttribute("href")).toBe(
      BASE,
    );
    expect(screen.queryByTestId("nav-row-wide-market")).toBeNull();
  });

  it("lights the home tab on the market, which is the page it covers", () => {
    // THE TRAP THIS CATCHES, still. Every other portal hangs off a named
    // segment (`/supplier`, `/trader`), and the lookup finds it by
    // searching for that marker. The public front has none: its pages
    // hang straight off the locale. An empty root made the marker `"/"`,
    // which matches at index 0 of every path, and the character after it
    // is then the `a` of `ar-SA` rather than a separator.
    expect(locatePortalPage(VISITOR_PORTAL_MAP, BASE)?.page.key).toBe("home");

    // THE MARKET IS NO LONGER A TAB AND IS STILL A PAGE, so the home
    // tab COVERS it — «عرض الكل يعرض لي السوق بدون ما يكون فيه لسان
    // للسوق». Unlit, a row says nothing and looks broken.
    //
    // IT IS A NAMED SEGMENT, NOT A FALLBACK. "One tab, always lit" was
    // tried first: true of this front, useless to the buyer, and on
    // either it would also light for the policies and the FAQ, which
    // the tab has nothing to do with.
    for (const path of [BASE, `${BASE}/opportunities`, `${BASE}/opportunities/abc`]) {
      expect(locatePortalPage(VISITOR_PORTAL_MAP, path)?.page.key).toBe("home");
      draw(path);
      // THE OPEN NAME IS SAID IN `aria-current`, not in a data flag:
      // the shape that used to carry `data-active` is gone and what
      // marks the open one now is the wave, which is decoration — so
      // the machine-readable answer has to be on the link itself.
      expect(screen.getByTestId("nav-row-wide-home")).toHaveAttribute(
        "aria-current",
        "page",
      );
      cleanup();
    }

    // AND NOT FOR A PAGE IT DOES NOT COVER.
    expect(locatePortalPage(VISITOR_PORTAL_MAP, `${BASE}/faq`)).toBeNull();
  });

  it("opens nothing: no section names, no chevrons, no floating panel", () => {
    const { container } = draw();
    expect(container.querySelectorAll("svg.lucide-chevron-down")).toHaveLength(0);
    expect(container.querySelector('[data-testid="nav-group-market"]')).toBeNull();
  });
});

describe("the market tab's strip", () => {
  it("holds the categories and the way into the whole list", () => {
    const strip = read("components/portal/market-strip.tsx");

    expect(strip).toContain("<CategoryNav");
    expect(strip).toContain('tone="strip"');
    expect(strip).toContain("nav.viewAll");

    // AND NOT THE SEARCH CONTROL, which stands at the opposite end of
    // the same strip — «وخل الأيقونة في الجهة المقابلة من اللسان».
    expect(strip).not.toContain("market-search");
  });

  // THE SEARCH CONTROL THIS FILE USED TO DESCRIBE IS GONE.
  //
  // `components/portal/market-search.tsx` was a button in the market
  // strip. It was replaced by the field in the tab row — see
  // `chrome-search.test.tsx`, which covers what that field does — and
  // nothing imported the old file for a long time before it was
  // deleted. The case that read it to check its own padding and fill
  // went with it; the case ABOVE, which holds the strip to NOT
  // carrying it, stays.
});

describe("the market page itself", () => {
  it("draws the filter bar on every market page, behind nothing", () => {
    // «ويكون ظاهر، ما يحتاج نضغط كلمة بحث، ويكون تحت شريط الألسنة
    // مباشرة، ويظهر في جميع صفحات المنتجات ما عدا الرئيسية».
    //
    // IT HID BEHIND A PARAMETER the search icon toggled. A filter
    // nobody can see is a filter nobody uses, and once it is always
    // drawn that icon is a door in front of an open room — so the icon
    // went with the gate.
    //
    // THE PAGE BODY BEGINS DIRECTLY UNDER THE TAB STRIP, so being first
    // in the body IS being under the strip; no chrome change is needed
    // and none was made.
    for (const page of [
      "app/[locale]/(public)/opportunities/page.tsx",
      "app/[locale]/trader/opportunities/page.tsx",
    ]) {
      const code = read(page);
      expect([page, code.includes("filtersOpen")]).toEqual([page, false]);
      expect([page, code.includes("<FiltersRegion")]).toEqual([page, true]);
    }

    // AND NOT ON THE FRONT DOOR — «ما عدا الرئيسية». The home is a
    // preview of six closing soonest; it has no pager and nothing to
    // narrow.
    expect(read("components/home/home-content.tsx")).not.toContain(
      "OpportunityFilters",
    );

    // THE SEARCH CONTROL IS GONE FROM THE STRIP, and a general search
    // field cannot replace it yet: the listing contract accepts a
    // region, a city, a taxonomy node, a product id, a sort and a page,
    // and NO text. A field that takes typing and filters nothing is
    // worse than no field.
    for (const nav of [
      "components/visitor/visitor-top-nav.tsx",
      "components/trader/trader-top-nav.tsx",
    ]) {
      expect([nav, read(nav).includes("MarketSearch")]).toEqual([nav, false]);
    }
  });
});

describe("the front door, for a reader who is already inside", () => {
  it("sends a signed-in company to its own portal instead of the storefront", () => {
    // «عند التحديث ما يدخّلني على صفحتي اللي أنا مسجَّل بها». The
    // browser holds ONE session, so reloading this address while signed
    // in is a reader who is already somewhere — and the storefront's
    // answer used to be a sign-out button that would end the session in
    // whatever tab they had left open.
    const home = read("app/[locale]/(public)/page.tsx");

    expect(home).toContain("getSession()");
    expect(home).toContain("redirect(");

    // THE COMPANY'S OWN TYPE DECIDES, never a guess and never a
    // default: a supplier reaches the supplier's portal and a buyer
    // the buyer's.
    expect(home).toContain('session.company.accountType === "SUPPLIER"');
    expect(home).toContain("/supplier`");
    expect(home).toContain("/trader`");
  });

  it("leaves every other public page reachable while signed in", () => {
    // A link somebody was sent has to open at the thing it names. It is
    // the FRONT DOOR that has a better answer for a reader who is
    // already inside — not the policies, not an offer, not the FAQ.
    for (const page of [
      "app/[locale]/(public)/opportunities/page.tsx",
      "app/[locale]/(public)/policies/page.tsx",
      "app/[locale]/(public)/faq/page.tsx",
    ]) {
      const source = read(page);
      expect([page, source.includes("redirect(")]).toEqual([page, false]);
    }
  });
});

describe("the fence", () => {
  it("gives the public front the row without giving it to the console", () => {
    expect(read("components/shell/app-shell.tsx")).toContain("VisitorChrome");
    for (const wearer of [
      "components/visitor/visitor-chrome.tsx",
      "components/supplier/supplier-chrome.tsx",
      "components/trader/trader-chrome.tsx",
      "components/admin/control-panel-chrome.tsx",
    ]) {
      expect([wearer, read(wearer).includes("navSlot")]).toEqual([wearer, true]);
      expect([wearer, read(wearer).includes("mainSurface")]).toEqual([wearer, true]);
    }

    // AND THE CONSOLE HANDS IN ITS OWN, which is a row of SECTIONS
    // — twenty-one screens do not fit on one line.
    const console_ = read("components/admin/control-panel-chrome.tsx");
    expect(console_).toContain("<AdminTopNav");
  });

  it("keeps the public site's footer, which no portal has", () => {
    // The policies, the FAQ, the contact form — everything a visitor
    // looks for at the bottom of a page rather than in a tab. It stays
    // OUTSIDE the chrome, so putting the row on the public front did
    // not give the portals a footer.
    const shell = read("components/shell/app-shell.tsx");
    expect(shell).toContain("<Footer");
    expect(shell.indexOf("</VisitorChrome>")).toBeLessThan(shell.indexOf("<Footer"));
  });
});
