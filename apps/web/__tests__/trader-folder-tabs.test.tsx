import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TRADER_PORTAL_MAP } from "@/components/trader/trader-portal-nav";
import { TraderTopNav, TRADER_TAB_ORDER } from "@/components/trader/trader-top-nav";
import { traderBarLinks } from "@/components/trader/trader-bar-actions";
import { portalPages } from "@/components/portal/portal-nav";

/**
 * THE BUYER'S FILE TABS.
 *
 * «اجعل تصميم لوحة المشتري نفس لوحة المورد من حيث التصميم فقط. إذا كان
 * لديه أقسام فيها أقسام منبثقة يحوّلها جميعًا إلى ألسنة كما فعلنا في
 * صفحة المورد. فقط خذ التصميم وغيّر تصميم صفحاته مثل ما صمّمنا صفحات
 * المورد.»
 *
 * THEN, IN A SECOND PASS: «أضف لسانًا في صفحة المشتري باسم المتابعة
 * وحُط في صفحته على شكل بطاقات المنازعات، وغيّر اسم الاستبدال إلى
 * الاسترجاع وحُطها بطاقة… وبلاغات المنتجات في بطاقة ثالثة… وألغِ ألسنتها
 * وجمّعها كبطاقات في صفحة المتابعة.»
 *
 * SO THE ROW IS FIVE, and the three that went are reachable in two
 * ways: as cards on «المتابعة», and at their own old addresses, which
 * forward. What this holds is that neither of those quietly stopped
 * being true.
 */
const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const LABELS = {
  navLabel: "التنقل",
  openMenu: "افتح",
  closeMenu: "أغلق",
  groupNames: Object.fromEntries(
    TRADER_PORTAL_MAP.groups.map((group) => [group.key, group.key]),
  ),
  pageNames: Object.fromEntries([
    [TRADER_PORTAL_MAP.home.key, TRADER_PORTAL_MAP.home.key],
    ...portalPages(TRADER_PORTAL_MAP).map((page) => [page.key, page.key]),
  ]),
};

const BASE = "/ar-SA/trader";

function draw(pathname = `${BASE}/orders`) {
  return render(
    <TraderTopNav
      basePath={BASE}
      map={TRADER_PORTAL_MAP}
      labels={LABELS}
      pathname={pathname}
    />,
  );
}


