"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { isActionRequired, type NotificationItem } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { notificationHref } from "@/lib/notification-link";
import { formatDateTime } from "@/lib/localized";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";

/**
 * The notification feed.
 *
 * EVERY MESSAGE IS BUILT HERE, from the stored `type` plus its
 * whitelisted scalar `params`, through next-intl. Nothing rendered
 * comes out of the database as text: a notification row stores a type
 * and a handful of scalars, never a sentence and never markup. That is
 * what keeps message content out of the database — and out of the
 * class of bugs where stored text later needs redacting.
 *
 * WHERE ONE LEADS is resolved by `notificationHref`, which maps the
 * closed route KIND to this app's routing. No URL and no path is ever
 * stored. When the resolver returns null — a kind with no trader page,
 * or a malformed row missing the id its route needs — there is NO
 * action affordance at all, rather than a link to `/orders/undefined`.
 *
 * Read state is per user. `markRead` is idempotent on the server and
 * preserves the ORIGINAL `readAt`, so opening the same notification
 * twice cannot make it look newly read.
 *
 * Nothing here mentions email, delivery, or the outbox. Whether a
 * notification also produced a message is invisible to this API on
 * purpose: this is a feed, not a delivery dashboard.
 */
export interface NotificationListProps {
  items: readonly NotificationItem[];
  locale: string;
  /** True when at least one item on this page is unread. */
  hasUnread: boolean;
}

export function NotificationList({ items, locale, hasUnread }: NotificationListProps) {
  const t = useTranslations("trader.notifications");
  const states = useTranslations("states");
  const root = useTranslations();
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  /**
   * Marks one read, then re-reads from the server.
   *
   * Not optimistic: the unread badge in the chrome is server-rendered,
   * and painting this row read while the badge still counts it would
   * put two numbers on one screen that disagree.
   */
  async function markRead(id: string) {
    if (busy) return;
    setBusy(true);
    setFailure(null);

    try {
      await apiClient.post(`/trader/notifications/${id}/read`);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    if (busy) return;
    setBusy(true);
    setFailure(null);

    try {
      await apiClient.post("/trader/notifications/read-all");
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {hasUnread ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={markAllRead}
            isLoading={busy}
            disabled={busy}
          >
            {t("markAllRead")}
          </Button>
        </div>
      ) : null}

      <div role="alert" aria-live="assertive" className="empty:hidden">
        {failure ? (
          <div className="flex flex-col gap-1 rounded-md border border-danger bg-background p-3 text-sm">
            <p className="font-medium text-danger-text">{states("errorTitle")}</p>
            <p className="text-content">{root(failure.messageKey)}</p>
            {failure.requestId ? (
              <p className="text-content-muted">
                {states("requestIdLabel")}:{" "}
                <span className="font-mono">{failure.requestId}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul className="flex list-none flex-col gap-3">
        {items.map((item) => {
          const href = notificationHref(item, locale);
          const unread = item.readAt === null;
          const needsAction = isActionRequired(item.type);

          return (
            <li key={item.id}>
              <article
                className={`flex flex-col gap-2 rounded-lg border p-4 ${
                  needsAction && unread
                    ? "border-warning bg-warning-surface"
                    : unread
                      ? "border-line-strong bg-surface"
                      : "border-line bg-surface"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  {/* Built from the type and its params. `params` is a
                      closed vocabulary of scalars, so there is nothing
                      here that could carry markup even if it tried. */}
                  <p className="min-w-0 flex-1 text-sm text-content">
                    {t(`message.${item.type}`, { ...item.params })}
                  </p>

                  {unread ? (
                    <span className="rounded-md border border-line-strong px-2 py-0.5 text-xs font-medium text-content">
                      {t("unread")}
                    </span>
                  ) : null}
                </div>

                <time dateTime={item.createdAt} className="text-sm text-content-muted">
                  {formatDateTime(item.createdAt, locale as never)}
                </time>

                <div className="flex flex-wrap items-center gap-3">
                  {/* A LINK for navigation. Absent entirely when the
                      resolver has no destination — a settlement, which
                      a trader has no page for, or a row missing the id
                      its route needs. */}
                  {href ? (
                    <Link
                      href={href}
                      onClick={() => {
                        // Opening it IS the acknowledgement. The
                        // navigation is not blocked on the request:
                        // failing to mark it read must not stop someone
                        // reaching the thing it points at.
                        if (unread) void markRead(item.id);
                      }}
                      className="text-sm text-secondary hover:opacity-90"
                    >
                      {t(`action.${item.type}`)}
                    </Link>
                  ) : null}

                  {/* An explicit control too, so a notification with no
                      destination can still be dismissed, and so opening
                      is not the only way to clear one. */}
                  {unread ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => markRead(item.id)}
                      disabled={busy}
                    >
                      {t("markRead")}
                    </Button>
                  ) : null}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
