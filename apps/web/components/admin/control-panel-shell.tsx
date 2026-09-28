import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/brand-mark";
import { RowControls } from "@/components/shell/platform-topbar";
import { getBranding } from "@/lib/branding";
import { getTranslations } from "next-intl/server";
import type { AdminSession } from "@/lib/admin-session";
import type { AppLocale } from "@/i18n/routing";
import { SkipLink } from "@/components/ui/skip-link";
import { ControlPanelChrome } from "./control-panel-chrome";
import { CONTROL_PANEL_GROUPS, CONTROL_PANEL_PAGES } from "./control-panel-nav";

/**
 * The control panel's frame.
 *
 * ITS OWN SHELL, not `AppShell`. That one fetches public branding and
 * renders the marketplace header and footer — an operations console is
 * not a storefront, and dressing it as one would mean an outage in the
 * branding read could take down the screen used to fix outages. It also
 * means the console does not change appearance when an operator edits
 * the site's colours.
 *
 * EVERY STRING IS TRANSLATED HERE, once, and handed down. The chrome
 * below needs state, so it is a Client Component, and a Client Component
 * cannot call `getTranslations`. Passing a resolved dictionary keeps the
 * whole message catalogue out of the bundle and adds no request: the
 * session is read by the layout and passed in.
 */

export interface ControlPanelShellProps {
  locale: AppLocale;
  /**
   * KEPT ON THE PROPS, UNREAD HERE.
   *
   * It fed the platform bar's `user={{ name: session.email }}`, and
   * the bar is gone — the controls draw a glyph, not an address.
   * The layout still resolves the session to decide whether to
   * render this shell at all, so the prop stays rather than moving
   * that decision.
   */
  session: AdminSession;
  children: ReactNode;
}

export async function ControlPanelShell({
  locale,
  children,
}: ControlPanelShellProps) {
  const t = await getTranslations({ locale, namespace: "admin.nav" });
  const shell = await getTranslations({ locale, namespace: "shell" });
  const help = await getTranslations({ locale, namespace: "admin.help" });
  const crumbs = await getTranslations({
    locale,
    namespace: "admin.breadcrumbs",
  });

  const basePath = `/${locale}/admin`;

  // TWO dictionaries, built from the nav definition so a destination
  // added there cannot be rendered without a name — and kept apart
  // because `orders` and `content` are each both a group key and a page
  // key. One map would let the page name overwrite the group's.
  const groupNames: Record<string, string> = {};
  for (const group of CONTROL_PANEL_GROUPS)
    groupNames[group.key] = t(`group.${group.key}`);

  // The tenant's mark, for the one bar.


  const branding = await getBranding(locale);


  const pageNames: Record<string, string> = {};
  for (const page of CONTROL_PANEL_PAGES) pageNames[page.key] = t(page.key);

  return (
    <>
      <SkipLink label={shell("skipToContent")} />

      <ControlPanelChrome
        basePath={basePath}
        nav={{
          navLabel: t("label"),
          closeMenu: t("closeMenu"),
          openMenu: t("openMenu"),
          groupNames,
          pageNames,
        }}
        topbar={{ help: help("open") }}
        // THE MARK AND THE CONTROLS STAND IN THE ROW, not in a bar
        // above it — «اعتمدها مع الواجهات الثلاث في التصميم». The
        // console was the last front still wearing `PlatformTopbar`;
        // `admin` still ends the `asid` session and lands on the
        // public site, and there is still no bell, because an
        // administrator is neither a company nor a `User` and there is
        // no row a console bell could count.
        brand={
          <BrandMark
            branding={branding}
            logoAlt={shell("logoAlt")}
            homeLabel={shell("goHome")}
            homeHref={basePath}
          />
        }
        controls={
          <RowControls
            inline
            locale={locale}
            audience="admin"
            recordHref={basePath}
          />
        }
        // A SECOND INSTANCE for the narrow row, never the wide row's
        // node: one server-rendered node placed twice inside a client
        // component is MOVED rather than copied.
        mobileControls={
          <RowControls
            inline
            locale={locale}
            audience="admin"
            recordHref={basePath}
          />
        }
        breadcrumbLabel={crumbs("label")}
        help={{
          title: help("title"),
          close: help("close"),
          empty: help("empty"),
        }}
      >
        {children}
      </ControlPanelChrome>
    </>
  );
}