describe("the row", () => {
  it("turns every group into tabs, and leaves nothing behind a panel", () => {
    // «إذا كان لديه أقسام فيها أقسام منبثقة يحوّلها جميعًا إلى ألسنة».
    // The map had three groups — «السوق» holding one page, «الطلبات»
    // holding four, «الحساب» holding two — and a section holding a
    // single page is a click that buys nothing.
    // AND THEY ARE NAMES NOW, NOT FOLDER TABS — «ألغِ الألسنة من
    //  التصميم… تبقى الأسماء». The row is the same order from the
    // same map; only the drawing changed.
    const { container } = draw();
    const shown = [
      ...container.querySelectorAll('[data-testid^="nav-row-wide-"]'),
    ]
      .map((name) => (name as HTMLElement).dataset.testid ?? "")
      .filter(
        (id) => id !== "nav-row-wide-wave" && id !== "nav-row-wide-carton",
      )
      .map((id) => id.replace("nav-row-wide-", ""));

    expect(shown).toEqual([...TRADER_TAB_ORDER]);

    // EVERY DESTINATION THE MAP HOLDS IS IN THE ROW, except the
    // notifications page, which has the bell.
    // EVERY DESTINATION THE MAP HOLDS IS IN THE ROW, except the two
    // that have a door of their own: the notifications page has the
    // bell, and «بيانات المنشأة» has the account menu — «انقل بيانات
    // المنشأة… إلى داخل أيقونة المستخدم بمسمّى بياناتي».
    const inMap = portalPages(TRADER_PORTAL_MAP).map((page) => page.key);
    for (const key of inMap) {
      const expected = key !== "notifications" && key !== "account";
      expect([key, shown.includes(key)]).toEqual([key, expected]);
    }

    // AND IT IS STILL REACHABLE, which is the half a removal can break.
    expect(read("app/[locale]/trader/layout.tsx")).toContain(
      "recordHref={`${basePath}/account`}",
    );
  });

  it("opens nothing: no section names, no chevrons, no floating panel", () => {
    const { container } = draw();

    expect(container.querySelectorAll("svg.lucide-chevron-down")).toHaveLength(0);
    for (const group of TRADER_PORTAL_MAP.groups) {
      expect([
        group.key,
        container.querySelector(`[data-testid="nav-group-${group.key}"]`),
      ]).toEqual([group.key, null]);
    }
  });

  it("sends each tab to the page the map names, and nowhere else", () => {
    draw();
    const byKey = new Map(
      [TRADER_PORTAL_MAP.home, ...portalPages(TRADER_PORTAL_MAP)].map((page) => [
        page.key,
        page,
      ]),
    );

    for (const key of TRADER_TAB_ORDER) {
      const page = byKey.get(key)!;
      expect([
        key,
        screen.getByTestId(`nav-row-wide-${key}`).getAttribute("href"),
      ]).toEqual([
        key,
        page.segment ? `${BASE}/${page.segment}` : BASE,
      ]);
    }
  });

  it("marks the current page, and only it", () => {
    draw(`${BASE}/follow-up`);
    const current = screen.getByTestId("nav-row-wide-followUp");

    // ONE ANSWER, AND IT IS THE MACHINE-READABLE ONE. The shape
    // that carried `data-active` is gone; what marks the open name
    // is the wave, and a wave is decoration.
    expect(current.getAttribute("aria-current")).toBe("page");

    for (const key of TRADER_TAB_ORDER.filter((k) => k !== "followUp")) {
      expect([
        key,
        screen
          .getByTestId(`nav-row-wide-${key}`)
          .getAttribute("aria-current"),
      ]).toEqual([key, null]);
    }
  });

  it("carries one glyph in the whole row, and it is the market's", () => {
    // THE ICONS WENT WITH THE TABS. Every destination had one, and a
    // row where every name has a picture is a row of pictures with
    // captions — «تبقى الأسماء وأيقونتها» was said of the visitor's
    // two, where «السوق» earns one and «الرئيسية» does not.
    //
    // THE MAP KEEPS THEM, and the drawer still draws them: they are
    // right in a vertical list, where a glyph is a landmark rather
    // than noise.
    // AND «السوق» KEEPS ITS OWN — «أيقونة السوق خلّها باللون
    //  البرتقالي ثابتة». One destination on this platform is not the
    // company's own paperwork, and that is the one that is marked.
    const { container } = draw();
    for (const name of container.querySelectorAll(
      '[data-testid^="nav-row-wide-"]',
    )) {
      const id = name.getAttribute("data-testid") ?? "";
      if (id.endsWith("-wave") || id.endsWith("-carton")) continue;
      const expected = id === "nav-row-wide-opportunities";
      expect([id, name.querySelector("svg") !== null]).toEqual([id, expected]);
    }
  });
});

