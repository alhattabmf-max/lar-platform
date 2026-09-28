import type { ReactNode } from "react";
import { RowControls } from "@/components/shell/platform-topbar";
import { BrandMark } from "@/components/shell/brand-mark";
import { getBranding } from "@/lib/branding";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadUnreadNotificationCount } from "@/lib/trader-data";
import { SkipLink } from "@/components/ui/skip-link";
import { NotificationBell } from "@/components/shell/notification-bell";
import { CategoryBandSlot } from "@/components/portal/category-band-slot";
import { ActionRequired } from "@/components/portal/action-required";
import {
  loadDisputes,
  loadMyProductReports,
  loadReplacements,
} from "@/lib/trader-data";
import { TraderChrome } from "@/components/trader/trader-chrome";
import { TRADER_PORTAL_MAP } from "@/components/trader/trader-portal-nav";
import { portalPages } from "@/components/portal/portal-nav";

/**
 * The buyer's portal: the shared control-panel frame, guarded.
 *
 * ITS OWN SHELL, not `AppShell`. That one draws the marketplace header
 * and footer, which is a storefront's chrome and not a workspace's — a
 * buyer working through orders should not be looking at a category bar.
 * The frame here is the one the console wears, from
 * `components/portal/`, so all three portals look like one product.
 *
 * IT IS THE SAME COMPONENTS, NOT THE SAME SESSION. This layout reads
 * `requireRoleOrRedirect`, which calls `GET /me` with the company `sid`
 * cookie. It touches no admin loader, no admin guard and no `asid`
 * cookie, and the destinations come from `TRADER_PORTAL_MAP` — a map
 * that names only paths under `/trader`. A console link has no route
 * into this chrome.
 *
 * `requireRoleOrRedirect` runs on the SERVER before any child renders.
 * It throws Next's redirect signal, so an unauthenticated or wrong-role
 * visitor never receives the page body — it is not rendered and then
 * hidden. Unauthenticated goes to login (they can fix that); the wrong
 * role goes to `/unauthorized`, because signing in again with the same
 * account would change nothing.
 *
 * No `returnTo` is passed. A Server Component layout cannot read the
 * pathname, and a value taken from the query string would need an
 * internal-path allowlist before it could be trusted — so a buyer
 * simply lands on their dashboard after signing in. That is a decision,
 * not an oversight.
 *
 * `middleware.ts` stays locale-only: no role logic runs per navigation.
 *
 * There is deliberately NO "Documents" item. Documents are exposed only
 * as `GET /trader/orders/:id/documents` — per order, with no flat
 * paginated list — so a standalone page could only be built by fanning
 * out over the orders list, whose page boundaries would be the ORDERS'.
 * They are shown inside each order instead, and an inert menu item
 * pointing at a page that will not exist for a while is worse than no
 * item at all.
 */
/**
 * Every page under /trader is rendered per request.
 *
 * Declared on the LAYOUT so it is inherited by the whole segment: a
 * page added later cannot forget it, whereas a per-page declaration is
 * exactly the kind of thing that gets omitted once.
 *
 * This is not a performance setting. These pages carry one signed-in
 * company's orders, notifications and bank details, and a statically
 * generated or shared-cache copy of them is a cross-tenant data leak —
 * the build output showed them as prerendered before this line existed.
 *
 * It does NOT disable the data cache; the reads in lib/trader-data.ts
 * set `cache: "no-store"` explicitly for their own reasons.
 */
export const dynamic = "force-dynamic";

