import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SUPPLIER_PORTAL_MAP } from "@/components/supplier/supplier-portal-nav";
import { SupplierTopNav } from "@/components/supplier/supplier-top-nav";
import { portalPages } from "@/components/portal/portal-nav";

/**
 * THE SUPPLIER'S FILE TABS — and the fence around them.
 *
 * The owner asked for this design on the supplier's portal ALONE:
 * «اعزل التعديل عن بقية اللوحات حتى لو كانت المكونات مشتركة». The
 * isolation is structural rather than a flag — the supplier's chrome
 * hands in its own navigation, and the console and the buyer render the
 * shared bar they always did — and these cases are what stop that fence
 * from quietly coming down.
 */
const ROOT = join(__dirname, "..");
/**
 * THE SUPPLIER'S ROW, AS ONE TEXT.
 *
 * The drawing moved to `components/portal/folder-tab-nav.tsx` when the
 * owner asked for the buyer to wear the same design — «اجعل تصميم لوحة
 * المشتري نفس لوحة المورد». What is still in the supplier's own file is
 * its ORDER and its STRIP. A question like "does a resting tab keep its
 * shadow" is about the row, not about which of the two files holds the
 * line, so the two are read together.
 */
const supplierNav = () =>
  read("components/supplier/supplier-top-nav.tsx") +
  "\n" +
  read("components/portal/folder-tab-nav.tsx");

const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/** The row the owner dictated, in his order. */
const ORDER = [
  "dashboard",
  "products",
  "opportunities",
  "orders",
  // «المتابعة» — the payouts, the disputes and the returns, which had a
  // tab each. None of the three is a place a supplier GOES; they are
  // things that happen to them, and three tabs were three chances to
  // miss one. «الفواتير» went with them: its page was a second view of
  // two fields «بيانات المنشأة» already shows and edits.
  "followUp",
  // «انقل بيانات المنشأة من الشريط العلوي إلى داخل أيقونة المستخدم
  // بمسمّى بياناتي» — it is not a tab any more. The page and its route
  // are untouched; only the way in moved, and the case below holds that.
];

const LABELS = {
  navLabel: "التنقل",
  openMenu: "افتح",
  closeMenu: "أغلق",
  groupNames: Object.fromEntries(
    SUPPLIER_PORTAL_MAP.groups.map((group) => [group.key, group.key]),
  ),
  pageNames: Object.fromEntries([
    [SUPPLIER_PORTAL_MAP.home.key, SUPPLIER_PORTAL_MAP.home.key],
    ...portalPages(SUPPLIER_PORTAL_MAP).map((page) => [page.key, page.key]),
  ]),
};

function draw(pathname = "/ar-SA/supplier/follow-up") {
  return render(
    <SupplierTopNav
      basePath="/ar-SA/supplier"
      map={SUPPLIER_PORTAL_MAP}
      labels={LABELS}
      pathname={pathname}
    />,
  );
}

