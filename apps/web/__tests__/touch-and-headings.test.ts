import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * WHAT A THUMB CAN HIT, AND WHAT A HEADING SAYS.
 *
 * Each of these was measured on the running build before it was
 * changed, and measured again after. What a unit test can hold is the
 * cause — the class, the tag, the attribute — so that is what these
 * assert.
 */
describe("touch targets and the document outline", () => {
  const row = read("components/portal/folder-tab-nav.tsx");

  it("gives the mobile menu button forty-four pixels", () => {
    // Measured 32×32. On a phone it is the ONLY way to navigate, and
    // `min-h-control` is the height of a button among other buttons —
    // this one is alone. Now 44×44, measured, with the bar still at 44.
    expect(row).toContain("min-h-nav w-11 shrink-0 items-center justify-center");
    expect(row).not.toContain("size-8 min-h-control shrink-0");
    // AND THE GLYPH DID NOT GROW WITH IT.
    expect(row).toContain('<Menu aria-hidden="true" className="size-control" />');
  });

  it("names what the button opens, and the name resolves", () => {
    // `aria-expanded` was there and `aria-controls` was not: a state
    // announced without saying whose.
    expect(row).toContain("aria-controls={DRAWER_ID}");
    expect(row).toContain("id={DRAWER_ID}");
    expect(row).toContain('const DRAWER_ID = "portal-nav-drawer"');
  });

  it("keeps the drawer in the document so the reference is not a promise it breaks", () => {
    // It was rendered only while open, so `aria-controls` pointed at
    // nothing for as long as it was closed. `hidden` takes it out of
    // the layout, the accessibility tree and the tab order together.
    expect(row).toContain("hidden={!drawerOpen}");
    expect(row).not.toContain("{drawerOpen ? (\n        <div");
  });

  it("widens the policy checkbox's reach without widening the box", () => {
    // Measured 13×13 inside a 356×20 label — the one control between a
    // person and an account. The box is still 13×13; the target is
    // 298×44, and the negative margin puts the row back where it was.
    const form = read("components/auth/register-form.tsx");
    expect(form).toContain('className="-my-2 flex min-h-[44px] items-center gap-2 py-2 text-sm text-content"');
    // NOTHING WAS DONE TO THE BOX ITSELF beyond stopping it shrinking.
    expect(form).toContain('className="shrink-0 border-line-strong"');
  });

  it("gives the sign-in links reach without changing type or spacing", () => {
    // Both measured twenty pixels tall — the height of their own line —
    // and they are the only way out for somebody who cannot sign in.
    const login = read("app/[locale]/(auth)/login/page.tsx");
    expect(login).toContain("-my-2 inline-flex min-h-[44px] items-center py-2 text-secondary");
    // THE TYPE SIZE IS UNTOUCHED: the column is still `text-sm`.
    expect(login).toContain('className="mt-6 flex flex-col gap-2 text-sm"');
  });

  it("gives every auth page a top-level heading", () => {
    // All four had an H2 from the card and no H1 anywhere, so the
    // outline began at the second level. The card's title IS the page's
    // name on these four, so it says so rather than repeating itself in
    // a hidden H1.
    for (const page of [
      "app/[locale]/(auth)/login/page.tsx",
      "app/[locale]/(auth)/register/page.tsx",
      "app/[locale]/(auth)/forgot-password/page.tsx",
      "app/[locale]/(auth)/reset-password/page.tsx",
    ]) {
      expect([page, read(page).includes('<CardTitle as="h1">')]).toEqual([page, true]);
    }
    // AND THE DEFAULT IS STILL H2, so no other card moved.
    const card = read("components/ui/card.tsx");
    expect(card).toContain('as: Tag = "h2"');
  });

  it("stops naming the page after a sort order", () => {
    // «لا تجعل «الأقرب إلى الإغلاق» هو عنوان الصفحة الرئيسي» — that
    // string is `home.featuredTitle`, and it was the only H1 on the
    // visitor's front and the buyer's alike. `home.title` already
    // existed, unused: «عروض شراء بالجملة».
    const home = read("components/home/home-content.tsx");
    expect(home).toContain('<h1 className="sr-only">{t("title")}</h1>');
    expect(home).toContain('<h2 id="featured-heading" className="sr-only">');
    expect(home).not.toContain('<h1 id="featured-heading"');
  });

  it("leaves the sign-in field's label alone, because it was never broken", () => {
    // A Phase 1 finding said this field had no accessible name. It was
    // wrong — the browser's accessibility snapshot did not show it, and
    // I reported the snapshot rather than the DOM. `Field` wires a
    // `<label htmlFor>` to the input's generated id; measured live, the
    // label reads «رقم السجل التجاري». It is also the COMMERCIAL
    // REGISTRATION number, not an email, which the same finding got
    // wrong too.
    const field = read("components/ui/field.tsx");
    expect(field).toContain("htmlFor={inputId}");
    expect(read("components/auth/login-form.tsx")).toContain("{({ inputId }) => (");
  });
});
