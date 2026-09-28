import type { ReactNode } from "react";
import { RowControls } from "@/components/shell/platform-topbar";
import { BrandMark } from "@/components/shell/brand-mark";
import { ActionRequired } from "@/components/portal/action-required";
import { loadSupplierDashboard } from "@/lib/supplier-data";
import { getBranding } from "@/lib/branding";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierUnreadCount } from "@/lib/supplier-data";
import { SkipLink } from "@/components/ui/skip-link";
import { NotificationBell } from "@/components/shell/notification-bell";
import { SupplierChrome } from "@/components/supplier/supplier-chrome";
import { SUPPLIER_PORTAL_MAP } from "@/components/supplier/supplier-portal-nav";
import { portalPages } from "@/components/portal/portal-nav";

/**
 * The supplier's portal: the shared control-panel frame, guarded.
 *
 * ITS OWN SHELL, not `AppShell`. That one draws the marketplace header
 * and footer, which is a storefront's chrome and not a workspace's. The
 * frame here is the one the console wears, from `components/portal/`,
 * so all three portals look like one product.
 *
 * IT IS THE SAME COMPONENTS, NOT THE SAME SESSION. This layout reads
 * `requireRoleOrRedirect`, which calls `GET /me` with the company `sid`
 * cookie. It touches no admin loader, no admin guard and no `asid`
 * cookie, and the destinations come from `SUPPLIER_PORTAL_MAP` — a map
 * that names only paths under `/supplier`. Neither a console link nor a
 * buyer's has a route into this chrome.
 *
 * Until 8E.3 this segment did not exist at all, while `portalPathFor()`
 * had always sent a signed-in supplier to `/{locale}/supplier` — so the
 * one thing the product did with a supplier account was redirect it to
 * a 404. That is what this closes.
 *
 * `requireRoleOrRedirect` runs on the SERVER before any child renders.
 * It throws Next's redirect signal, so an unauthenticated or wrong-role
 * visitor never receives the page body — it is not rendered and then
 * hidden. Unauthenticated goes to login (they can fix that); the wrong
 * role goes to `/unauthorized`, because signing in again with the same
 * account would change nothing.
 */
/**
 * Every page under /supplier is rendered per request.
 *
 * Declared on the LAYOUT so the whole segment inherits it. These pages
 * carry one company's orders, payouts and bank details, and a
 * statically generated or shared-cache copy of them is a cross-tenant
 * disclosure.
 */
export const dynamic = "force-dynamic";