export default async function TraderLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  const session = await requireRoleOrRedirect(appLocale, "TRADER");

  const t = await getTranslations({
    locale: appLocale,
    namespace: "trader.nav",
  });
  const shell = await getTranslations({
    locale: appLocale,
    namespace: "shell",
  });

  // The unread badge is a nice-to-have on the chrome; a failure here
  // must not stop the portal rendering, so it degrades to no badge.
  const unread = await loadUnreadNotificationCount();
  const unreadCount = unread.ok ? unread.data.unread : undefined;

  const basePath = `/${appLocale}/trader`;

  /**
   * WHAT IS WAITING ON THIS BUYER — «إجراء مطلوب لمّا يظهر في واجهة
   * المشتري».
   *
   * THERE IS NO ONE ENDPOINT FOR IT. The supplier has a dashboard read
   * that carries its three figures; the buyer has none, so the three
   * lists «المتابعة» already draws are read here and counted. That is
   * three requests per page, and it is the honest cost of the shortcut
   * until a counts endpoint exists — which would be a server change.
   *
   * SIDE BY SIDE, never in sequence, and a failed read counts zero
   * rather than removing the shortcut: «يبقى الاختصار ظاهرًا دائمًا…
   * ولا يختفي».
   *
   * WHAT COUNTS AS WAITING is what the reader must answer:
   *   — a dispute where the counterparty owes nothing back,
   *   — a return that has arrived and needs its receipt confirmed,
   *   — a product report whose reviewer asked a question.
   */
  const [disputes, returns, reports] = await Promise.all([
    loadDisputes({ pageSize: 50 }),
    loadReplacements({ pageSize: 50 }),
    loadMyProductReports(),
  ]);

  const followUp = await getTranslations({
    locale: appLocale,
    namespace: "trader.followUp",
  });
  const shortcut = await getTranslations({
    locale: appLocale,
    namespace: "trader.actionRequired",
  });

  const actionRows = [
    {
      key: "disputes",
      count: disputes.ok
        ? disputes.data.items.filter((row) => !row.awaitingCounterparty).length
        : 0,
      text: followUp("disputes"),
      href: `${basePath}/follow-up`,
    },
    {
      key: "returns",
      count: returns.ok
        ? returns.data.items.filter((row) => row.status === "SHIPPED").length
        : 0,
      text: followUp("returns"),
      href: `${basePath}/follow-up`,
    },
    {
      key: "productReports",
      count: reports.ok
        ? reports.data.filter((row) => row.status === "CLARIFICATION_REQUESTED").length
        : 0,
      text: followUp("productReports"),
      href: `${basePath}/follow-up`,
    },
  ];

  const actionLabels = {
    title: shortcut("title"),
    clear: shortcut("clear"),
    countLabel: shortcut("countLabel"),
  };

  // Built from the map, so a destination added there cannot be rendered
  // without a name.
  const pageNames: Record<string, string> = {};
  for (const page of portalPages(TRADER_PORTAL_MAP))
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


  // THE GROUP NAMES ARE STILL TRANSLATED, and nothing draws them any
  // more: «يحوّلها جميعًا إلى ألسنة». They stay in the labels because
  // the map still declares the groups — that is what `trader-shell`
  // walks against the filesystem — and a label a component may ask for
  // and not find is a key printed raw on screen.
  const orders = await getTranslations({
    locale: appLocale,
    namespace: "trader.orders",
  });
  const opportunities = await getTranslations({
    locale: appLocale,
    namespace: "trader.opportunities",
  });

  const groupNames: Record<string, string> = {};
  for (const group of TRADER_PORTAL_MAP.groups)
    groupNames[group.key] = t(`group.${group.key}`);


  return (
    <>
      <SkipLink label={shell("skipToContent")} />

      <TraderChrome
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
        // chrome, so a sentence is the same wherever it is read from.
        barLinkLabels={{
          browseOffers: orders("browseOpportunities"),
          // THE WAY BACK, in the strip rather than on the page — see
          // `traderBarLinks`.
          backToList: opportunities("detail.backToList"),
        }}
        // THE CATEGORIES, ON THE MARKET TAB AND NOWHERE ELSE — «وأضف في
        // لسان السوق في صفحة المشتري التصنيفات». The same component the
        // visitor's front draws, on this front's own base path: a buyer
        // and a visitor browse one catalogue.
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
          placeholder: shell("search.placeholder"),
          label: shell("search.label"),
          submitLabel: shell("search.submit"),
        }}
        // NO MARKET LINK IN THE DRAWER ANY MORE — «المنتجات» stands
        // open above it on a narrow screen, and the same destination
        // in both places is two answers to one question. The drawer
        // keeps this front's five pages, which is what it is for.
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
        // THE NARROW ROW'S OWN CONTROLS — «لسان فوق وشعار وأيقونة
        // اللغة والإشعارات».
        //
        // A SECOND BELL, not the one above. A server-rendered node
        // placed twice inside a client component is MOVED rather than
        // copied — measured, that cost the search field its place on
        // the page for a whole build. Only one of the two rows is
        // ever visible.
        //
        // AND NO ACCOUNT GLYPH: «حسابي» is in the bar at the foot,
        // where it opens «بياناتي» and «خروج».
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
        categoryBand={<CategoryBandSlot locale={appLocale} basePath={basePath} />}

        // THE BELL COMES DOWN TO THE TAB ROW, as it did for the
        // supplier — one door into that page, standing beside the
        // pages it sits among rather than up in the platform's bar.
        bell={
          <NotificationBell
            href={`${basePath}/notifications`}
            unread={unreadCount}
            prominent
          />
        }
        // THE ROW OF TABS IS THIS FRONT'S BAR NOW.
        brand={
          <BrandMark
            branding={branding}
            logoAlt={shell("logoAlt")}
            homeLabel={shell("goHome")}
            // THE PORTAL'S OWN HOME, not the platform's front door —
            // «إذا ضغطت على الشعار وأنا داخل بحساب المشتري يودّيني لصفحة
            // الزائر». The mark stands at the head of THIS front's row;
            // pressing it should reach the first tab in that row, not
            // walk somebody out of the portal they are working in.
            homeHref={basePath}
          />
        }
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
        // «إجراء مطلوب» — UNDER THE MARK, ON EVERY PAGE, and in the navy
        // band on the narrow screen that has no mark to stand under.
        alert={<ActionRequired rows={actionRows} labels={actionLabels} />}
      >
        {children}
      </TraderChrome>
    </>
  );
}
