import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionRequired } from "@/components/portal/action-required";

/**
 * FIVE POINTS, ASKED FOR TOGETHER, HELD TOGETHER.
 *
 * «١. اجعل الشريط البرتقالي يبدأ من الحافة اليمنى للسان الرئيسية ويمتد
 * لليسار، دون امتداده تحت الشعار… ٢. قلّل ارتفاع الشريط بتخفيف الحشو،
 * دون تصغير الخط أو الأزرار. ٣. انقل «يتطلب انتباهك» إلى اختصار تحت
 * الشعار باسم «إجراء مطلوب»… ٤. اجعل نص «تسجيل الدخول» وأيقونته بلون
 * الهوية الأزرق، بدون خلفية أو إطار أو ظل. ٥. أبقِ جرس التنبيهات
 * ممتلئًا وبرتقاليًا.»
 */
const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const code = (relative: string) => read(relative).replace(/\/\/.*$/gm, "");

const LABELS = {
  title: "إجراء مطلوب",
  clear: "لا شيء يتطلب إجراءً الآن.",
  countLabel: "حالات تحتاج إجراءً",
};

/**
 * THE ROWS ARRIVE ALREADY BUILT AND ALREADY TRANSLATED, so the shortcut
 * serves both portals without knowing what an order or a dispute is —
 * «إجراء مطلوب لمّا يظهر في واجهة المشتري».
 */
const rowsOf = (orders: number, disputes: number, replacements: number) => [
  {
    key: "orders",
    count: orders,
    text: "طلبات بانتظار التجهيز",
    href: "/ar-SA/supplier/orders",
  },
  {
    key: "disputes",
    count: disputes,
    text: "منازعات تحتاج ردك",
    href: "/ar-SA/supplier/follow-up",
  },
  {
    key: "replacements",
    count: replacements,
    text: "مرتجع بانتظار التنفيذ",
    href: "/ar-SA/supplier/follow-up",
  },
];

const NONE = rowsOf(0, 0, 0);

describe("1 — the strip spans the page card, mark included", () => {
  it("takes the sheet's own inset, and asks for no flush", () => {
    // «واجعل الأشرطة كاملة تبدأ من بداية بطاقة الصفحة وليس من بداية
    // لسان الرئيسية». The mark was a column of its own holding the strip
    // off; it stands IN the row now and the strip runs the whole
    // measure below it.
    const bar = code("components/portal/portal-page-bar.tsx");
    // IT IS THE CONSOLE'S SECTIONS BAR, EDGE TO EDGE — «لم تغيّر مقاس
    // شريط اللسان لنفس مقاس شريط الأقسام في لوحة الإدارة».
    //
    // `portal-top-nav` runs `w-full … px-4 lg:px-6` at `min-h-nav`.
    // This strip was inset 24 a side and 32 tall; both matched now.
    // The margins and the rounded top corners went together: a band
    // that reaches both edges is not a card, and a rounded corner at
    // the window's edge is a card's corner with no card behind it.
    // THE INSET SURVIVED THE STRIP ITSELF. What the owner removed
    // was the SURFACE — «بنلغي الشريط من جميع الصفحات… وأي معلومات
    //  في الأشرطة تبقى في الصفحة بنفس خلفية الصفحة» — and what is
    // left is a line of the page's own content, which still has to
    // line up with the rest of the page.
    expect(bar).toContain("me-4");
    expect(bar).not.toContain("rounded-t-card");
    expect(bar).not.toContain("shadow-card");
    expect(bar).not.toContain("chrome-run-strip");
    // AND ITS INK IS THE IDENTITY'S — «مع تغيير لون الكتابة
    //  للبرتقالي بنفس درجة لون الشريط النحيف». White text needed a
    // dark surface; there is none.
    expect(bar).toContain("text-accent-interactive");
    expect(bar).not.toContain("text-primary-foreground");
    // THIRTY-TWO, NOT FORTY-FOUR. Forty-four was the console's
    // sections BAR, and this is no longer a bar.
    expect(bar).toContain("min-h-control");
    // AND THE INNER PADDING SURVIVES, so words never touch the glass.
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
    expect(bar).toContain('? "ms-0 ps-0"');
    expect(bar).toContain('"ms-4 ps-4 lg:ms-6 lg:ps-6"');
    expect(bar).not.toContain("--tab-row-width");

    for (const nav of [
      "components/supplier/supplier-top-nav.tsx",
      "components/trader/trader-top-nav.tsx",
      "components/visitor/visitor-top-nav.tsx",
    ]) {
      expect([nav, read(nav).includes("flush")]).toEqual([nav, false]);
    }

    // AND THE ROW IS ONE ROW: no column beside it, and the strip a
    // sibling under the whole panel again.
    const row = code("components/portal/folder-tab-nav.tsx");
    expect(row).not.toContain('<div className="flex items-stretch">');
    // AND NO STRIP HANGS OFF THE ROW AT ALL — «ما أحتاج شريط، وأي
    //  معلومات كانت في الأشرطة السابقة تنزل في الصفحة». The line it
    // drew from `lg` up, and the narrow copy below it, are both
    // inside the page now; see `PortalChrome`.
    expect(row).not.toContain('className="hidden lg:block"');
    expect(row).not.toContain('data-testid="nav-page-strip"');
    expect(row).not.toContain("{strip}");
    // AND IT MEASURES NOTHING. The observer that reported the row's
    // width to the strip is gone with the padding that read it — a
    // ResizeObserver still running to set a variable nobody reads is
    // work done on every resize for no pixel on the screen.
    // THE CODE FORM, not the string: the comment above the row still
    // names the variable to say why it went, and a guard that forbade
    // the WORD would forbid the explanation with it.
    expect(row).not.toContain('["--tab-row-width" as string]');
    expect(row).not.toContain("new ResizeObserver");
    expect(row).not.toContain("getBoundingClientRect");

    // THE MARK IS IN THE ROW, AND THE TAB STANDS AGAINST IT — «قرّبه
    // إلى جنب الشعار… أهم شيء أن ما يكون بينهم مسافة في كل الحالتين».
    //
    // Thirty-two pixels sat here once, to keep the tab's slanted start
    // from reading as the mark's own edge. A FIXED gap beside a mark
    // whose size the tenant sets is a chasm next to a small logo and a
    // hair next to a large one; zero is the only measure that holds at
    // every size, and the slant does the separating on its own.
    expect(row).toContain(
      '<div className="flex shrink-0 items-center pb-2">{brand}</div>',
    );
    expect(row).not.toContain("pe-8");
  });
});

