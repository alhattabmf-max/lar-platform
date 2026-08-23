"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { NotificationItem } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { supplierNotificationHref } from "@/lib/supplier-notification-link";
import { formatDateTime } from "@/lib/localized";
import type { AppLocale } from "@/i18n/routing";
import { Button } from "@/components/ui/button";

/**
 * The supplier's notification feed.
 *
 * PER USER, not per company. `NotificationsService` filters on both
 * `userId` and `companyId`, so a colleague clearing their feed does not
 * clear anyone else's — the isolation is a property of the service, and
 * this component simply cannot address another person's row.
 *
 * Destinations come from `supplierNotificationHref`, which maps the
 * contract's CLOSED route kind onto this portal's pages. No URL and no path
 * is ever stored: a stored path outlives the routing it was written
 * against, and a stored URL would be an open redirect with a notification
 * wrapped around it.
 *
 * NOTHING HERE MENTIONS EMAIL. Whether a notification also produced an
 * email, whether that email was delivered, and anything about the outbox
 * are not on this contract and are not this screen's business.
 *
 * No optimistic read state. Marking read is idempotent server-side and
 * returns the ORIGINAL `readAt`, so a double-click cannot make something
 * look newly read — `router.refresh()` re-reads rather than painting.
 */
export interface SupplierNotificationListProps {
  locale: string;
  items: readonly NotificationItem[];
  unreadCount: number;
  labels: {
    markRead: string;
    markAllRead: string;
    working: string;
    open: string;
    unreadBadge: string;
    /** Keyed by notification type. */
    type: Record<string, string>;
    noDestination: string;
    errorTitle: string;
    requestIdLabel: string;
  };
}

export function SupplierNotificationList({
  locale,
  items,
  unreadCount,
  labels,
}: SupplierNotificationListProps) {
  const router = useRouter();
  const root = useTranslations();

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  async function mutate(run: () => Promise<unknown>) {
    // One guard for the whole panel: marking one read while "mark all" is
    // in flight would race the same rows.
    if (busy) return;

    setBusy(true);
    setFailure(null);

    try {
      await run();
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {unreadCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-11"
            disabled={busy}
            isLoading={busy}
            onClick={() => void mutate(() => apiClient.post("/supplier/notifications/read-all"))}
          >
            {busy ? labels.working : labels.markAllRead}
          </Button>
        </div>
      ) : null}

      <ul className="flex list-none flex-col gap-3">
        {items.map((item) => {
          const href = supplierNotificationHref(item, locale);
          const unread = item.readAt === null;

          return (
            <li
              key={item.id}
              className={`flex flex-col gap-2 rounded-lg border p-4 ${
                unread ? "border-accent-interactive bg-surface" : "border-line bg-surface"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-content">{labels.type[item.type]}</p>
                {unread ? (
                  <span className="rounded-full bg-accent-interactive px-2 py-0.5 text-xs font-semibold text-accent-interactive-foreground">
                    {labels.unreadBadge}
                  </span>
                ) : null}
                <time dateTime={item.createdAt} className="text-xs text-content-muted">
                  {formatDateTime(item.createdAt, locale as AppLocale)}
                </time>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {href ? (
                  <Link
                    href={href}
                    className="inline-flex min-h-11 items-center text-sm text-secondary hover:opacity-90"
                  >
                    {labels.open}
                  </Link>
                ) : (
                  // A route kind with no supplier page, or a row missing
                  // the id its route needs. Either way: no affordance
                  // rather than a link into `/supplier/orders/undefined`.
                  <span className="text-sm text-content-muted">{labels.noDestination}</span>
                )}

                {unread ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() =>
                      void mutate(() =>
                        apiClient.post(`/supplier/notifications/${item.id}/read`)
                      )
                    }
                  >
                    {busy ? labels.working : labels.markRead}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {failure ? (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-danger-text">{labels.errorTitle}</p>
          <p className="text-content">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-content-muted">
              {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
