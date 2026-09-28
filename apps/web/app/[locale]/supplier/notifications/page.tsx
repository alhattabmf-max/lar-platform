import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { NOTIFICATION_TYPES } from "@platform/types";
import type { AppLocale } from "@/i18n/routing";
import { requireRoleOrRedirect } from "@/lib/auth-redirects";
import { loadSupplierNotifications, loadSupplierUnreadCount } from "@/lib/supplier-data";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { SupplierNotificationList } from "@/components/supplier/supplier-notification-list";
import { pageTitle } from "@/lib/page-metadata";

export const generateMetadata = pageTitle("supplier.notifications");


/**
 * The signed-in user's notifications.
 *
 * PER USER. `NotificationsService` filters on `userId` AND `companyId`, so
 * read state belongs to the person, not the company — a colleague clearing
 * their feed does not clear anyone else's.
 *
 * 8D's producers already wrote supplier-targeted notifications:
 * `ORDER_CREATED`, `DISPUTE_OPENED`, `REPLACEMENT_REQUIRED` and
 * `SETTLEMENT_EXECUTED` all carry `targetCompany: "SUPPLIER"`. Until this
 * page existed they were written and unreadable.
 *
 * Nothing here mentions email, delivery status or the outbox. None of it is
 * on the contract, and whether a message also reached an inbox is not this
 * screen's business.
 */
export default async function SupplierNotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireRoleOrRedirect(appLocale, "SUPPLIER");

  const t = await getTranslations({ locale: appLocale, namespace: "supplier.notifications" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("title")}</h1>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={4} />}>
        <Feed locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function Feed({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "supplier.notifications" });
  const states = await getTranslations({ locale, namespace: "states" });

  const [notifications, unread] = await Promise.all([
    loadSupplierNotifications({ pageSize: 50 }),
    loadSupplierUnreadCount(),
  ]);

  if (!notifications.ok) {
    return (
      <ErrorState
        title={states("errorTitle")}
        description={states("errorDescription")}
        requestId={notifications.error.requestId}
        requestIdLabel={states("requestIdLabel")}
      />
    );
  }

  if (notifications.data.total === 0) {
    return <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <SupplierNotificationList
        locale={locale}
        items={notifications.data.items}
        // A failed count degrades to no bulk control rather than costing
        // the whole feed.
        unreadCount={unread.ok ? unread.data.unread : 0}
        labels={{
          markRead: t("markRead"),
          markAllRead: t("markAllRead"),
          working: t("working"),
          open: t("open"),
          unreadBadge: t("unread"),
          // `Record<NotificationType, string>` built from the shared
          // vocabulary: a type added to the contract fails here rather
          // than rendering an empty row.
          type: Object.fromEntries(
            NOTIFICATION_TYPES.map((type) => [type, t(`type.${type}`)])
          ),
          noDestination: t("noDestination"),
          errorTitle: states("errorTitle"),
          requestIdLabel: states("requestIdLabel"),
        }}
      />

      {notifications.data.total > notifications.data.items.length ? (
        <p className="text-sm text-content-muted">{t("showingRecent")}</p>
      ) : null}
    </div>
  );
}