export default async function SupplierLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  const session = await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({
    locale: appLocale,
    namespace: "supplier.nav",
  });
  const shell = await getTranslations({
    locale: appLocale,
    namespace: "shell",
  });

  // The unread badge is a nice-to-have on the chrome; a failure here
  // must not stop the portal rendering, so it degrades to no badge.
  const unread = await loadSupplierUnreadCount();
  const unreadCount = unread.ok ? unread.data.unread : undefined;

  const basePath = `/${appLocale}/supplier`;

  const dashboard = await getTranslations({
    locale: appLocale,
    namespace: "supplier.dashboard",
  });

  // ONE EXTRA READ, and only for the three counts the shortcut shows.
  // `30d` is the dashboard's own default period; these three figures do
  // not depend on it — they are what is waiting NOW — but the endpoint
  // takes one, so the default is what is asked for.
  const attention = await loadSupplierDashboard("30d");

  const products = await getTranslations({
    locale: appLocale,
    namespace: "supplier.products",
  });
  const offers = await getTranslations({
    locale: appLocale,
    namespace: "supplier.opportunities",
  });


  // Built from the map, so a destination added there cannot be rendered
  // without a name.
  const pageNames: Record<string, string> = {};
  for (const page of portalPages(SUPPLIER_PORTAL_MAP))
    pageNames[page.key] = t(page.key);

  // «غير مكتملة» BESIDE «بيانات المنشأة», and only while it is true.
  // The badge is derived from the same `profile.missing` the dashboard
  // banner reads, so the two cannot disagree.
  const company = await getTranslations({
    locale: appLocale,
    namespace: "company",
  });
  const pageBadges: Record<string, string> = session.profile.complete
    ? {}
    : { account: company("incomplete") };

  // The tenant's mark, for the one bar. Cached per request, so the


  // page body reading it too costs nothing extra.


  const branding = await getBranding(appLocale);


  const groupNames: Record<string, string> = {};
  for (const group of SUPPLIER_PORTAL_MAP.groups)
    groupNames[group.key] = t(`group.${group.key}`);

  /**
   * WHAT IS WAITING ON THIS SUPPLIER, as rows the shortcut can draw.
   *
   * The three figures come from the dashboard's own read — the only
   * endpoint that carries them — and a failure degrades to zeroes
   * rather than to a missing shortcut: «يبقى الاختصار ظاهرًا دائمًا…
   * ولا يختفي».
   */
  const waiting = attention.ok
    ? attention.data.attention
    : {
        ordersAwaitingPreparation: 0,
        disputesAwaitingResponse: 0,
        replacementsAwaitingAction: 0,
      };

  const actionRows = [
    {
      key: "orders",
      count: waiting.ordersAwaitingPreparation,
      text: dashboard("attention.orders"),
      href: `${basePath}/orders`,
    },
    {
      key: "disputes",
      count: waiting.disputesAwaitingResponse,
      text: dashboard("attention.disputes"),
      href: `${basePath}/follow-up`,
    },
    {
      key: "replacements",
      count: waiting.replacementsAwaitingAction,
      text: dashboard("attention.replacements"),
      href: `${basePath}/follow-up`,
    },
  ];

  const actionLabels = {
    title: dashboard("attention.actionRequired"),
    clear: dashboard("attention.clear"),
    countLabel: dashboard("attention.countLabel"),
  };

  return (
    <>
      <SkipLink label={shell("skipToContent")} />

      <SupplierChrome
        basePath={basePath}
        nav={{
          navLabel: t("label"),
          closeMenu: t("closeMenu"),
          openMenu: t("openMenu"),
          groupNames,
          pageNames,
          pageBadges,
        }}
        // THE WORDS FOR WHAT THE STRIP CARRIES. They come from the
        // pages' own catalogues rather than a set written for the
        // chrome, so «إضافة منتج» is the same sentence wherever it is
        // read from.
        // THE ONE SEARCH FIELD — «حقل بحث بجانب أيقونة الإشعارات
        // ويتمدد إلى نهاية اللسان الثاني». Pointed at the supplier's
        // OWN offers: «كلٌّ يبحث في عالمه».
        searchLabels={{
          action: `${basePath}/opportunities`,
          placeholder: shell("search.placeholder"),
          label: shell("search.label"),
          submitLabel: shell("search.submit"),
        }}
        barLinkLabels={{
          addProduct: products("newProduct"),
          chooseProduct: offers("chooseProduct"),
          backToProducts: products("backToProducts"),
          backToProduct: products("backToProduct"),
        }}
        // THE ROW OF TABS IS THIS FRONT'S BAR NOW. The mark stands at
        // its head and the language and the way out at its far end;
        // there is no separate band above it any more.
        brand={
          <BrandMark
            branding={branding}
            logoAlt={shell("logoAlt")}
            homeLabel={shell("goHome")}
            // THE PORTAL'S OWN HOME, not the platform's front door —
            // «إذا ضغطت على الشعار وأنا داخل بحساب المشتري يودّيني لصفحة
            // الزائر». The mark stands at the head of THIS front's row;
            // pressing it should reach the first tab in that row.
            homeHref={basePath}
          />
        }
        // «إجراء مطلوب» — BESIDE THE BELL, AND ONLY WHEN SOMETHING IS
        // WAITING. It draws nothing at zero, so the row closes up.
        alert={<ActionRequired rows={actionRows} labels={actionLabels} />}
        controls={
          <RowControls
            // THE ACCOUNT OPENS INTO THE ROW HERE TOO — «طبّق انزلاق
            //  تسجيل خروج وبيانات في صفحات سطح المكتب، أجمل».
            inline
            locale={appLocale}
            audience="company"
            recordHref={`${basePath}/account`}
          />
        }
        // THE NARROW ROW'S OWN COPY OF THE THREE GLYPHS — «حسابي
        // يطلع فوق بجانب اللسان ويكون أيقونة، عشان تكون الثلاث
        //  أيقونات موجودة». A second instance, never the wide row's:
        // one server-rendered node placed twice inside a client
        // component is MOVED rather than copied.
        mobileControls={
          <>
            <NotificationBell
              href={`${basePath}/notifications`}
              unread={unreadCount}
              prominent
            />
            <RowControls
              // THE ROW OPENS THE ACCOUNT SIDEWAYS — see `UserMenu`.
              inline
              locale={appLocale}
              audience="company"
              recordHref={`${basePath}/account`}
            />
          </>
        }
        // NO CATEGORIES AND NO SECOND SEARCH. This front sells into
        // the market rather than shopping in it — «كلٌّ يبحث في
        //  عالمه» — and the one field it needs is in the bar at the
        // top, on every page.

        // THE BELL COMES DOWN TO THE TAB ROW. «ونحط أيقونة الإشعارات
        // موازية للألسنة في الجهة المقابلة» — one door into that page,
        // beside the pages it sits among.
        bell={
          <NotificationBell
            href={`${basePath}/notifications`}
            unread={unreadCount}
            // LOUD, because it hangs at the end of the tab row on the
            // page's own light rather than in a bar of the identity
            // colour: «اختلافه عن بقية الأيقونات مقصود ليكون ملفتًا».
            prominent
          />
        }
      >
        {children}
      </SupplierChrome>
    </>
  );
}