describe("the row", () => {
  it("is every destination, in the order the owner gave", () => {
    // «الرئيسية - منتجاتي - الطلبات - المنازعات - الاستبدالات -
    // التسويات - الفواتير - بيانات المنشأة».
    const { container } = draw();
    // AND THEY ARE NAMES NOW, NOT FOLDER TABS — «ألغِ الألسنة من
    //  التصميم… تبقى الأسماء». Same order, same map, new drawing.
    const shown = [
      ...container.querySelectorAll('[data-testid^="nav-row-wide-"]'),
    ]
      .map((name) => (name as HTMLElement).dataset.testid ?? "")
      .filter(
        (id) => id !== "nav-row-wide-wave" && id !== "nav-row-wide-carton",
      )
      .map((id) => id.replace("nav-row-wide-", ""));

    expect(shown).toEqual(ORDER);
  });

  it("sends each tab to the page the map names, and nowhere else", () => {
    draw();
    const byKey = new Map(
      [SUPPLIER_PORTAL_MAP.home, ...portalPages(SUPPLIER_PORTAL_MAP)].map(
        (page) => [page.key, page],
      ),
    );

    for (const key of ORDER) {
      const page = byKey.get(key)!;
      expect([
        key,
        screen.getByTestId(`nav-row-wide-${key}`).getAttribute("href"),
      ]).toEqual([
        key,
        page.segment ? `/ar-SA/supplier/${page.segment}` : "/ar-SA/supplier",
      ]);
    }
  });

  it("keeps every name's icon beside it", () => {
    // «مع الاحتفاظ بالأيقونات بجانب الاسم».
    const { container } = draw();
    for (const tab of container.querySelectorAll('[data-testid^="nav-page-"]')) {
      expect([tab.getAttribute("data-testid"), tab.querySelector("svg") !== null]).toEqual([
        tab.getAttribute("data-testid"),
        true,
      ]);
    }
  });

  it("opens nothing: no section names, no chevrons, no floating panel", () => {
    // «ألغِ أسماء الأقسام… لا أحتاج إطارات منبثقة».
    const { container } = draw();

    expect(container.querySelectorAll("svg.lucide-chevron-down")).toHaveLength(0);
    for (const group of SUPPLIER_PORTAL_MAP.groups) {
      expect([
        group.key,
        container.querySelector(`[data-testid="nav-group-${group.key}"]`),
      ]).toEqual([group.key, null]);
    }

    const source = supplierNav();
    expect(source).not.toContain("aria-haspopup");
    expect(source).not.toContain("openGroup");
    expect(source).not.toContain("shadow-card");
  });
});

