import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * THE ONE SEARCH FIELD ON THE ROW OF TABS.
 *
 * «حقل بحث بجانب أيقونة الإشعارات، ويتمدد إلى آخر لسان موجود في
 *  الصفحة: في واجهة الزائر يمتد إلى لسان الرئيسية، وفي المورد أو
 *  المشتري إلى نهاية اللسان الثاني.»
 *
 * The chrome carried a comment where this now stands, explaining that a
 * general search field could not be built because the listing contract
 * accepted no text — «A field that takes typing and filters nothing is
 * worse than no field». The contract accepts text now.
 */

const pushMock = vi.fn();
let pathname = "/ar-SA";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathname,
}));

const { ChromeSearch } = await import("@/components/portal/chrome-search");

const LABELS = {
  action: "/ar-SA/opportunities",
  placeholder: "ابحث باسم المنتج أو وصفه",
  label: "ابحث في المنتجات",
  submitLabel: "ابحث",
};

function at(url: string) {
  const parsed = new URL(url, "http://localhost");
  pathname = parsed.pathname;
  // replaceState is what the field subscribes to, so this is not a
  // convenience here — it IS the event under test.
  window.history.replaceState({}, "", parsed.pathname + parsed.search);
}

beforeEach(() => {
  pushMock.mockReset();
  at("/ar-SA");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const type = (value: string) =>
  fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
const submit = () => fireEvent.submit(screen.getByTestId("chrome-search"));

describe("the search field in the row of tabs", () => {
  it("sends the term to the portal's own listing", () => {
    // «كلٌّ يبحث في عالمه» — the destination is handed in by the chrome
    // that knows it, so the visitor, the buyer and the supplier each
    // search what their own front already shows.
    render(<ChromeSearch {...LABELS} />);
    type("أسمنت");
    submit();

    expect(pushMock).toHaveBeenCalledWith("/ar-SA/opportunities?q=%D8%A3%D8%B3%D9%85%D9%86%D8%AA");
  });

  it("trims, and an empty box clears rather than searches for nothing", () => {
    at("/ar-SA/opportunities?q=قديم");
    render(<ChromeSearch {...LABELS} />);

    type("   ");
    submit();
    // The term is GONE from the address, not sent as an empty one.
    expect(pushMock).toHaveBeenCalledWith("/ar-SA/opportunities");
  });

  it("keeps the listing's filters when the search starts from the listing", () => {
    // A reader looking at one category who types a word means "within
    // this". Throwing the category away would answer a question they
    // did not ask.
    at("/ar-SA/opportunities?taxonomyNodeId=abc&sort=ENDING_SOON&page=4");
    render(<ChromeSearch {...LABELS} />);

    type("حديد");
    submit();

    const [url] = pushMock.mock.calls[0];
    const params = new URL(String(url), "http://localhost").searchParams;
    expect(params.get("taxonomyNodeId")).toBe("abc");
    expect(params.get("sort")).toBe("ENDING_SOON");
    expect(params.get("q")).toBe("حديد");
    // AND THE PAGE GOES. Page four of the old result is not page four
    // of the new one, and landing on an empty page four reads as "no
    // results".
    expect(params.get("page")).toBeNull();
  });

  it("starts a clean listing when the search starts anywhere else", () => {
    // The row is on every page. A term typed on the home page or inside
    // an order must not inherit whatever that address happened to carry.
    at("/ar-SA?ref=email&page=3");
    render(<ChromeSearch {...LABELS} />);

    type("حديد");
    submit();

    const params = new URL(String(pushMock.mock.calls[0][0]), "http://localhost").searchParams;
    expect(params.get("ref")).toBeNull();
    expect(params.get("q")).toBe("حديد");
  });

  it("shows the term the address already carries", () => {
    at("/ar-SA/opportunities?q=أسمنت");
    render(<ChromeSearch {...LABELS} />);
    expect(screen.getByRole("searchbox")).toHaveValue("أسمنت");
  });

  it("stops where the server stops", () => {
    // The listing's query object refuses a term over a hundred
    // characters with a 400. A field that let one be typed would be
    // promising a request that cannot succeed.
    render(<ChromeSearch {...LABELS} />);
    expect(screen.getByRole("searchbox")).toHaveAttribute("maxlength", "100");
  });

  it("is a search landmark with a named field and a submitter", () => {
    render(<ChromeSearch {...LABELS} />);
    expect(screen.getByRole("search")).toBeInTheDocument();
    expect(screen.getByLabelText(LABELS.label)).toBeInTheDocument();
    // Enter is how a search field is actually sent, and implicit
    // submission needs a submit button to exist.
    expect(screen.getByRole("button", { name: LABELS.submitLabel })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("reads legibly, and wears the platform's own field to do it", () => {
    // «الخط جاي باللون الأبيض ولا يبين، والحقل باهت ليس له حدود» — it
    // was white ink on a ten-per-cent wash of the navy behind it: no
    // edge, because the wash is nearly the bar's own colour, and ink at
    // barely two-to-one.
    //
    // AND THE FIX IS NOT A HAND-DRAWN WHITE BOX EITHER. The second
    // draft was, and the design system's own guard caught it: a page
    // that dresses its own control is how a system stops being one.
    // `Input` with the OUTLINED skin is white with a visible line and
    // no inner shadow — declared once, in the file that owns fields.
    const code = read("components/portal/chrome-search.tsx");
    expect(code).toContain('appearance="outlined"');
    expect(code).toContain('from "@/components/ui/field"');
    expect(code).not.toContain("bg-white/10");
    expect(code).not.toContain("text-primary-foreground");
    // NO RAW <input>, NO OUTLINE PUT BACK, NO HAND-PICKED SHADOW.
    expect(code).not.toContain("<input");
    expect(code).not.toContain("outline-none");
    expect(code).not.toContain("shadow-sm");
  });

  it("takes the row's free space rather than measuring the tabs", () => {
    // «يتمدد إلى آخر لسان موجود في الصفحة» is ONE rule, not two: the
    // field is `flex-1` between the tab shapes and the bell, so its
    // near edge is wherever the tabs stopped — the home tab alone on
    // the visitor's front, the long shape on the other two.
    const row = read("components/portal/folder-tab-nav.tsx");
    expect(row).toContain("{searchLabels ? (");
    expect(row).toContain('flex h-10 min-w-0 flex-1 items-center px-4');
    // AND THE BELL STOPS SHRINKING, or the field would squeeze it.
    expect(row).toContain('ms-auto flex h-10 shrink-0 items-center');
  });

  it("follows a term the address LOSES, not only one it gains", async () => {
    // «إزالة الفلاتر» goes from `/opportunities?q=حديد` to
    // `/opportunities`: the same path, a different query. Reading the
    // address once per PATH change left the word sitting in the box
    // describing a list nobody was looking at any more.
    //
    // AWAITED, like its neighbours. The hook now announces a navigation
    // in a microtask rather than inside the `pushState` call itself —
    // React forbids scheduling an update from the insertion-effect
    // phase, which is where the App Router calls `pushState` from. The
    // box still catches up in the same tick; the assertion simply has
    // to let that tick finish.
    at("/ar-SA/opportunities?q=حديد");
    const view = render(<ChromeSearch {...LABELS} />);
    await waitFor(() =>
      expect(screen.getByRole("searchbox")).toHaveValue("حديد"),
    );

    at("/ar-SA/opportunities");
    view.rerender(<ChromeSearch {...LABELS} />);
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue(""));
  });

  it("follows a second search on the same path", async () => {
    // The address changes and the path does not — the case that broke
    // three of the four attempts. Measured on the running build:
    // address ?q=حديد with «أسمنت» still in the box.
    at("/ar-SA/opportunities?q=أسمنت");
    const view = render(<ChromeSearch {...LABELS} />);
    expect(screen.getByRole("searchbox")).toHaveValue("أسمنت");

    at("/ar-SA/opportunities?q=حديد");
    view.rerender(<ChromeSearch {...LABELS} />);
    await waitFor(() =>
      expect(screen.getByRole("searchbox")).toHaveValue("حديد"),
    );
  });

  it("follows the back button, which is a popstate and not a push", async () => {
    at("/ar-SA/opportunities?q=حديد");
    const view = render(<ChromeSearch {...LABELS} />);
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("حديد"));

    // A real back button changes the address and fires popstate. The
    // component must not need a re-render to notice.
    window.history.replaceState({}, "", "/ar-SA/opportunities?q=أسمنت");
    window.dispatchEvent(new Event("popstate"));
    view.rerender(<ChromeSearch {...LABELS} />);
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("أسمنت"));
  });

  it("empties when the address loses the term entirely", async () => {
    at("/ar-SA/opportunities?q=حديد");
    const view = render(<ChromeSearch {...LABELS} />);
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("حديد"));

    at("/ar-SA/opportunities");
    view.rerender(<ChromeSearch {...LABELS} />);
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue(""));
  });

  it("leaves typing alone — the guard is the address, not the field", async () => {
    // Comparing the FIELD would overwrite it on every keystroke.
    at("/ar-SA/opportunities?q=حديد");
    const view = render(<ChromeSearch {...LABELS} />);
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveValue("حديد"));

    type("حديد مجلفن");
    view.rerender(<ChromeSearch {...LABELS} />);
    expect(screen.getByRole("searchbox")).toHaveValue("حديد مجلفن");
  });

  it("cannot be stranded by a Suspense boundary, because it has none", () => {
    // THE 0×0 GUARD. `useSearchParams` suspends during prerender, so
    // every caller needs a <Suspense> boundary — and on this app's
    // PRODUCTION build that boundary never resolved. Four measured
    // attempts: boundary in a server component; boundary in the client
    // row; boundary around pure client code. Each time the row slot
    // held `<template id="B:0">`, the finished form sat in `div#S:0`
    // at the end of <body>, and the field measured 0×0 at 1366 and
    // 1600. A unit test cannot see a streaming boundary, so what it
    // guards is the CAUSE: no hook, no boundary, anywhere in the path.
    const field = read("components/portal/chrome-search.tsx");
    const row = read("components/portal/folder-tab-nav.tsx");
    expect(field).not.toContain("useSearchParams(");
    // THE TAG, not the word: the note above the prop names the boundary
    // to say why there is none, and a guard on the bare word would
    // forbid its own explanation.
    expect(row).not.toContain("<Suspense");
    // AND THE FIELD IS RENDERED BY THE ROW ITSELF from plain strings,
    // never handed down as a server-rendered node.
    expect(row).toContain("<ChromeSearch {...searchLabels} />");
    expect(row).toContain("searchLabels?: {");
  });

  it("subscribes to the address, not to the router", () => {
    const hook = read("lib/use-query-param.ts");
    expect(hook).toContain('addEventListener("popstate"');
    expect(hook).toContain("pushState");
    expect(hook).toContain("replaceState");
    // ONE PATCH PER DOCUMENT. Removing it would restore a function
    // another listener may since have wrapped.
    expect(hook).toContain("if (patched");
  });


  it("puts a field in the supplier's drawer, at forty-four", () => {
    // The row is hidden below lg, so a phone had no search at all.
    // Two INSTANCES, not one node in two places: passing a single
    // server-rendered node to both cost the desktop its field,
    // measured 0x0 with BODY as its grandparent.
    const row = read("components/portal/folder-tab-nav.tsx");
    expect(row).toContain('data-testid="portal-nav-drawer-search"');
    // AND ONLY WHERE IT IS THE ONLY FIELD. The visitor and the buyer
    // have a search ROW of their own now — «وتحت شريط منتجات يجي
    // البحث» — and one search in two places inside one chrome is two
    // answers to one question.
    expect(row).toContain("{!ownerStack && searchLabels ? (");
    // FORTY-FOUR TALL IN THE DRAWER, set by a descendant selector,
    // because cn joins classes and two height utilities on one
    // element would be settled by stylesheet order.
    expect(row).toContain("[&_input]:h-11");
    expect(row).toContain("[&_button]:min-h-[44px]");
    // AND A SEARCH CLOSES IT, or the results arrive behind it.
    expect(row).toContain("onSubmitCapture={() => setDrawerOpen(false)}");
  });

  it("gives a narrow screen a way into the market at all", () => {
    // «الزائر على الجوال والآيباد لا يصل إلى السوق» — measured before
    // the first fix: zero VISIBLE links to /opportunities at 390 and
    // at 768.
    //
    // IT HAS TWO NOW, AND THEY ARE THE CHROME ITSELF. «بالنسبة لصفحة
    // الزائر بنحط جميع المنتجات جنب الرئيسية» — the catalogue is a
    // DESTINATION beside the front door; and «ليه ما نخلّيها في الشريط
    // نفس سطح المكتب وتنزلق» — the categories are the band under it.
    const row = read("components/portal/nav-row.tsx");
    const band = read("components/portal/category-band.tsx");
    const chrome = read("components/visitor/visitor-chrome.tsx");

    expect(chrome).toContain('key: "market"');
    expect(chrome).toContain("${basePath}/opportunities");
    expect(read("components/shell/app-shell.tsx")).toContain("CategoryBandSlot");

    // THE SIGNATURE IS ONE SHAPE ON TWO LEVELS: an orange wave under
    // the open destination, a white one under the open category, and
    // the carton rolls in the row above only.
    // NAMED BY THE ROW THAT DRAWS THEM: the wide row and the narrow
    // one are both in the document and the stylesheet chooses, so a
    // single id on both is an address that answers twice.
    expect(row).toContain("data-testid={`${idPrefix}-wave`}");
    expect(row).toContain("data-testid={`${idPrefix}-carton`}");
    expect(row).toContain("var(--color-accent-interactive)");
    expect(row).toContain("var(--color-on-primary)");
    expect(band).toContain('tone="band"');

    // AND IT IS MEASURED, NOT WRITTEN. «ليه ما يبدأ من النص ويوقف في
    // النص» was what a hard-coded offset produced; the wave takes the
    // open item's own box and the carton centres in it.
    expect(row).toContain("getBoundingClientRect");
    expect(row).toContain("ResizeObserver");
    // A FULL TURN EACH TIME, so the carton lands as it left.
    expect(row).toContain("turns * 360");
    // AND NOTHING MOVES FOR A READER WHO ASKED FOR LESS MOTION.
    expect(row).toContain("motion-reduce:transition-none");
  });
  it("gives every screen the page's own action, from one line", () => {
    // «في صفحة منتجاتي لا يظهر زر إضافة منتج في الشريط.» It lived in
    // a strip drawn from `lg` up, so a supplier on a phone could
    // reach the catalogue and had no way to add to it. The fix then
    // was a SECOND copy for narrow screens, built from the same
    // route table so the two could not offer different actions.
    //
    // THERE IS ONE LINE NOW, AT EVERY WIDTH, and it is inside the
    // page — «أي معلومات كانت في الأشرطة السابقة تنزل في الصفحة» —
    // so the question of keeping two in step is gone rather than
    // answered.
    const row = read("components/portal/folder-tab-nav.tsx");
    expect(row).not.toContain('data-testid="nav-page-action"');

    // AND EACH FRONT BUILDS IT FROM ITS OWN ROUTE TABLE.
    for (const [front, links] of [
      ["components/supplier/supplier-chrome.tsx", "supplierBarLinks"],
      ["components/trader/trader-chrome.tsx", "traderBarLinks"],
    ]) {
      const source = read(front);
      expect([front, source.includes(`links={${links}(pathname`)]).toEqual([
        front,
        true,
      ]);
    }
  });

  it("gives the supplier the same two bars, and its own contents", () => {
    // «امضِ في الثلاثة: المورد والزائر والمشتري.» The arrangement was
    // scoped to two fronts and the owner opened it to the third, so
    // this front now hands in the same slots the other two do.
    const supplier = read("app/[locale]/supplier/layout.tsx");
    expect(supplier).toContain("mobileControls");
    // AND THE BAR AT THE FOOT IS GONE FROM ALL OF THEM. It held
    // «المنتجات» and «العروض» and «الطلبات» and «المتابعة» — which
    // is exactly what the row of names under the mark holds now.
    // The owner's own rule, written when «الرئيسية» stood in both:
    // «تكرار زر الرئيسية تحت وفوق».
    expect(supplier).not.toContain("bottomLabels");
    expect(read("app/[locale]/trader/layout.tsx")).not.toContain(
      "bottomLabels",
    );
    // AND NO BAND AT ALL. It carried a SECOND search field under the
    // row of names — «الشريط في المورد والمشتري شمل حقل بحث مع أننا
    //  غيّرنا مكانه فوق» — and the one field this front needs is in
    // the bar at the top, on every page.
    //
    // NOR ANY CATEGORIES: this front sells into the market rather
    // than shopping in it — «كلٌّ يبحث في عالمه».
    expect(supplier).not.toContain("MarketBand");
    expect(supplier).not.toContain("CategoryBandSlot");
    // NOR ANY CATEGORY CARDS — those belong to a page that browses.
    expect(supplier).not.toContain("CategoryCards");

    // THE CONSOLE IS A DIFFERENT CHROME ENTIRELY and takes none of it.
    const admin = read("components/admin/control-panel-shell.tsx");
    expect(admin).not.toContain("BottomNav");
    expect(admin).not.toContain("MarketBand");
  });
  it("turns the rearranged fronts' own bar white", () => {
    // «الشريط العلوي أبيض، عشان كذا لما يكون كحلي يخرب شكل الشعار
    //  والأيقونات.» It was painted in the identity's navy for one
    // build, and the mark, the glyphs and the language disc each
    // needed a repair — three repairs for one wrong decision.
    //
    // IT IS TWO WHITE ROWS NOW: «يبقى الشريط فوق فيه الشعار
    //  والأيقونات، وتحته الوجهات» — and the search stays on every
    // page, «يبقى في كل الصفحات».
    const row = read("components/portal/folder-tab-nav.tsx");
    expect(row).toContain(
      '"flex items-center gap-2 border-b border-line bg-surface px-3 py-2 lg:hidden"',
    );
    expect(row).toContain("<ChromeSearch {...searchLabels} />");
    // THE ROW IS DERIVED WHERE IT IS NOT HANDED IN — the buyer and
    // the supplier take theirs from the same `tabOrder` the wide
    // screen draws.
    expect(row).toContain("items={rowItems}");
    expect(row).toContain("navRowItems ??");
    // AND NOTHING IS INVERTED ANY MORE.
    expect(row).not.toContain("--icon-cutout");
    expect(read("components/shell/platform-topbar.tsx")).not.toContain("onPrimary");
  });
  it("drops the menu button where the bar at the foot has the same doors", () => {
    // Every destination the drawer listed stands in the bottom bar
    // now, and a menu button that opens a second copy of it is a
    // second answer to one question. The supplier has no such bar and
    // still needs its drawer.
    const row = read("components/portal/folder-tab-nav.tsx");
    expect(row).toContain("!ownerStack && (tabs.length > 1 || Boolean(drawerExtra))");
    expect(row).toContain("{hasDrawer ? (");
  });});
