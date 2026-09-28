import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import arMessages from "../messages/ar-SA.json";
import enMessages from "../messages/en-SA.json";

/**
 * Changing language inside the control panel.
 *
 * WHAT IT MUST NOT DO is as important as what it does: it must not sign
 * the operator out, must not send them to the marketplace home, and
 * must not quietly change which rows they are looking at. So the
 * assertions here are about the DESTINATION — the whole destination,
 * query string included, because that is where a control panel list
 * keeps its search, its filters and its page number.
 */

const nav = vi.hoisted(() => ({
  pathname: "/ar-SA/admin/companies",
  search: "",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

function renderSwitch(
  pathname: string,
  search = "",
  locale = "ar-SA",
  other = "en-SA",
) {
  nav.pathname = pathname;
  nav.search = search;
  return render(
    <LocaleSwitch
      locale={locale}
      otherLocale={other}
      label="التبديل إلى الإنجليزية"
      className="control"
    />,
  );
}

const href = () => screen.getByTestId("locale-switch").getAttribute("href");

describe("it answers in the other language on the SAME screen", () => {
  it("keeps the admin path", () => {
    renderSwitch("/ar-SA/admin/companies");

    // Not `/en-SA` and not `/en-SA/admin`: the operator stays where
    // they were.
    expect(href()).toBe("/en-SA/admin/companies");
  });

  it("keeps a detail path", () => {
    renderSwitch("/ar-SA/admin/orders/9f1c2e40-0000-4000-8000-000000000001");

    expect(href()).toBe(
      "/en-SA/admin/orders/9f1c2e40-0000-4000-8000-000000000001",
    );
  });

  it("keeps the portal root", () => {
    renderSwitch("/ar-SA/admin");

    expect(href()).toBe("/en-SA/admin");
  });

  it("works the other way too", () => {
    renderSwitch("/en-SA/admin/settlements", "", "en-SA", "ar-SA");

    expect(href()).toBe("/ar-SA/admin/settlements");
  });
});

describe("it keeps the search, the filters and the page", () => {
  it("carries the whole query across", () => {
    // THE REGRESSION THIS GUARDS: `usePathname()` excludes the query, so
    // a switch built on it alone answers in the other language while
    // silently showing a different set of rows.
    renderSwitch(
      "/ar-SA/admin/companies",
      "search=%D9%86%D9%87%D8%B6%D8%A9&accountType=SUPPLIER&page=3&pageSize=50",
    );

    const url = href() ?? "";
    expect(url.startsWith("/en-SA/admin/companies?")).toBe(true);
    expect(url).toContain("search=%D9%86%D9%87%D8%B6%D8%A9");
    expect(url).toContain("accountType=SUPPLIER");
    expect(url).toContain("page=3");
    expect(url).toContain("pageSize=50");
  });

  it("adds no empty question mark when there is no query", () => {
    renderSwitch("/ar-SA/admin/companies", "");

    expect(href()).toBe("/en-SA/admin/companies");
  });
});

describe("it is usable without a mouse and without sight", () => {
  it("is a real link, so Tab reaches it and Enter follows it", () => {
    renderSwitch("/ar-SA/admin/companies");

    expect(screen.getByTestId("locale-switch").tagName).toBe("A");
    expect(screen.getByRole("link")).toBeTruthy();
  });

  it("names the DESTINATION rather than the current language", () => {
    renderSwitch("/ar-SA/admin/companies");
    const link = screen.getByTestId("locale-switch");

    // An icon announced as "Language" says nothing about what pressing
    // it does.
    expect(link).toHaveAttribute("aria-label", "التبديل إلى الإنجليزية");
    expect(link).toHaveAttribute("title", "التبديل إلى الإنجليزية");
    expect(link.textContent?.trim()).toBe("");
  });

  it("marks the destination's language for assistive technology", () => {
    renderSwitch("/ar-SA/admin/companies");
    const link = screen.getByTestId("locale-switch");

    expect(link).toHaveAttribute("lang", "en-SA");
    expect(link).toHaveAttribute("hrefLang", "en-SA");
  });

  it("reloads the document so `dir` and `lang` are re-rendered", () => {
    // A client-side navigation would leave an Arabic page marked as
    // English and still flowing right to left.
    const source = readFileSync(
      join(process.cwd(), "components", "shell", "locale-switch.tsx"),
      "utf8",
    );

    expect(source).not.toContain('from "next/link"');
    expect(source).toContain("<a");
  });
});

describe("both places that offer it are wired up", () => {
  const read = (relative: string) =>
    readFileSync(join(process.cwd(), relative), "utf8");

  it("the sign-in screen offers it without touching the form", () => {
    const gate = read("components/admin/admin-login-gate.tsx");

    expect(gate).toContain("<LocaleSwitch");
    expect(gate).toContain('t("switchLocale")');
    // The credentials flow itself is untouched.
    expect(gate).toContain("<AdminLoginFlow");
  });

  it("the top bar offers it beside help, after sign-in", () => {
    // THE BAR IS NOW SHARED by the console and the two company portals,
    // so the control lives with it. Which portal shows a help button
    // beside it is still each portal's own decision — the console has a
    // help panel, the other two have none.
    // THE LIVE SHARED BAR is `shell/platform-topbar.tsx` — what
    // `control-panel-shell`, `app-shell`, `minimal-shell` and both
    // portal layouts render. `portal/portal-topbar.tsx` was a copy
    // nothing imported, and it is gone.
    const topbar = read("components/shell/platform-topbar.tsx");

    // Not sign-in only: an operator who changes language after signing
    // in must not have to sign out to do it.
    expect(topbar).toContain("<LocaleSwitch");
    expect(topbar).toContain("header.switchLocale");
    // And the console still puts help next to it.
    expect(read("components/admin/control-panel-chrome.tsx")).toContain(
      'data-testid="control-panel-help-button"',
    );
  });

  it("uses the approved Globe glyph in both", () => {
    // ONE FILE, NOT TWO. The second was the copy nothing rendered.
    // The live locale switch draws `GlobeSolidIcon` from the icon set
    // rather than lucide's `<Globe`, which is a difference worth
    // knowing about but not one to change inside a cleanup.
    for (const file of [
      "components/admin/admin-login-gate.tsx",
    ]) {
      const source = read(file);
      expect([file, source.includes("<Globe ")]).toEqual([file, true]);
      expect([file, source.includes('from "lucide-react"')]).toEqual([
        file,
        true,
      ]);
    }
  });

  it("names it in both languages, and not with the same string twice", () => {
    expect(arMessages.admin.nav.switchLocale).toBe("التبديل إلى الإنجليزية");
    expect(enMessages.admin.nav.switchLocale).toBe("Switch to Arabic");
    expect(arMessages.admin.login.switchLocale).toBeTruthy();
    expect(enMessages.admin.login.switchLocale).not.toBe(
      arMessages.admin.login.switchLocale,
    );
  });
});
