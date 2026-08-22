/**
 * Notification contracts.
 *
 * A notification stores a TYPE plus whitelisted scalar `params`, never
 * rendered text. The frontend translates via next-intl, which gives
 * both locales for free and — more importantly — keeps message content
 * out of the database by construction, so a notification row cannot
 * accumulate the kind of text that would later need redacting.
 *
 * Nothing here carries an email address, a delivery status, or any
 * notion of the outbox. Whether an email was also queued is invisible
 * to this contract on purpose: the UI shows in-app notifications and
 * must never present itself as a delivery dashboard.
 */

/** All 18 business events that produce a notification. */
export const NOTIFICATION_TYPES = [
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "ORDER_CREATED",
  "ALLOCATION_PREPARATION_STARTED",
  "ALLOCATION_READY",
  "ALLOCATION_SHIPPED",
  "ALLOCATION_DELIVERED",
  "MASTER_ORDER_FULFILLED",
  "DISPUTE_OPENED",
  "DISPUTE_SUPPLIER_RESPONDED",
  "DISPUTE_DECIDED",
  "REFUND_INITIATED",
  "REFUND_FAILED",
  "REPLACEMENT_REQUIRED",
  "REPLACEMENT_SHIPPED",
  "REPLACEMENT_DELIVERED",
  "REPLACEMENT_FAILED",
  "SETTLEMENT_EXECUTED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * The 13 types that ALSO emit an email intent.
 *
 * Derived from the notification event matrix, which is authoritative
 * because it names the individual events. The remaining five are
 * in-app only — they report routine fulfilment progress that does not
 * warrant a message in someone's inbox.
 *
 * These 13 names are identical to the template ids in
 * `@platform/email`, which is what lets the writer map a type to a
 * template without a translation table that could drift.
 */
export const EMAIL_EMITTING_NOTIFICATION_TYPES = [
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "ORDER_CREATED",
  "ALLOCATION_SHIPPED",
  "MASTER_ORDER_FULFILLED",
  "DISPUTE_OPENED",
  "DISPUTE_SUPPLIER_RESPONDED",
  "DISPUTE_DECIDED",
  "REFUND_INITIATED",
  "REFUND_FAILED",
  "REPLACEMENT_REQUIRED",
  "REPLACEMENT_FAILED",
  "SETTLEMENT_EXECUTED",
] as const;

export type EmailEmittingNotificationType = (typeof EMAIL_EMITTING_NOTIFICATION_TYPES)[number];

export function emitsEmail(type: NotificationType): type is EmailEmittingNotificationType {
  return (EMAIL_EMITTING_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/**
 * The closed parameter vocabulary.
 *
 * Scalars only. There is deliberately no counterparty settlement
 * detail, no IBAN, no bank transfer reference, no dispute evidence and
 * no counterparty identity — and no free-text field of any kind, which
 * is what stops an exception message ever landing here.
 */
export const NOTIFICATION_PARAM_KEYS = [
  "orderId",
  "allocationId",
  "disputeId",
  "amount",
  "currency",
  "count",
] as const;

export type NotificationParamKey = (typeof NOTIFICATION_PARAM_KEYS)[number];
export type NotificationParams = Partial<Record<NotificationParamKey, string | number>>;

/**
 * Which parameters each type may carry.
 *
 * Per-type, not one global list: a `disputeId` on a settlement
 * notification is malformed data, and rejecting it at the write is
 * better than rendering a message that silently ignores the field.
 */
export const NOTIFICATION_TYPE_PARAM_KEYS: Readonly<
  Record<NotificationType, readonly NotificationParamKey[]>
> = {
  PAYMENT_SUCCEEDED: ["orderId", "amount", "currency"],
  PAYMENT_FAILED: ["orderId", "amount", "currency"],
  ORDER_CREATED: ["orderId"],
  ALLOCATION_PREPARATION_STARTED: ["orderId", "allocationId"],
  ALLOCATION_READY: ["orderId", "allocationId"],
  ALLOCATION_SHIPPED: ["orderId", "allocationId"],
  ALLOCATION_DELIVERED: ["orderId", "allocationId"],
  MASTER_ORDER_FULFILLED: ["orderId"],
  DISPUTE_OPENED: ["orderId", "allocationId", "disputeId"],
  DISPUTE_SUPPLIER_RESPONDED: ["disputeId"],
  DISPUTE_DECIDED: ["disputeId"],
  REFUND_INITIATED: ["orderId", "amount", "currency"],
  REFUND_FAILED: ["orderId", "amount", "currency"],
  REPLACEMENT_REQUIRED: ["orderId", "allocationId"],
  REPLACEMENT_SHIPPED: ["orderId", "allocationId"],
  REPLACEMENT_DELIVERED: ["orderId", "allocationId"],
  REPLACEMENT_FAILED: ["orderId", "allocationId"],
  SETTLEMENT_EXECUTED: ["amount", "currency"],
};

/**
 * What a notification points at.
 *
 * A closed vocabulary, so the UI can build its own internal route from
 * `entityType` + `entityId`. No URL is ever stored: a stored link is a
 * link that outlives the routing it was written against, and an
 * external one would be an open redirect with a notification wrapped
 * around it.
 */
export const NOTIFICATION_ENTITY_TYPES = [
  "master_order",
  "order_allocation",
  "dispute",
  "replacement_obligation",
  "supplier_payout",
  "checkout_session",
] as const;

export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

/**
 * Which entity types each notification type may point at.
 *
 * Mostly one, because most events concern exactly one kind of thing.
 * Three carry TWO, and not for convenience — those events genuinely
 * occur on two different paths:
 *
 *   PAYMENT_FAILED    a payment can fail before any order exists, so
 *                     the resumable thing is the checkout session.
 *   REFUND_*          a PAYMENT_EXCEPTION refund is raised inside the
 *                     capture webhook BEFORE the order is created; a
 *                     DISPUTE refund always has one.
 *
 * `entityType` must always describe what `entityId` actually is. The
 * writer rejects any pair outside this map, so a notification cannot
 * claim to point at an order while carrying a session id — which would
 * send the UI to a 404 or, worse, to an unrelated record that happened
 * to share the id space.
 */
export const NOTIFICATION_TYPE_ENTITY_TYPES: Readonly<
  Record<NotificationType, readonly NotificationEntityType[]>
> = {
  PAYMENT_SUCCEEDED: ["master_order"],
  PAYMENT_FAILED: ["checkout_session"],
  ORDER_CREATED: ["master_order"],
  ALLOCATION_PREPARATION_STARTED: ["order_allocation"],
  ALLOCATION_READY: ["order_allocation"],
  ALLOCATION_SHIPPED: ["order_allocation"],
  ALLOCATION_DELIVERED: ["order_allocation"],
  MASTER_ORDER_FULFILLED: ["master_order"],
  DISPUTE_OPENED: ["dispute"],
  DISPUTE_SUPPLIER_RESPONDED: ["dispute"],
  DISPUTE_DECIDED: ["dispute"],
  REFUND_INITIATED: ["master_order", "checkout_session"],
  REFUND_FAILED: ["master_order", "checkout_session"],
  REPLACEMENT_REQUIRED: ["replacement_obligation"],
  REPLACEMENT_SHIPPED: ["replacement_obligation"],
  REPLACEMENT_DELIVERED: ["replacement_obligation"],
  REPLACEMENT_FAILED: ["replacement_obligation"],
  SETTLEMENT_EXECUTED: ["supplier_payout"],
};

export function isAllowedNotificationEntityType(
  type: NotificationType,
  entityType: string
): entityType is NotificationEntityType {
  return (NOTIFICATION_TYPE_ENTITY_TYPES[type] as readonly string[]).includes(entityType);
}

/**
 * Where a notification leads, as a CLOSED vocabulary.
 *
 * Not a URL and not a path — a route KIND that the web app maps to its
 * own routing. Storing a path would outlive the routing it was written
 * against; storing a URL would be an open redirect wrapped in a
 * notification.
 *
 * The UI resolves `(type, entityType) -> kind`, then builds the link
 * from `kind` + `entityId`. It never parses a message, an amount, or
 * anything else to work out where to go.
 */
export const NOTIFICATION_ROUTE_KINDS = [
  "ORDER_DETAIL",
  "CHECKOUT_SESSION",
  "DISPUTE_DETAIL",
  "REPLACEMENT_DETAIL",
  "SETTLEMENT_DETAIL",
] as const;

export type NotificationRouteKind = (typeof NOTIFICATION_ROUTE_KINDS)[number];

const ENTITY_ROUTE_KIND: Readonly<Record<NotificationEntityType, NotificationRouteKind>> = {
  master_order: "ORDER_DETAIL",
  order_allocation: "ORDER_DETAIL",
  dispute: "DISPUTE_DETAIL",
  replacement_obligation: "REPLACEMENT_DETAIL",
  supplier_payout: "SETTLEMENT_DETAIL",
  checkout_session: "CHECKOUT_SESSION",
};

/**
 * Resolves a notification to its route kind.
 *
 * An allocation resolves to the ORDER detail rather than a page of its
 * own: there is no allocation route, and the allocation is shown within
 * its order. `params.orderId` carries the id that route needs, which is
 * why every allocation event is required to include it.
 */
export function notificationRouteKind(item: {
  type: NotificationType;
  entityType: NotificationEntityType;
}): NotificationRouteKind {
  return ENTITY_ROUTE_KIND[item.entityType];
}

/**
 * The identifier the route needs, which is not always `entityId`.
 *
 * For an allocation event the destination is the order, so the id comes
 * from `params.orderId`. Returning null means there is no usable
 * destination and the UI must NOT offer an action affordance.
 */
export function notificationRouteId(item: {
  type: NotificationType;
  entityType: NotificationEntityType;
  entityId: string;
  params: NotificationParams;
}): string | null {
  if (item.entityType === "order_allocation") {
    const orderId = item.params.orderId;
    return typeof orderId === "string" && orderId.length > 0 ? orderId : null;
  }
  return item.entityId.length > 0 ? item.entityId : null;
}

/**
 * Types that ask someone to do something.
 *
 * Exposed on the contract rather than left to the UI to guess, so an
 * informational update is never dressed up with a call to action and an
 * actionable one is never buried.
 */
export const ACTION_REQUIRED_NOTIFICATION_TYPES = [
  "PAYMENT_FAILED",
  "ORDER_CREATED",
  "DISPUTE_OPENED",
  "REFUND_FAILED",
  "REPLACEMENT_REQUIRED",
  "REPLACEMENT_FAILED",
] as const;

export type ActionRequiredNotificationType = (typeof ACTION_REQUIRED_NOTIFICATION_TYPES)[number];

export function isActionRequired(type: NotificationType): boolean {
  return (ACTION_REQUIRED_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  /** With `entityId`, enough to build a safe internal link. */
  entityType: NotificationEntityType;
  entityId: string;
  params: NotificationParams;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, or null while unread. Per-user — a colleague's state is invisible. */
  readAt: string | null;
}

export const NOTIFICATION_ITEM_KEYS = [
  "id",
  "type",
  "entityType",
  "entityId",
  "params",
  "createdAt",
  "readAt",
] as const satisfies readonly (keyof NotificationItem)[];

/** Drives the unread badge without fetching a page of items. */
export interface NotificationUnreadCount {
  unread: number;
}

/**
 * Marking one notification read.
 *
 * `readAt` is STABLE across repeat calls — the first call's timestamp
 * is preserved — so a double-click cannot make a notification look
 * newly read. `changed` reports whether this call was the one that
 * moved it.
 */
export interface NotificationReadResult {
  id: string;
  readAt: string;
  changed: boolean;
}

/** `changed` is the number of rows this call actually moved, not the total read. */
export interface NotificationReadAllResult {
  changed: number;
}

/**
 * Hard ceiling on a notification page.
 *
 * Lower than the platform-wide MAX_PAGE_SIZE: a notification list is a
 * dropdown and a feed, never a bulk export, and a smaller cap keeps the
 * unread badge and the first page cheap.
 */
export const MAX_NOTIFICATION_PAGE_SIZE = 50;
export const DEFAULT_NOTIFICATION_PAGE_SIZE = 20;
