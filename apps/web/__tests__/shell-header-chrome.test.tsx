import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocaleSwitch } from "@/components/shell/locale-switch";

/**
 * `usePathname` is bound at import time, so a per-test `doMock` would
 * arrive too late. A hoisted holder lets each test set the path the
 * control should read before it renders.
 */
const nav = vi.hoisted(() => ({ pathname: "/ar-SA", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  // The control keeps the query across a language change, so it reads
  // this too.
  useSearchParams: () => new URLSearchParams(nav.search),
}));

/**
 * The page furniture above the content: the two bars that stay put, and
 * the control that changes language.
 *
 * The bars are checked by READING THE SOURCE rather than by rendering,
 * because `position: sticky` is a layout behaviour and jsdom computes no
 * layout — a rendered assertion here could only re-state the class name
 * it just read, dressed up as a behaviour. What can be checked
 * honestly is the arrangement that makes the behaviour possible: one
 * sticky wrapper around both bars rather than two that have to agree on
 * a height.
 *
 * The language control IS rendered, because what matters about it —
 * which URL it points at — is real behaviour and nothing to do with
 * layout.
 */

/**
 * THE ONE BAR, and what it is made of.
 *
 * These used to describe the public header alone — a centred mark, a
 * sticky wrapper holding two bars, a sign-in button on a white ground.
 * There were four bars then. There is one now, and every rule that
 * mattered survived the move; what changed is where to look for it and
 * what colour it is painted.
 */
/** Source with comments removed — a rule must not fail on prose about itself. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** One reader, so a path is written once. */
const read = (relative: string) =>
  readFileSync(join(process.cwd(), relative), "utf8");

const BAR = read("components/shell/platform-topbar.tsx");