describe("«المتابعة» — three tabs, one screen", () => {
  it("gathers the three as cards and leaves each its own detail page", () => {
    // «ألغِ ألسنتها وجمّعها كبطاقات في صفحة المتابعة». The three cards
    // are drawn from the SAME loaders the three lists used, so what a
    // buyer reads did not change — only where they read it.
    const sections = read("components/trader/follow-up-sections.tsx");
    for (const loader of ["loadDisputes", "loadReplacements", "loadMyProductReports"]) {
      expect([loader, sections.includes(loader)]).toEqual([loader, true]);
    }

    // EVERY ROW STILL OPENS ITS OWN PAGE. The detail screens are where
    // the work is done and they were not touched.
    expect(sections).toContain("/trader/disputes/${dispute.id}");
    expect(sections).toContain("/trader/replacements/${replacement.id}");

    // AND THE PAGE DRAWS ALL THREE.
    const page = read("app/[locale]/trader/follow-up/page.tsx");
    for (const section of ["DisputesSection", "ReturnsSection", "ProductReportsSection"]) {
      expect([section, page.includes(section)]).toEqual([section, true]);
    }
  });

  it("keeps the three old addresses open, pointed at it", () => {
    // A buyer who bookmarked a list, a link in a notification sent last
    // month — none of them is a mistake, and none should meet a 404
    // because three screens became one.
    for (const segment of ["disputes", "replacements", "product-reports"]) {
      const legacy = read(`app/[locale]/trader/${segment}/page.tsx`);
      expect([segment, legacy.includes("trader/follow-up`)")]).toEqual([segment, true]);
      // GUARDED EVEN THOUGH IT ONLY FORWARDS: a visitor with no session
      // should meet the sign-in page here rather than be bounced to
      // another address that then sends them there.
      expect([segment, legacy.includes('requireRoleOrRedirect(appLocale, "TRADER")')]).toEqual([
        segment,
        true,
      ]);
    }
  });

  it("renames the returns for the reader and for nobody else", () => {
    // «غيّر اسم الاستبدال إلى الاسترجاع» is a WORD, not a migration.
    const ar = JSON.parse(read("messages/ar-SA.json"));
    expect(ar.trader.followUp.returns).toBe("الاسترجاع");
    expect(ar.trader.replacements.title).toBe("الاسترجاع");

    // NOT ONE ARABIC STRING IN THE BUYER'S BRANCH STILL SAYS IT.
    const strings = (node: unknown): string[] =>
      typeof node === "string"
        ? [node]
        : node && typeof node === "object"
          ? Object.values(node).flatMap(strings)
          : [];
    expect(strings(ar.trader).filter((line) => line.includes("استبدال"))).toEqual([]);

    // AND THE SUPPLIER IS UNTOUCHED: the owner named the same records
    // «المرتجعات» there, in an earlier instruction, and a rename that
    // reached across would have undone it.
    expect(ar.supplier.replacements.title).toBe("المرتجعات");

    // THE ROUTE AND THE MODEL KEEP THEIR NAME. `replacements` is still
    // the segment and `ReplacementSummary` still the shape; renaming a
    // column to match a label is how a rename becomes a migration.
    expect(read("components/trader/follow-up-sections.tsx")).toContain("ReplacementSummary");
    expect(read("components/trader/trader-portal-nav.ts")).not.toContain('"replacements"');
  });

  it("keeps the bell as the one door into the notifications page", () => {
    // The tab was left out because the bell is at the end of the same
    // row — «نكتفي بأيقونة الإشعارات كرابط للصفحة». A tab removed with
    // nothing put in its place would be a page nobody can reach.
    draw();
    expect(screen.queryByTestId("nav-page-notifications")).toBeNull();

    const layout = read("app/[locale]/trader/layout.tsx");
    expect(layout).toContain("NotificationBell");
    expect(layout).toContain("bell={");
    expect(layout).toContain("/notifications`");

    // AND NOT ALSO IN THE PLATFORM'S BAR: two bells for one page is
    // two doors into one room.
    expect(layout).not.toContain("notifications={{");

    // The page it points at is still served.
    expect(
      portalPages(TRADER_PORTAL_MAP).some((page) => page.key === "notifications"),
    ).toBe(true);
  });
});