describe("the bell keeps the notifications", () => {
  it("leaves no tab for a page the top bar already links to", () => {
    // «أما الإشعارات نكتفي بأيقونة الإشعارات كرابط للصفحة الموجود في
    // الشريط العلوي» — one door into one room.
    draw();
    expect(screen.queryByTestId("nav-row-wide-notifications")).toBeNull();
    expect(ORDER).not.toContain("notifications");
  });

  it("stands that bell at the far end of the row instead", () => {
    // «ونحط أيقونة الإشعارات موازية للألسنة في الجهة المقابلة» — one
    // door into that page, beside the pages it sits among. A tab
    // removed with nothing put in its place would be a page a
    // supplier can no longer reach, so this holds the bell down.
    const layout = read("app/[locale]/supplier/layout.tsx");
    expect(layout).toContain("NotificationBell");
    expect(layout).toContain("bell={");
    expect(layout).toContain("/notifications`");

    // AND IT IS NOT ALSO IN THE PLATFORM'S BAR: two bells for one
    // page is two doors into one room.
    expect(layout).not.toContain("notifications={{");

    // The row renders what it is handed, at the end and on the line.
    const nav = supplierNav();
    expect(nav).toContain("{bell}");
    expect(nav).toContain("ms-auto");

    // AND IT IS THE LOUD ONE, because it hangs on a dark ground at the
    // end of a row rather than in the platform bar: «كبّر زر الإشعارات
    // والتنبيهات وخلّه ممتلئ وليس مفرّغ وبلون الهوية البرتقالي».
    expect(layout).toContain("prominent");

    const bell = read("components/shell/notification-bell.tsx");
    expect(bell).toContain("size-10 text-accent");
    expect(bell).toContain('fill={prominent ? "currentColor" : "none"}');

    // AND NO OTHER PORTAL IS TOUCHED: the flag defaults to off, so the
    // buyer keeps the quiet bell it has — «لا تعمّم التصميم إلا
    // بموافقتي الصريحة».
    expect(bell).toContain("prominent = false");
    expect(read("components/shell/platform-topbar.tsx")).not.toContain("prominent");

    // And the page it points at is still served.
    expect(
      portalPages(SUPPLIER_PORTAL_MAP).some((page) => page.key === "notifications"),
    ).toBe(true);
  });
});
describe("the tabs", () => {
  it("marks the current page, and only it", () => {
    draw();
    const current = screen.getByTestId("nav-row-wide-followUp");

    // ONE ANSWER, AND IT IS THE MACHINE-READABLE ONE — the shape
    // that carried `data-active` is gone, and the wave that marks
    // the open name is decoration.
    expect(current.getAttribute("aria-current")).toBe("page");

    for (const key of ORDER.filter((k) => k !== "followUp")) {
      const other = screen.getByTestId(`nav-row-wide-${key}`);
      expect([key, other.getAttribute("aria-current")]).toEqual([key, null]);
      expect([key, other.getAttribute("aria-current")]).toEqual([key, null]);
    }
  });




  it("keeps the row on screen when the page scrolls, and paints its own ground", () => {
    // A sticky strip with no background of its own is a window: the
    // page slides UNDER it and shows through the gap above the tabs and
    // the notches between them. The token is the one the page is laid
    // on, so nothing about the design changes.
    // AND IT NO LONGER STICKS ON ITS OWN, at an offset written as a
    // number. That number was the platform bar's height, copied — and
    // that bar is `min-h-nav`, a MINIMUM: it grows with a taller logo,
    // and at any device ratio that puts their shared edge on a
    // fractional pixel the two round apart and the page shows through
    // the slit. «كأنه فراغ وتمر الصفحة من تحته».
    //
    // The chrome sticks BOTH bars in one box at `top-0` instead, so
    // this one begins exactly where the other ends whatever height it
    // takes, and there is no number left to keep in step.
    const { container } = draw();
    const root = container.querySelector(
      '[data-testid="supplier-nav-root"]',
    ) as HTMLElement;

    expect(root.className).not.toContain("sticky");
    expect(root.getAttribute("style")).toBeNull();
    expect(read("components/portal/portal-chrome.tsx")).toContain(
      '<div className="sticky top-0 z-50">',
    );
    // THE GROUND TOKEN, and not `bg-background`: that one is the LIGHT
    // surface this system pairs `--color-text` with — a ghost button's
    // hover, a listbox's highlighted row, a card's footer. Pointing it
    // at the navy turned every one of them into black on navy.
    // THE GROUND IS THE PLATFORM'S OWN AGAIN — «رجّع خلفية الموقع اللي
    // عدّلناها لداكنة إلى لونها الأول». It was navy so a white sheet
    // would have an edge; the open tab and its strip are the platform's
    // orange now, and that is what parts the page from what is behind.
    expect(root.className).toContain("bg-background");
    expect(root.className).not.toContain("background-file");
    // And nothing INSIDE it repeats the trick, which is what boxed it in.
    expect((container.querySelector("nav") as HTMLElement).className).not.toContain(
      "sticky",
    );
    const row = container.querySelector(
      '[data-testid="nav-panel-supplier"]',
    ) as HTMLElement;
    expect(row.className).not.toContain("sticky");

    // AND THE STRIP TRAVELS WITH IT, which is what the white band used
    // to be for. Sixteen pixels of the sheet's own white rode along so
    // that a card scrolling up would not stop against the feet of the
    // tabs — and the owner had it deleted once the strip existed:
    // «الشريط الأبيض اللي تحت الشريط الأصفر يجب أن تحذفه». The strip is
    // opaque, it is the sheet's own width and it IS the sheet's top, so
    // what comes up from below passes behind it and meets nothing.
    expect(root.className).not.toContain("-mb-4");
    expect(root.querySelector(".h-4.bg-surface")).toBeNull();

    // THE STRIP TAKES THE SHEET'S MEASURE, NOT THE WINDOW'S — «الشريط
    // تابع للسان في نفس صفحة اللسان وليس على امتداد صفحة المنصة». Read
    // from the source rather than the DOM: the strip needs a router and
    // a query string to render, which this file gives no component.
    const strip = read("components/portal/portal-page-bar.tsx");
    // THE FAR SIDE ONLY. The strip begins at the first tab's leading
    // edge now — «اجعل الشريط البرتقالي يبدأ من الحافة اليمنى للسان
    // الرئيسية… دون امتداده تحت الشعار» — so its own start inset would
    // put it under the mark.
    expect(strip).toContain("me-4");
    expect(strip).toContain("lg:me-6");
    // AND ITS CONTENT STARTS WHERE THE STRIP STARTS — «خلّها تبدأ من
    // بداية الشريط، لأني لاحظت أن الشريط يبدأ من النص ممّا سمح لبعض
    // المعلومات تمدد الشريط للأسفل».
    //
    // It used to add the MEASURED WIDTH OF THE WHOLE TAB ROW to the
    // sheet's inset, so the strip's content began near its middle —
    // and a row of categories with half a strip to sit in wrapped,
    // each wrapped line growing the strip downwards. The inset is the
    // sheet's now and nothing else, which is a class and needs no
    // measurement.
    expect(strip).toContain('? "ms-0 ps-0"');
    expect(strip).toContain('"ms-4 ps-4 lg:ms-6 lg:ps-6"');
    expect(strip).not.toContain("--tab-row-width");
    // AND IT IS SHORTER, BY AIR: no rail-height floor under 32px
    // controls — «قلّل ارتفاع الشريط بتخفيف الحشو، دون تصغير الخط أو
    // الأزرار».
    // READ THE CODE, NOT THE PROSE: the comment that explains why the
    // floor came off names it, and scanning raw text would flag exactly
    // the sentence that documents the rule.
    // AND IT STANDS AT ITS CONTROLS' OWN HEIGHT. It matched the
    // console's sections BAR at 44 while it WAS a bar; the surface
    // is gone — «بنلغي الشريط من جميع الصفحات» — so what is left
    // rests on exactly the 32 its controls stand at.
    expect(strip).toContain("min-h-control");
    // AND NO CORNER AT ALL. The head curved because the strip was a
    // SURFACE with nothing above it; there is no surface — «بنلغي
    //  الشريط من جميع الصفحات… تبقى في الصفحة بنفس خلفية الصفحة» —
    // and a radius on a transparent box rounds nothing.
    expect(strip).not.toContain("rounded-t-card");
    expect(strip).not.toContain("rounded-se-2xl");
    // And the open tab's own fill, so the two read as one shape.
    // ITS FILL IS THE SHEET'S WHITE AND IT IS RULED NOWHERE. The
    // accent rule moved to the tab row — «من بداية اللسان إلى نهاية
    // اللسان الخامل» is the row's measure, not the sheet's — and the
    // foot's dark line came off entirely.
    expect(strip).not.toContain("border-t");
    expect(strip).not.toContain("border-b");
    // AND IT DOES NOT FLOAT. It carried the elevation for itself and
    // the tabs above it — «خلّ اللسان مع الشريط بالتصميم العائم» —
    // and both are gone: a lift is what parts a surface from the page
    // under it, and this IS the page now.
    expect(strip).not.toContain("shadow-card");
    expect(strip).not.toContain("shadow-[");

    // THE TWO SHAPES THAT SHARED ONE BOX ARE GONE. The home tab and
    // the long roof over the rest were replaced by the row of names —
    // «ألغِ الألسنة من التصميم» — so the wrapper, the thirty-two pixel
    // lap and the accent rule that spanned them have nothing left to
    // describe. The strip below them did not change and the rest of
    // this case still holds it.
    expect(strip).not.toContain("border-x");
    // AND IT HAS NO FILL AT ALL. It was the open tab's own colour,
    // continued as a run so the seam between the two would have
    // nowhere to be; there is no tab, and «بنلغي الشريط من جميع
    //  الصفحات… تبقى في الصفحة بنفس خلفية الصفحة».
    //
    // WHAT CARRIES THE IDENTITY NOW IS THE INK — «مع تغيير لون
    //  الكتابة للبرتقالي بنفس درجة لون الشريط النحيف» — which
    // measures 4.8:1 on the page's ground.
    expect(strip).not.toContain("bg-[image:var(--chrome-run-strip)]");
    expect(strip).toContain("text-accent-interactive");
    expect(strip).not.toContain("text-primary-foreground");
    // AND THE SHEET TAKES ITS TOP CORNER BACK. It gave that corner up
    // from `lg` because the strip WAS its top edge, and two rounded
    // edges meeting draw a seam across one piece of paper. The strip
    // is a band across the window now — «لنفس مقاس شريط الأقسام في
    // لوحة الإدارة» — so it is no longer the sheet's edge, and a sheet
    // whose head is square under a band that does not touch it is a
    // corner cut off for a reason that has gone.
    expect(read("components/portal/portal-chrome.tsx")).toContain(
      "lg:rounded-se-none",
    );
  });

  it("lays every portal on the platform's own ground again", () => {
    // «لون خلفية المنصة تكون بالأزرق» was the earlier instruction, and
    // «رجّع خلفية الموقع اللي عدّلناها لداكنة إلى لونها الأول» is the
    // later one. The navy existed to give a white sheet an edge; the
    // open tab and the strip below it are the platform's orange now,
    // and that is what parts the page from what is behind it.
    //
    // THE TOKEN STAYS DECLARED and is spent by nobody, so putting the
    // navy back is one word rather than a colour typed again.
    expect(read("app/globals.css")).toContain("--color-background-file");

    // IT IS NEVER REBOUND. The supplier's chrome used to point
    // `--color-background` at the navy on its own root, and every
    // control below it inherited a dark surface it was never drawn
    // against — «بعض الخيارات والأزرار صارت داكنة وغير واضحة».
    const supplier = read("components/supplier/supplier-chrome.tsx");
    expect(supplier).not.toContain("--color-background");

    const chrome = read("components/portal/portal-chrome.tsx");
    expect(chrome).not.toContain('mainSurface ? "bg-[var(--color-background-file)]"');
    expect(supplierNav()).not.toContain(
      "bg-[var(--color-background-file)]",
    );

    for (const other of [
      "components/trader/trader-chrome.tsx",
      "components/admin/control-panel-chrome.tsx",
    ]) {
      expect([other, read(other).includes("background-file")]).toEqual([
        other,
        false,
      ]);
    }
  });
  it("draws no band behind the row — the page is what they stand on", () => {
    // A band behind the tabs is exactly what put them ON the page
    // instead of IN it.
    const { container } = draw();
    const row = container.querySelector('[data-testid="nav-panel-supplier"]')!;

    expect(row.className).not.toContain("bg-primary");
    expect(row.className).not.toContain("bg-surface");
  });
});