describe("one bar, on every screen", () => {
  it("is a single component, not one per audience", () => {
    // The public site, the two portals, the console and the sign-in
    // page each built their own. Four bars is four places for the logo
    // to be a different size and the language control to sit on a
    // different side.
    //
    // THREE OF THEM HAVE NO BAR AT ALL NOW — «احذف الشريط العلوي واعتبر
    // الألسنة هي الشريط العلوي في الثلاث واجهات». What the rule was
    // protecting still holds and is what this checks: the mark, the
    // language and the way in or out are ONE implementation wherever
    // they are drawn, never one per audience.
    for (const bar of [
      "components/shell/minimal-shell.tsx",
      "components/admin/control-panel-shell.tsx",
    ]) {
      expect(readFileSync(join(process.cwd(), bar), "utf8")).toContain(
        "PlatformTopbar",
      );
    }

    // The three fronts with a row of tabs draw the same controls from
    // the same file — `RowControls` lives beside the bar's own paint.
    for (const front of [
      "components/shell/app-shell.tsx",
      "app/[locale]/supplier/layout.tsx",
      "app/[locale]/trader/layout.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), front), "utf8");
      expect([front, source.includes("RowControls")]).toEqual([front, true]);
      expect([front, source.includes("<BrandMark")]).toEqual([front, true]);
      expect([front, source.includes("<PlatformTopbar")]).toEqual([
        front,
        false,
      ]);
    }

    // AND THE PAINT IS DECIDED ONCE: the account button's fill and the
    // language control's ink are constants in the bar's own file, and
    // the row's controls are dressed from them.
    const bar = readFileSync(
      join(process.cwd(), "components/shell/platform-topbar.tsx"),
      "utf8",
    );
    expect(bar).toContain("export async function RowControls");
    // Signed-in rows retain the shared account and language controls.
    // The public row has one account entry and a language control.
    expect(bar).toContain("const LOCALE_CONTROL_BASE =");
    expect(bar).toContain("${LOCALE_CONTROL_BASE} text-primary");

    const row = bar.slice(bar.indexOf("export async function RowControls"));
    expect(row).toContain("const VISITOR_TEXT_CONTROL");
    expect(row).toContain("const VISITOR_LOCALE_CONTROL");
    expect(row).toContain('data-testid="header-sign-in"');
    expect(row).not.toContain('data-testid="header-register"');
    expect(row).not.toContain("ACCOUNT_TONE");
  });

  it("points the mark at the home of the front it stands on", () => {
    // «إذا ضغطت على الشعار وأنا داخل بحساب المشتري يودّيني لصفحة
    // الزائر». The mark is at the head of a PORTAL'S row now, not in a
    // bar shared with the storefront, so pressing it must reach the
    // first tab in that row — not walk somebody out of the portal they
    // are working in.
    for (const front of [
      "app/[locale]/supplier/layout.tsx",
      "app/[locale]/trader/layout.tsx",
      // The public front's own home IS the locale root, and its
      // basePath is that root — so the same line reads correctly here.
      "components/shell/app-shell.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), front), "utf8");
      expect([front, source.includes("homeHref={basePath}")]).toEqual([
        front,
        true,
      ]);
      // AND NOWHERE DOES IT POINT AT THE LOCALE ROOT BY HAND, which is
      // what walked a signed-in buyer out to the storefront.
      expect([front, source.includes("homeHref={`/${appLocale}`}")]).toEqual([
        front,
        false,
      ]);
    }
  });

  it("says WHO IS LOOKING and nothing else about which screen it is on", () => {
    // The bar's contents follow the audience. A branch on "am I in the
    // console" would be how the console's bar starts drifting from the
    // supplier's again.
    expect(BAR).toContain('"visitor" | "bare" | "company" | "admin"');
    expect(BAR).not.toMatch(/pathname|usePathname/);
  });

  it("STICKS rather than floats, which is what keeps content clear of it", () => {
    // A sticky element still occupies its space in the flow, so
    // everything below simply starts below it. `fixed` would need a
    // spacer of exactly the bar's height — a number that changes with
    // the logo, the font and the language.
    expect(BAR).toContain("sticky top-0");
    expect(BAR).not.toMatch(/className="[^"]*\bfixed\b[^"]*top-0/);
  });

  it("keeps the navigation out of its row entirely", () => {
    // Structural, not a z-index argument: the portal frame is a COLUMN
    // of bands — the bar, then the navigation, then the page. Nothing
    // shares a row with the bar, so nothing can overlap it at any width
    // in either direction.
    //
    // IT USED TO SAY `<PortalSidebar`, when the second band was a rail
    // beside the content. The rail is gone and the navigation is across
    // the top; the ordering rule it was checking is unchanged.
    const chrome = readFileSync(
      join(process.cwd(), "components/portal/portal-chrome.tsx"),
      "utf8",
    );

    expect(chrome).toContain("flex min-h-screen flex-col");
    expect(chrome.indexOf("{topbar}")).toBeLessThan(
      chrome.indexOf("<PortalTopNav"),
    );
    // And the page comes after both.
    expect(chrome.indexOf("<PortalTopNav")).toBeLessThan(
      chrome.indexOf("<main"),
    );
  });
});

describe("the mark leads, the controls follow", () => {
  it("puts the mark at the inline START and the controls at the END", () => {
    // `justify-between` plus the document's own direction: Arabic gets
    // the logo on the right and English on the left, with no
    // `locale === "ar-SA"` anywhere. The browser already knows which
    // way the page reads, and a second source of truth for that is a
    // bug waiting for a third locale.
    expect(BAR).toContain("justify-between");
    // CODE, not the comment explaining there is none. A file that says
    // "no `locale === "ar-SA"` anywhere" would otherwise fail its own
    // rule for containing the words.
    expect(code(BAR)).not.toMatch(/locale === ["']ar-SA["']/);

    expect(BAR.indexOf("<BrandMark")).toBeLessThan(
      BAR.indexOf("<LocaleSwitch"),
    );
  });

  it("shows the LOGO and no name in text", () => {
    // `BrandMark` never reads `nameAr`/`nameEn` — it cannot print a
    // brand name it does not know about. The sign-in shell used to
    // print one where the mark belongs.
    const mark = readFileSync(
      join(process.cwd(), "components/shell/brand-mark.tsx"),
      "utf8",
    );

    expect(code(mark)).not.toContain("nameAr");
    expect(code(mark)).not.toContain("nameEn");

    const minimal = readFileSync(
      join(process.cwd(), "components/shell/minimal-shell.tsx"),
      "utf8",
    );
    expect(minimal).not.toContain("brandName");
  });

  it("draws no box around the mark when there is no logo", () => {
    // A dashed rectangle where an operator had uploaded nothing is a
    // frame this file chose, on a bar that is now the identity colour.
    const mark = readFileSync(
      join(process.cwd(), "components/shell/brand-mark.tsx"),
      "utf8",
    );

    expect(code(mark)).not.toContain("border-dashed");
  });
});

describe("what each audience is offered", () => {
  it("gives a VISITOR the way in", () => {
    expect(BAR).toContain('data-testid="header-sign-in"');
    expect(BAR).toContain("<SignInIcon");
  });

  it("gives the SIGN-IN PAGE the mark and the language, and nothing else", () => {
    // Offering "sign in" on the sign-in page is a button whose only
    // effect is reloading the page somebody is already on.
    const bare = BAR.slice(BAR.indexOf('audience === "visitor" ? ('));
    expect(bare).toContain(") : null}");
  });

  it("gives a COMPANY the bell, and the CONSOLE none", () => {
    // Not a preference: `Notification` is keyed to a company and
    // `NotificationRecipient` to a `User`. An administrator is neither,
    // so there is no row a console bell could count. A bell that always
    // reads zero is a picture of one.
    expect(BAR).toContain('audience === "company" && notifications');
    expect(BAR).toContain("THE CONSOLE GETS NO BELL");
  });

  it("turns the SAME button into the way out", () => {
    // One class string for both, so the bar does not change height,
    // weight or colour depending on who is looking.
    const uses =
      BAR.match(
        /className=\{ACCOUNT_CONTROL\}|className=\{?ACCOUNT_CONTROL/g,
      ) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the identity blue, and what had to invert with it", () => {
  it("paints the bar in the theme's own colour, never a hex", () => {
    expect(BAR).toContain("bg-primary");
    expect(BAR).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("inverts the controls, or they would be blue on blue", () => {
    // The account button was `bg-primary` on white. Left as it was it
    // measures 1.00:1 against the bar now holding it.
    expect(BAR).toContain("bg-surface text-primary");
    expect(BAR).toContain("text-primary-foreground");
  });

  it("INVERTS THE FOCUS RING, which would otherwise vanish silently", () => {
    // `--color-focus-ring` is the tenant's identity colour — the same
    // value the bar is painted in. Without this a keyboard user tabbing
    // through the bar sees nothing at all, and no visual test would
    // catch it because there is nothing to see.
    expect(BAR).toContain("--color-focus-ring");
    expect(BAR).toContain("var(--color-on-primary)");
  });
});

/** Stand-in for the class string the bar hands the language control. */
const SHARED_SHAPE =
  "inline-flex size-8 min-h-control shrink-0 items-center justify-center rounded-control text-primary-foreground";

describe("the language control", () => {
  function renderAt(pathname: string, locale = "ar-SA", otherLocale = "en-SA") {
    nav.pathname = pathname;
    return render(
      <LocaleSwitch
        locale={locale}
        otherLocale={otherLocale}
        label="Switch to English"
        className={SHARED_SHAPE}
      />,
    );
  }

  it("KEEPS THE READER ON THE SAME PAGE", () => {
    renderAt("/ar-SA/opportunities/abc-123");

    // It used to point at the other locale's home page, so switching
    // language from an offer threw you back to the front door.
    expect(screen.getByTestId("locale-switch")).toHaveAttribute(
      "href",
      "/en-SA/opportunities/abc-123",
    );
  });

  it("handles the locale root itself", () => {
    renderAt("/ar-SA");

    expect(screen.getByTestId("locale-switch")).toHaveAttribute(
      "href",
      "/en-SA",
    );
  });

  it("falls back to the other locale's root for a path it does not recognise", () => {
    renderAt("/something-else");

    // A rewrite could produce one. A wrong-but-valid URL beats a
    // broken one.
    expect(screen.getByTestId("locale-switch")).toHaveAttribute(
      "href",
      "/en-SA",
    );
  });

  it("does not match a locale that is merely a prefix of the segment", () => {
    renderAt("/ar-SAX/page");

    expect(screen.getByTestId("locale-switch")).toHaveAttribute(
      "href",
      "/en-SA",
    );
  });

  it("is an icon with a NAMED DESTINATION, not the word for a language", () => {
    renderAt("/ar-SA");
    const link = screen.getByTestId("locale-switch");

    // An icon-only control announced as "Language" tells a
    // screen-reader user nothing about what pressing it does.
    expect(link).toHaveAttribute("aria-label", "Switch to English");
    expect(link.textContent?.trim()).toBe("");
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("reloads the document rather than navigating client-side", () => {
    renderAt("/ar-SA");
    const link = screen.getByTestId("locale-switch");

    // `lang` and `dir` live on <html> and are rendered by the root
    // layout. A client-side navigation would leave an Arabic page
    // marked as English, still flowing left to right.
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("hrefLang", "en-SA");
    expect(link).toHaveAttribute("lang", "en-SA");
  });

  it("wears whatever shape the header gives it, rather than its own", () => {
    renderAt("/ar-SA");

    // An icon control that kept its own height and radius is the one
    // that stops matching the button beside it the moment either is
    // adjusted.
    expect(screen.getByTestId("locale-switch").className).toBe(SHARED_SHAPE);
  });
});

describe("the bar is never covered, and the language is never a mystery", () => {
  const NAV = readFileSync(
    join(process.cwd(), "components/portal/portal-top-nav.tsx"),
    "utf8",
  );

  it("keeps the NAVIGATION below the bar in the stack", () => {
    // The rule that produced this: both carried `z-50` and the second
    // one comes later in the document, so it won the paint and covered
    // the logo the moment a portal page scrolled. Same z-index is not a
    // tie; it is "later wins". The band is a top bar now rather than a
    // rail, and the rule is the same.
    expect(BAR).toContain("z-50");
    expect(NAV).toContain("sticky z-40");
    expect(NAV).not.toContain("z-50 bg-primary");
  });

  it("starts the navigation BELOW the bar rather than over it", () => {
    // The rail ran from `inset-y-0`, so an open menu on a phone hid the
    // mark and the way out. The band that replaced it is sticky at the
    // bar's own height instead.
    expect(NAV).toContain("sticky z-40");
    expect(NAV).not.toContain("inset-y-0");
  });

  it("measures the offset from the bar's own token, not a number", () => {
    // A literal 44 would drift the moment the bar's height changed, and
    // nothing would fail — the band would simply sit wrong.
    expect(NAV).toContain("var(--nav-item-height)");
    expect(NAV).not.toMatch(/top:s*"?44/);
  });

  it("names the language it goes TO, in that language's own script", () => {
    // «English» on an Arabic page means "press this to go to English",
    // which is what the control does. «عربية» there would label the
    // language you are already in — true, and useless as a button.
    const ar = JSON.parse(read("messages/ar-SA.json"));
    const en = JSON.parse(read("messages/en-SA.json"));

    expect(ar.shell.localeName["en-SA"]).toBe("English");
    expect(ar.shell.localeName["ar-SA"]).toBe("العربية");
    // The SAME in both catalogues: a language's name is not translated.
    expect(en.shell.localeName).toEqual(ar.shell.localeName);

    expect(BAR).toContain("otherLocaleName={t(`localeName.${otherLocale}`)}");
  });

  it("marks the name's own language and direction on the word itself", () => {
    // «English» inside an Arabic bar is a run of Latin text in a
    // right-to-left flow. Without `lang` and `dir` the browser is free
    // to reorder it around the glyph beside it.
    const control = read("components/shell/locale-switch.tsx");

    expect(control).toContain("lang={otherLocale}");
    expect(control).toContain("dir={otherLocale.startsWith");
  });

  it("sizes it as a control with words in it, not a 32px square", () => {
    expect(BAR).toContain("gap-control-gap rounded-control px-control-x");
    expect(BAR).not.toContain(
      "size-8 min-h-control shrink-0 items-center justify-center rounded-control text-primary-foreground",
    );
  });

  it("puts it LAST, at the bar's outer edge", () => {
    // Measured before the change: on an Arabic page the button sat at
    // 160..290 and the globe at 298..330 — the globe nearer the mark.
    // The owner wanted them swapped, and a control that now carries a
    // word belongs at the edge rather than between two narrow ones.
    expect(BAR.indexOf("<LocaleSwitch")).toBeGreaterThan(
      BAR.indexOf('data-testid="header-sign-in"'),
    );
  });
});
