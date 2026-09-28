import { getTranslations } from "next-intl/server";
import { isActionRequired } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadNotifications } from "@/lib/trader-data";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { NotificationList } from "@/components/trader/notification-list";
import { TraderPagination, parsePage } from "@/components/trader/trader-pagination";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("trader.notifications");


/**
 * The trader's notifications.
 *
 * Read state is PER USER: the API scopes both the list and the unread
 * count to `session.userId`, so a colleague's reading does not clear
 * anyone else's feed.
 *
 * What asks for action comes first — but only among the UNREAD. An
 * action-required notification that has already been read is history,
 * and lifting it forever would keep the top of the list frozen on
 * something already dealt with. This is a reorder within the page the
 * API returned, so no count changes and nothing is hidden.
 */
export default async function TraderNotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;

  await requireRoleOrRedirect(appLocale, "TRADER");

  const page = parsePage((await searchParams).page);

  const t = await getTranslations({ locale: appLocale, namespace: "trader.notifications" });
  const states = await getTranslations({ locale: appLocale, namespace: "states" });
  const pagination = await getTranslations({ locale: appLocale, namespace: "pagination" });

  const result = await loadNotifications({ page });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        {/* THE TAB ABOVE IS THIS PAGE'S TITLE — «ألغِ التسمية المكررة مثل
              ما سوّينا في صفحة المورد». The heading stays for the document
              outline and for anyone reading by structure; a tab is a link
              and can never stand in for one. */}
          <h1 className="sr-only">{t("title")}</h1>
      </header>

      {!result.ok ? (
        <ErrorState
          title={states("errorTitle")}
          description={states("errorDescription")}
          requestId={result.error.requestId}
          requestIdLabel={states("requestIdLabel")}
        />
      ) : result.data.items.length === 0 ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
      ) : (
        <NotificationList
          locale={appLocale}
          hasUnread={result.data.items.some((item) => item.readAt === null)}
          items={[...result.data.items].sort((a, b) => {
            const aFirst = a.readAt === null && isActionRequired(a.type);
            const bFirst = b.readAt === null && isActionRequired(b.type);
            if (aFirst !== bFirst) return aFirst ? -1 : 1;
            // Otherwise the API's own order stands: newest first, which
            // is what a feed means.
            return 0;
          })}
        />
      )}

      {result.ok ? (
        <TraderPagination
          basePath={`/${appLocale}/trader/notifications`}
          page={result.data.page}
          pageSize={result.data.pageSize}
          total={result.data.total}
          labels={{
            navLabel: pagination("navLabel"),
            previous: pagination("previous"),
            next: pagination("next"),
            status: pagination("status", {
              page: result.data.page,
              lastPage: Math.max(1, Math.ceil(result.data.total / result.data.pageSize)),
            }),
          }}
        />
      ) : null}
    </div>
  );
}
