import {
  notificationRouteId,
  notificationRouteKind,
  type NotificationItem,
  type NotificationRouteKind,
} from "@platform/types";

/**
 * Where a SUPPLIER's notification leads.
 *
 * A separate resolver from the trader's, not a shared one with a role
 * flag: the two portals answer the same route kinds with different pages,
 * and a flag is one wrong argument away from sending a supplier to
 * `/trader/orders/…`.
 *
 * The path is built from the CLOSED route kind the contract resolves, never
 * from anything stored. No URL and no path is persisted: a stored path
 * outlives the routing it was written against, and a stored URL would be an
 * open redirect with a notification wrapped around it.
 */

/**
 * The five kinds, mapped to this portal's routes.
 *
 * `Record<NotificationRouteKind, …>` on purpose: a kind added to the
 * contract fails the type check here rather than falling through to a
 * notification with no destination.
 */
const PATH_FOR_KIND: Record<
  NotificationRouteKind,
  (locale: string, id: string) => string | null
> = {
  ORDER_DETAIL: (locale, id) => `/${locale}/supplier/orders/${id}`,
  DISPUTE_DETAIL: (locale, id) => `/${locale}/supplier/disputes/${id}`,
  REPLACEMENT_DETAIL: (locale, id) =>
    `/${locale}/supplier/replacement-obligations/${id}`,
  /**
   * A REAL link, unlike the trader's.
   *
   * `SETTLEMENT_EXECUTED` is addressed to the supplier — it is their payout
   * — and `/supplier/settlements/:id` is where it is explained. The trader
   * resolver returns null for this kind precisely because a trader has no
   * settlement screen and never will.
   */
  SETTLEMENT_DETAIL: (locale, id) => `/${locale}/supplier/settlements/${id}`,
  /**
   * A checkout session belongs to the TRADER who opened it. A supplier has
   * no checkout screen, and a `PAYMENT_*` notification should never reach
   * one — this is what happens if one ever does: the notification renders
   * with no action affordance rather than a link into a page that is not
   * theirs.
   */
  CHECKOUT_SESSION: () => null,
};

/**
 * The internal path for a notification, or null when there is none.
 *
 * Null has two causes and both must produce the same outcome — no action
 * affordance:
 *
 *  - the route kind has no supplier-facing page;
 *  - the id the route needs is missing. An allocation event routes to its
 *    ORDER, so the id comes from `params.orderId`; a malformed row without
 *    it has nowhere to go, and a link to `/supplier/orders/undefined` is
 *    worse than no link.
 */
export function supplierNotificationHref(
  item: Pick<NotificationItem, "type" | "entityType" | "entityId" | "params">,
  locale: string
): string | null {
  const id = notificationRouteId(item);
  if (!id) return null;

  return PATH_FOR_KIND[notificationRouteKind(item)](locale, id);
}