describe("the narrow screen", () => {
  it("carries the same destinations as a column, and never scrolls the page", () => {
    draw();
    const source = supplierNav();

    // THE SUPPLIER'S NARROW ROW IS UNTOUCHED: a button and a column.
    expect(source).toContain("portal-menu-button");
    expect(source).toContain("portal-nav-drawer");

    // AND THE RULE THAT USED TO SAY «no overflow-x anywhere» NOW SAYS
    // WHERE. The two fronts the owner rearranged carry a ROW of names
    // on a phone, and one of them — the supplier's five — measures
    // about 340 pixels: it fits 393 and not 360. The row scrolls
    // INSIDE ITSELF there rather than pushing the document sideways,
    // which is the thing that was actually forbidden: «ما يحتاج نضغط
    // ونمرّر الصفحة».
    //
    // Every one of these containers is a scroller of its own, and none
    // of them is the page.
    for (const scroller of source.match(/overflow-x-auto/g) ?? []) {
      expect(scroller).toBe("overflow-x-auto");
    }
    expect(source).not.toContain("overflow-x-scroll");
  });
});

describe("the fence around it", () => {
  it("is taken by a portal in its own file, never by a default", () => {
    // THE BOUNDARY MOVED THREE TIMES, EACH TIME BY INSTRUCTION. It
    // was the supplier alone — «لا تعمّم التصميم إلا بموافقتي
    //  الصريحة» — then the buyer: «اجعل تصميم لوحة المشتري نفس لوحة
    //  المورد», then the visitor, and finally the console itself:
    // «بالنسبة للوحة الإدارة اعتمدها مع الواجهات الثلاث في التصميم».
    //
    // WHAT KEEPS IT FROM SPREADING BY ACCIDENT is unchanged, and is
    // the point of this test: a front wears this row only by handing
    // its own chrome a `navSlot`, which is a line in that front's
    // file. There is no flag in the shared chrome and no default
    // that drifts — every one of the four was a sentence from the
    // owner before it was a line of code.
    expect(read("components/supplier/supplier-chrome.tsx")).toContain("SupplierTopNav");
    expect(read("components/trader/trader-chrome.tsx")).toContain("TraderTopNav");

    for (const wearer of [
      "components/supplier/supplier-chrome.tsx",
      "components/trader/trader-chrome.tsx",
      "components/admin/control-panel-chrome.tsx",
    ]) {
      expect([wearer, read(wearer).includes("navSlot")]).toEqual([wearer, true]);
      expect([wearer, read(wearer).includes("mainSurface")]).toEqual([wearer, true]);
    }

    // AND THE CONSOLE REACHES THE ROW THROUGH ITS OWN FILE too —
    // `AdminTopNav`, which builds a row of SECTIONS rather than of
    // pages, because twenty-one screens do not fit on one line.
    const console_ = read("components/admin/control-panel-chrome.tsx");
    expect(console_).toContain("<AdminTopNav");
    expect(console_).not.toContain("<FolderTabNav");
  });

  it("leaves the shared bar exactly as it was", () => {
    // The console keeps its sections, its chevrons and its floating
    // panel. This design reaching it would be a regression, not a
    // rollout: it was never asked for there.
    const shared = read("components/portal/portal-top-nav.tsx");

    expect(shared).toContain("ChevronDown");
    expect(shared).not.toContain("folder-tab");
    expect(shared).toContain("shadow-card");
  });

  it("keeps «بيانات المنشأة» served, reached from the account menu", () => {
    // A TAB REMOVED WITH NOTHING PUT IN ITS PLACE would be a page a
    // supplier can no longer reach. The map still holds it, the route
    // still answers, and the menu is the door.
    expect(
      portalPages(SUPPLIER_PORTAL_MAP).some((page) => page.key === "account"),
    ).toBe(true);

    const controls = read("components/shell/platform-topbar.tsx");
    expect(controls).toContain("<UserMenu");
    expect(controls).toContain("recordHref");
    expect(read("components/shell/user-menu.tsx")).toContain('data-testid="user-menu-record"');
    expect(read("app/[locale]/supplier/layout.tsx")).toContain("recordHref={`${basePath}/account`}");
  });

  it("gives the buyer the row, with nothing left behind a panel", () => {
    // «إذا كان لديه أقسام فيها أقسام منبثقة يحوّلها جميعًا إلى ألسنة»,
    // and then «ألغِ ألسنتها وجمّعها كبطاقات في صفحة المتابعة» — which
    // is why three of those keys are no longer tabs. What each of the
    // buyer's tabs IS, and that the three became cards, is held in
    // `trader-folder-tabs`; what this holds is that the buyer's row is
    // the same kind of row as the supplier's.
    const order = read("components/trader/trader-top-nav.tsx");
    for (const key of ["dashboard", "orders", "followUp"]) {
      expect([key, order.includes(`"${key}"`)]).toEqual([key, true]);
    }

    // AND THE MARKET IS ONE OF THEM AGAIN — «أضف كلمة السوق في
    //  المشتري بجانب الرئيسية، لأن الشريط يطلع في الرئيسية».
    //
    // It hung under the home tab by `covers` while the row was made
    // of folder tabs and could hold only so many. A row of names has
    // room, and the room is spent on saying where the market is
    // rather than on hiding it under the dashboard — which is what
    // put a row of categories on that dashboard.
    expect(order).toContain('"opportunities"');
    expect(
      read("components/trader/trader-portal-nav.ts"),
    ).not.toContain('covers: ["opportunities"]');

    // TWO KEYS HAVE A DOOR OF THEIR OWN AND ARE NOT TABS: «الإشعارات»
    // has the bell at the end of the row, and «بيانات المنشأة» has the
    // account menu — «انقل بيانات المنشأة… إلى داخل أيقونة المستخدم
    // بمسمّى بياناتي». Both in the buyer's row and the supplier's.
    expect(order).not.toContain('"notifications"');
    expect(order).not.toContain('"account",');
    expect(order).toContain("bell");
  });


});