describe("2 — the strip is shorter by air, not by type", () => {
  it("drops the rail-height floor and keeps the controls' own", () => {
    const bar = code("components/portal/portal-page-bar.tsx");

    // THIRTY-TWO IS THE FLOOR NOW. Forty-four came from matching the
    // console's sections BAR; with the surface gone there is no bar
    // to match, and the line rests on exactly the height its own
    // controls stand at.
    expect(bar).toContain("min-h-control");
    expect(bar).not.toContain("min-h-nav");
    // A FLOOR REMAINS, because a line that collapses to its padding
    // when it is empty makes the page jump the moment something
    // appears in it. What it does NOT have any more is air of its
    // own on top — «ألغِ أي أزرار داخل مربع… عشان أقلّل ارتفاع
    //  الشريط»: nothing in it is boxed, so there is no box padding
    // to sit around.

    // AND NOTHING IN A STRIP IS A BOX. «ألغِ أي أزرار داخل مربع في أشرطة
    // اللسان واكتفِ بالأيقونة أو الاسم أو الأيقونة والاسم.»
    const strip = code("components/portal/portal-page-bar.tsx");
    const action = strip.slice(strip.indexOf("links.action ? ("));
    for (const box of [
      "rounded-control",
      "bg-surface",
      "shadow-raised",
      "px-control-x",
    ]) {
      expect(action.slice(0, action.indexOf("</Link>"))).not.toContain(box);
    }

    // THE MARKET'S SEARCH LOST ITS PILL TOO, and the dashboard's
    // refresh lost the ghost's boundary.
    expect(code("components/supplier/dashboard-header.tsx")).toContain(
      'variant="bare"',
    );

    // AND A BARE BUTTON IS REALLY BARE. A shadow under a transparent
    // button is a floating rectangle with no button in it — the very
    // box being struck off. The lift is decided WITH the measurements
    // rather than in the variant, because `cn` joins classes and does
    // not merge them: a `shadow-none` beside the fill loses to the
    // base by the stylesheet's own order, silently.
    const button = code("components/ui/button.tsx");
    expect(button).toContain('variant === "bare"');
    expect(button).toContain(
      '? "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"',
    );
    expect(button).toContain(
      'bare: "bg-transparent text-content border-0 hover:bg-background"',
    );
    // The flat one must not try to win the shadow back in its own map.
    expect(
      button.slice(button.indexOf("bare:"), button.indexOf("bare:") + 120),
    ).not.toContain("shadow");
    expect(bar.replace(/\/\/.*$/gm, "")).not.toContain("py-1");

    // AND NOTHING SHRANK. The controls keep the platform's own height,
    // and the type is untouched.
    expect(bar).toContain("min-h-control"); // the links inside it
    expect(bar).not.toMatch(
      /text-\[length:var\(--control-font-size\)\][^"]*text-xs/,
    );
  });
});

describe("3 — «إجراء مطلوب»", () => {
  it("draws nothing when nothing waits, and the count when something does", () => {
    // «ليش ما نخفيه، وإذا صار فيه إجراء مطلوب يظهر بجانب أيقونة
    // الإشعارات» — it used to show a zero on every page that had nothing
    // to report, and a counter that is always there and usually zero is
    // a counter nobody reads. Its PRESENCE is the message now.
    const { container } = render(
      <ActionRequired rows={NONE} labels={LABELS} />,
    );
    expect(container).toBeEmptyDOMElement();

    render(<ActionRequired rows={rowsOf(2, 1, 0)} labels={LABELS} />);
    expect(screen.getByTestId("action-required-count").textContent).toBe("3");

    // AND IT STANDS BESIDE THE BELL, in the row's end group.
    const row = code("components/portal/folder-tab-nav.tsx");
    expect(row).toContain("{alert}");
    expect(row.indexOf("{alert}")).toBeLessThan(
      row.indexOf("{bell}\n                {controls}"),
    );
  });

  it("carries the name in navy and the count on a pale orange box", () => {
    render(<ActionRequired rows={rowsOf(1, 0, 0)} labels={LABELS} />);

    expect(screen.getByTestId("action-required").className).toContain(
      "text-primary",
    );
    const box = screen.getByTestId("action-required-count");
    // «مربع صغير بزوايا ناعمة وخلفية برتقالية فاتحة» — the identity's
    // own accent mixed down into the page's white, never a second
    // orange typed by eye.
    expect(box.className).toContain("rounded-md");
    expect(box.className).toContain(
      "color-mix(in_srgb,var(--color-accent)_22%,var(--color-surface))",
    );
  });

  it("carries no arrow and no second glyph", () => {
    // «بدون سهم أو أيقونة إضافية».
    const { container } = render(
      <ActionRequired rows={rowsOf(1, 0, 0)} labels={LABELS} />,
    );
    expect(
      container.querySelector('[data-testid="action-required"] svg'),
    ).toBeNull();
  });

  it("shows the states when pressed, each linking to the page that holds it", () => {
    // «الضغط يعرض الحالات».
    render(<ActionRequired rows={rowsOf(2, 1, 0)} labels={LABELS} />);

    expect(screen.queryByTestId("action-required-panel")).toBeNull();
    fireEvent.click(screen.getByTestId("action-required"));

    expect(screen.getByTestId("action-required-panel")).toBeInTheDocument();
    expect(
      screen.getByTestId("action-required-orders").getAttribute("href"),
    ).toBe("/ar-SA/supplier/orders");
    expect(
      screen.getByTestId("action-required-disputes").getAttribute("href"),
    ).toBe("/ar-SA/supplier/follow-up");
    // A COUNT OF ZERO IS NOT A STATE. A row that says "0 disputes" is a
    // row that teaches people to stop reading the list.
    expect(screen.queryByTestId("action-required-replacements")).toBeNull();
  });

  it("is on the buyer's front too, from the same component", () => {
    // «إجراء مطلوب لمّا يظهر في واجهة المشتري». There is no one endpoint
    // for a buyer's counts — the supplier has a dashboard read that
    // carries its three figures and the buyer has none — so the three
    // lists «المتابعة» already draws are read in the layout and counted.
    const layout = read("app/[locale]/trader/layout.tsx");

    expect(layout).toContain("<ActionRequired");
    expect(layout).toContain("loadDisputes");
    expect(layout).toContain("loadReplacements");
    expect(layout).toContain("loadMyProductReports");

    // SIDE BY SIDE, never in sequence.
    expect(layout).toContain("await Promise.all([");

    // AND A FAILED READ COUNTS ZERO rather than removing the shortcut.
    expect(layout).toContain("disputes.ok");
    expect(layout).toContain(": 0,");
  });

  it("is gone from the dashboard, which is where it used to live alone", () => {
    const page = code("app/[locale]/supplier/page.tsx");
    expect(page).not.toContain("<AttentionPanel");
  });
});

describe("4 — the visitor actions form one compact filled group", () => {
  it("uses the identity fill without fixed text widths", () => {
    const bar = code("components/shell/platform-topbar.tsx");

    const declaration = bar.indexOf("const VISITOR_CONTROL_BASE =");
    const visitor = bar.slice(
      declaration,
      bar.indexOf("const MENU_ITEM", declaration),
    );
    expect(visitor).toContain("h-9");
    expect(visitor).toContain("rounded-control bg-primary");
    expect(visitor).toContain("text-primary-foreground");
    expect(visitor).toContain("shadow-raised");
    expect(visitor).toContain("px-2.5");
    expect(visitor).toContain("w-9 px-0");
    expect(visitor).not.toContain("min-w-");
  });
});

describe("the three glyphs at the row's end", () => {
  it("are solid, dark, and the bell's own size", () => {
    // «حجم أيقونة الإشعارات كبير بالنسبة للمستخدم واللغة، غيّر الأيقونتين
    // بنفس الأيقونات الممتلئة وليس المفرّغة، وخلّها باللون الداكن وخلّ
    // حجمها نفس حجم أيقونة الإشعارات».
    //
    // A STROKED 16 BESIDE A FILLED 24 is where the difference came
    // from, and it was never only size: an outline reads lighter than a
    // solid glyph at the identical frame.
    const icons = read("components/ui/icons.tsx");
    expect(icons).toContain("export function GlobeSolidIcon");
    expect(icons).toContain("export function UserSolidIcon");
    expect(icons).toContain('fill="currentColor"');
    // AND THE LINES INSIDE THE GLOBE ARE HOLES, NOT INK — painted in
    // the colour of the ground the disc stands on, which is the
    // page's own light everywhere this glyph is drawn.
    expect(icons).toContain('stroke="var(--color-background)"');

    expect(read("components/shell/user-menu.tsx")).toContain("<UserSolidIcon");
    expect(read("components/shell/locale-switch.tsx")).toContain(
      "<GlobeSolidIcon",
    );

    // THE SIZE IS ON THE CONTROL, not handed to the glyph: `cn` joins
    // classes and does not merge them, so a set's own size and a size
    // passed in would both reach the stylesheet and its order would
    // decide — which is how the smaller one won silently. A child
    // selector outranks both.
    expect(read("components/shell/user-menu.tsx")).toContain("[&>svg]:size-6");
    // And that is the bell's own measure.
    expect(read("components/shell/notification-bell.tsx")).toContain(
      'prominent ? "size-6"',
    );

    // THE LANGUAGE IS NO LONGER ONE OF THE THREE — «رجّع كلمة العربية
    // والإنجليزية بجانب أيقونة اللغة، ولهم متوازيين في الحجم حتى لو
    // تصغر الأيقونة عادي».
    //
    // It carries a WORD now, and a 24px mark beside fourteen-point type
    // is a picture with a caption rather than a control with a name. It
    // takes the platform's control height and a 20px glyph — the same
    // constant the console's own bar dresses this same control with, so
    // the two bars cannot drift.
    const bar = read("components/shell/platform-topbar.tsx");
    expect(bar).toContain("otherLocaleName={t(`localeName.${otherLocale}`)}");
    expect(bar).toContain("${LOCALE_CONTROL_BASE} text-primary");
    // The circle that held the bare globe has no user left.
    expect(bar).not.toContain("[&>svg]:size-6");

    // DARK, both of them — the bell alone wears the accent.
    expect(read("components/shell/user-menu.tsx")).toContain("text-primary");
    // The bar dresses BOTH its controls in the identity navy; the
    // circle that once held the bare globe is gone with it, so what is
    // asserted is the ink and not the shape it used to sit in.
    expect(read("components/shell/platform-topbar.tsx")).toContain(
      "text-primary",
    );
  });

  it("opens a menu rather than a card, with nothing between its rows", () => {
    // «الإطار المنبثق كبير وفيه فراغات وقبيح».
    const menu = read("components/shell/user-menu.tsx");

    expect(menu).toContain("min-w-max");
    expect(menu).toContain("p-1");
    expect(menu).not.toContain("min-w-44");
    expect(menu).not.toContain("gap-1 rounded-card");

    // A HAIRLINE BETWEEN THE ROWS RATHER THAN AIR.
    expect(menu).toContain("[&>*+*]:border-t");

    // AND NO GLYPH ON EITHER ROW — «ألغِ أيقونة الخروج من داخل أيقونة
    // المستخدم».
    expect(read("components/shell/platform-topbar.tsx")).toContain(
      "icon={false}",
    );
    expect(read("components/auth/sign-out-button.tsx")).toContain(
      "icon ? <SignOutIcon",
    );
  });
});

describe("5 — the bell stays loud", () => {
  it("is filled and wears the accent", () => {
    // «اختلافه عن بقية الأيقونات مقصود ليكون ملفتًا» — so nothing here
    // quietly brings it back into line with them.
    const bell = read("components/shell/notification-bell.tsx");
    expect(bell).toContain("size-10 text-accent");
    expect(bell).toContain('fill={prominent ? "currentColor" : "none"}');

    for (const layout of [
      "app/[locale]/supplier/layout.tsx",
      "app/[locale]/trader/layout.tsx",
    ]) {
      expect([layout, read(layout).includes("prominent")]).toEqual([
        layout,
        true,
      ]);
    }
  });
});
