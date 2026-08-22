import {
  notificationRouteId,
  notificationRouteKind,
  type NotificationItem,
  type NotificationRouteKind,
} from "@platform/types";

/**
 * Where a notification leads.
 *
 * The path is built from the CLOSED route kind the contract resolves,
 * never from anything stored. No URL and no path is ever persisted: a
 * stored path outlives the routing it was written against, and a
 * stored URL would be an open redirect with a notification wrapped
 * around it.
 *
 * Nothing here parses a message, an amount, or any other field to work
 * out a destination. The input is `(type, entityType, entityId,
 * params)` and the output is one of five known shapes.
 */

/**
 * The five kinds, mapped to this app's routes.
 *
 * `Record<NotificationRouteKind, …>` on purpose: a kind added to the
 * contract fails the type check here rather than falling through to a
 * notification with no destination.
 */
const PATH_FOR_KIND: Record<
  NotificationRouteKind,
  (locale: string, id: string) => string | null
> = {
  ORDER_DETAIL: (locale, id) => `/${locale}/trader/orders/${id}`,
  DISPUTE_DETAIL: (locale, id) => `/${locale}/trader/disputes/${id}`,
  REPLACEMENT_DETAIL: (locale, id) => `/${locale}/trader/replacements/${id}`,
  CHECKOUT_SESSION: (locale, id) => `/${locale}/trader/checkout/${id}`,
  /**
   * A supplier payout. A TRADER has no settlement screen and never
   * will — settlements pay suppliers, and this notification type is
   * addressed to them.
   *
   * Returning null means the trader portal renders the notification
   * with no action affordance rather than a link into a page that is
   * not theirs. A `SETTLEMENT_EXECUTED` should never reach a trader in
   * the first place; this is what happens if one ever does.
   */
  SETTLEMENT_DETAIL: () => null,
};

/**
 * The internal path for a notification, or null when there is none.
 *
 * Null has two causes and both must produce the same outcome — no
 * action affordance:
 *
 *  - the route kind has no trader-facing page;
 *  - the id the route needs is missing. An allocation event routes to
 *    its ORDER, so the id comes from `params.orderId`; a malformed row
 *    without it has nowhere to go, and a link to
 *    `/trader/orders/undefined` is worse than no link.
 */
export function notificationHref(
  item: Pick<NotificationItem, "type" | "entityType" | "entityId" | "params">,
  locale: string
): string | null {
  const id = notificationRouteId(item);
  if (!id) return null;

  return PATH_FOR_KIND[notificationRouteKind(item)](locale, id);
}