describe("the buyer's strip", () => {
  it("puts nothing at the far end of the dashboard's strip", () => {
    // «مكتوب في أقصى اليسار تصفح المنتجات… احذف تصفح المنتجات.»
    //
    // The market IS one press away in the same strip: «تصفّح المنتجات»
    // stands in the categories with a cart beside it. The same
    // destination at both ends of one strip is the same door twice,
    // and the far end is where a reader looks for something they
    // cannot already see.
    const labels = { browseOffers: "تصفّح", backToList: "عودة" };
    expect(traderBarLinks(BASE, BASE, labels)).toEqual({});
    // A trailing slash is the same page.
    expect(traderBarLinks(`${BASE}/`, BASE, labels)).toEqual({});
  });

  it("draws no second way back over pages that already have one", () => {
    // «The buyer's deep pages draw their own way back, and a second
    // trail above the first would be two answers to one question» —
    // this portal's own recorded decision, and it is why the chrome
    // passes no breadcrumb either.
    for (const path of [
      `${BASE}/orders/abc`,
      `${BASE}/disputes/abc`,
      `${BASE}/replacements/abc`,
      `${BASE}/opportunities`,
      `${BASE}/account`,
    ]) {
      expect([path, traderBarLinks(path, BASE, { browseOffers: "x", backToList: "back" })]).toEqual([
        path,
        {},
      ]);
    }

    expect(read("components/trader/trader-chrome.tsx")).toContain("breadcrumbs={null}");
  });

  it("lays the offer's four cards out in two columns, narrow one trailing", () => {
    // «انقل بطاقة اشترِ إلى الجهة اليسرى… وبطاقة مواصفات العبوة خلها
    // فوقها بطاقة اشترِ، واحرص يكون عرضها نفس عرض بطاقة اشترِ.»
    //
    // THE WIDTHS ARE SHARED BY CONSTRUCTION, not matched by hand: the
    // purchase card and the package card are the only two things in one
    // grid track, so they cannot come out different widths. Two cards
    // in two separate rows, each told to be 22rem, is how two widths
    // drift apart when one of them is edited.
    const page = read("components/opportunities/opportunity-detail.tsx");

    expect(page).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]");

    // THE ORDER IS THE ORDER SEEN. The first track is where a row
    // begins — the right, in Arabic — so the wide column is written
    // first and the narrow one, the LEFT, second.
    const at = (id: string) => page.indexOf(`data-testid="detail-${id}-card"`);
    expect(at("product")).toBeGreaterThan(-1);
    expect(at("product")).toBeLessThan(at("shipping"));
    expect(at("shipping")).toBeLessThan(at("purchase"));
    expect(at("purchase")).toBeLessThan(at("package"));

    // AND THE PACKAGE CARD IS UNDER THE PURCHASE CARD, in that column —
    // not under the shipping card in the wide one, which is where it
    // was and why its width did not match.
    const narrow = page.slice(page.indexOf("THE NARROW COLUMN"));
    expect(narrow).toContain('data-testid="detail-purchase-card"');
    expect(narrow).toContain('data-testid="detail-package-card"');
    expect(narrow).not.toContain('data-testid="detail-shipping-card"');
  });

  it("carries the way back for an OFFER, because that page gave its own up", () => {
    // «الرجوع إلى المنتجات… ماخذة حيز؛ ألغِ التصنيفات من الشريط إذا دخلت
    // تفاصيل المنتج وحط مكانها عودة».
    //
    // THE RULE ABOVE IS UNCHANGED: never two. What moved is WHICH one.
    // The offer's screen drew a line of its own above the cards to say
    // one word; the strip is already there, and it is drawn whether or
    // not the body has resolved — so the way back survives the loading
    // state that line existed for.
    expect(
      traderBarLinks(`${BASE}/opportunities/abc`, BASE, {
        browseOffers: "x",
        backToList: "back",
      }),
    ).toEqual({ back: { href: `${BASE}/opportunities`, label: "back" } });

    // AND THE PAGE MUST NOT DRAW ONE TOO.
    const page = read("components/opportunities/opportunity-detail.tsx");
    expect(page).not.toContain("detail.backToList");
    expect(page).not.toContain("detail.breadcrumbLabel");
  });

  it("belongs to the buyer's own route table, not the supplier's", () => {
    // One LINE component, two route tables. A single table serving
    // both portals would have to be read with a portal in mind
    // before any line of it made sense.
    //
    // IT IS BUILT IN THE CHROME NOW, not in the nav: the line moved
    // out of the frame and into the page — «أي معلومات كانت في
    //  الأشرطة السابقة تنزل في الصفحة» — and the chrome is what
    // renders the page.
    const chrome = read("components/trader/trader-chrome.tsx");
    expect(chrome).toContain("traderBarLinks");
    expect(chrome).not.toContain("supplierBarLinks");
    expect(chrome).toContain('portal="trader"');
  });
});
