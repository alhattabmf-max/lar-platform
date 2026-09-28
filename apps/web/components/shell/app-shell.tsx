import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { getBranding } from "@/lib/branding";
import { getSession } from "@/lib/session";
import { themeStyle } from "@/lib/theme";
import type { AppLocale } from "@/i18n/routing";
import { SkipLink } from "@/components/ui/skip-link";
import { RowControls } from "./platform-topbar";
import { BrandMark } from "./brand-mark";
import { Footer } from "./footer";
import { VisitorChrome } from "@/components/visitor/visitor-chrome";
import { CategoryBandSlot } from "@/components/portal/category-band-slot";

/**
 * Page frame shared by every public route.
 *
 * IT WEARS THE PLATFORM'S OWN DESIGN NOW — «صمّم واجهة الزائر بنفس
 * التصميم اللي اعتمدناه لواجهة المشتري والمورد». Two file tabs on a
 * sheet, the same row the supplier and the buyer wear, drawn by the same
 * component. What was here before was a white category band under the
 * top bar on every page, including the ones with nothing to browse.
 *
 * THE CATEGORIES DID NOT GO ANYWHERE. They are in the market tab's own
 * strip — «وفي شريط السوق حط التصنيفات وعرض الكل» — which is where they
 * are useful and nowhere else.
 *
 * THE FOOTER STAYS, and stays outside the chrome. It is the public
 * site's own: the policies, the FAQ, the contact form, and everything a
 * visitor looks for at the bottom of a page rather than in a tab.
 *
 * Landmark structure is unchanged: skip link → header → <main
 * id="main-content"> → footer. `PortalChrome` renders that `main` with
 * the skip-link target and `tabIndex={-1}`, so focus actually lands
 * there when the link is activated.
 *
 * Branding is fetched once here and passed down, so the bar and the
 * footer cannot disagree, and a branding outage degrades to a translated
 * fallback rather than an error page.
 */
export interface AppShellProps {
  locale: AppLocale;
  children: ReactNode;
}

export async function AppShell({ locale, children }: AppShellProps) {
  const [branding, t, nav, session] = await Promise.all([
    getBranding(locale),
    getTranslations({ locale, namespace: "shell" }),
    getTranslations({ locale, namespace: "visitor.nav" }),
    getSession(),
  ]);

  const basePath = `/${locale}`;

  return (
    <div
      // The active theme's four identity colours arrive as CSS custom
      // properties on this wrapper, overriding the :root defaults for
      // everything inside. A style OBJECT, never a CSS string — see
      // lib/theme.ts for why that distinction is the safety boundary.
      style={themeStyle(branding.theme?.colors)}
      className="flex min-h-screen flex-col"
    >
      <SkipLink label={t("skipToContent")} />

      <VisitorChrome
        basePath={basePath}
        nav={{
          navLabel: nav("label"),
          openMenu: nav("openMenu"),
          closeMenu: nav("closeMenu"),
          groupNames: { market: nav("market") },
          pageNames: { home: nav("home"), market: nav("market") },
        }}
        // THE ONE SEARCH FIELD — «حقل بحث بجانب أيقونة الإشعارات
        // ويتمدد إلى آخر لسان موجود في الصفحة». Built here because its
        // words are translated on the server, and pointed at THIS
        // front's listing: «كلٌّ يبحث في عالمه».
        // AND THE WAY INTO THE MARKET FOR A NARROW SCREEN. The tab row
        // and its strip are both hidden below lg, and the market has no
        // tab of its own on this front - so without this a phone has no
        // route to the offers at all.
        searchLabels={{
          action: `${basePath}/opportunities`,
          placeholder: t("search.placeholder"),
          label: t("search.label"),
          submitLabel: t("search.submit"),
        }}
        // NO MARKET LINK IN A DRAWER ANY MORE, because this front has
        // no drawer any more: one tab, a search row of its own and
        // «المنتجات» standing open above it. A menu button that opens
        // an empty panel is a control that lies about having
        // somewhere to go.
        // THE NARROW SCREEN'S OWN CONTROLS AND ITS OWN «المنتجات» —
        // «الشريط العلوي مثل ما هو لسان وشعار قبله وأيقونة تسجيل دخول
        //  ولغة، وتحته المنتجات وينبثق منها التصنيفات، وتحت شريط
        //  منتجات يجي البحث، ثم البنر.»
        //
        // A SECOND `RowControls`, NOT THE ONE ABOVE. A server-rendered
        // node placed twice inside a client component is MOVED rather
        // than copied — measured, that cost the search field its place
        // on the page for a whole build. Only one of the two rows is
        // ever visible, so this renders two icons nobody sees twice.
        mobileControls={
          <RowControls
              // THE ROW OPENS THE ACCOUNT SIDEWAYS — see `UserMenu`.
              inline
            locale={locale}
            audience={session ? "company" : "visitor"}
          />
        }
        // THE CATEGORIES ARE THE BAND NOW — «ليه ما نخلّيها في
        //  الشريط نفس سطح المكتب وتنزلق». White on the identity's
        // orange, with a white wave under the open one: the same
        // signature as the row above it, inverted.
        categoryBand={<CategoryBandSlot locale={locale} basePath={basePath} />}
        // AND NO BAR AT THE FOOT ON THIS FRONT. «الرئيسية مكرّرة
        //  تحت» — and once the account went up beside the tab and
        // «المنتجات» moved into the band, the only item left for it
        // was a second «الرئيسية». A fixed navy strip carrying one
        // duplicate is 56 pixels of a phone that say nothing. The
        // buyer and the supplier keep theirs, because theirs still
        // carry destinations that are nowhere else.
        // THE ROW OF TABS IS THIS FRONT'S BAR NOW.
        brand={
          <BrandMark
            branding={branding}
            logoAlt={t("logoAlt")}
            homeLabel={t("goHome")}
            homeHref={basePath}
          />
        }
        // A COMPANY SESSION, or none. The console's `asid` never reaches
        // a public page, so "signed in" here can only mean a supplier or
        // a buyer — and they get the way out rather than the way in.
        controls={
          <RowControls
            // THE ACCOUNT OPENS INTO THE ROW HERE TOO — «طبّق انزلاق
            //  تسجيل خروج وبيانات في صفحات سطح المكتب، أجمل».
            inline locale={locale} audience={session ? "company" : "visitor"} />
        }
      >
        {children}
      </VisitorChrome>

      <Footer locale={locale} branding={branding} />
    </div>
  );
}
