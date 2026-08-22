import type {
  NotificationEntityType,
  NotificationRouteKind,
  NotificationParamKey,
  NotificationType,
} from "@platform/types";

/**
 * The verification matrix: every notification type mapped to the REAL
 * code that produces it.
 *
 * This is a declaration that a test checks against the source tree, not
 * documentation that drifts. `producerFile` and `producerMethod` are
 * asserted to exist; `channel` is asserted against the email-emitting
 * union; `params` is asserted to be a subset of the type's own
 * whitelist. A producer that is renamed, or a type that gains a param
 * it is not allowed, fails the build.
 *
 * `urgency` is not cosmetic. An ACTION_REQUIRED notification carries
 * the identifier needed to reach the page where the action happens; an
 * INFORMATIONAL one must not be phrased so that a reader goes looking
 * for something to do.
 */
export interface NotificationProducerSpec {
  /** The business event, in the domain's own words. */
  businessEvent: string;
  /** Path under apps/api/src, asserted to exist. */
  producerFile: string;
  /** Method that performs the transition, asserted to appear in that file. */
  producerMethod: string;
  /**
   * The NotificationEventsService method the producer calls.
   *
   * Asserted to appear in the producer file, which is what proves the
   * wiring exists rather than merely that the type is mentioned
   * somewhere in it.
   */
  emitterMethod: string;
  /** Where the transaction client comes from. */
  transactionSource: string;
  /** Whose company receives it. Recipients are expanded from this company alone. */
  targetCompany: "TRADER" | "SUPPLIER";
  /** How the company is resolved inside the transaction. */
  recipientRule: string;
  /**
   * What distinguishes repeated notifications of this type about the
   * same entity. `null` means "there can be only one, ever" — the
   * entity id alone is enough.
   */
  dedupeDiscriminator: string | null;
  /**
   * Every entity type this notification may point at.
   *
   * Authored here independently of NOTIFICATION_TYPE_ENTITY_TYPES in
   * the shared contract; the spec asserts the two are equal, so a
   * change to either without the other fails the build.
   */
  entityTypes: readonly NotificationEntityType[];
  params: readonly NotificationParamKey[];
  channel: "EMAIL_AND_IN_APP" | "IN_APP_ONLY";
  urgency: "ACTION_REQUIRED" | "INFORMATIONAL";
  /**
   * The route KIND the UI resolves this to. Never a path and never a
   * URL — a stored path outlives the routing it was written against.
   */
  routeKind: NotificationRouteKind;
  /** Conditions under which NO notification may be written. */
  noOp: readonly string[];
}

/** Every producer sits behind a guarded transition, so these are universal. */
const UNIVERSAL_NO_OP = [
  "validation failure — the writer throws before any statement",
  "transaction rollback — the notification rolls back with it",
  "duplicate dedupeKey — ON CONFLICT DO NOTHING, no second copy",
  "no eligible active recipient — no orphan notification",
] as const;

/** A guarded UPDATE that claimed zero rows means the state did not move. */
const NO_TRANSITION = "the guarded UPDATE claimed zero rows — the state did not change";

export const NOTIFICATION_MATRIX: Readonly<Record<NotificationType, NotificationProducerSpec>> = {
  PAYMENT_SUCCEEDED: {
    businessEvent: "A payment capture was verified and the master order was created",
    producerFile: "payments/payment-webhook.service.ts",
    producerMethod: "handleSuccessEvent",
    emitterMethod: "paymentSucceeded",
    transactionSource: "the webhook's own $transaction in handleWebhook",
    targetCompany: "TRADER",
    recipientRule: "checkout_sessions.trader_company_id of the captured session",
    dedupeDiscriminator: null,
    entityTypes: ["master_order"],
    params: ["orderId", "amount", "currency"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "INFORMATIONAL",
    routeKind: "ORDER_DETAIL",
    noOp: [
      ...UNIVERSAL_NO_OP,
      "attempt already SUCCEEDED — a duplicate webhook, no state change",
      "capture amount or currency mismatch — a refund is created instead",
      "session already PAID, EXPIRED past deadline, or ABANDONED — refunded, no order",
      "supplier bank account unverified — refunded, no order",
    ],
  },

  PAYMENT_FAILED: {
    businessEvent: "A payment attempt was definitively reported failed by the provider",
    producerFile: "payments/payment-webhook.service.ts",
    producerMethod: "handleFailureEvent",
    emitterMethod: "paymentFailed",
    transactionSource: "the webhook's own $transaction in handleWebhook",
    targetCompany: "TRADER",
    recipientRule: "checkout_sessions.trader_company_id of the failed attempt's session",
    dedupeDiscriminator: "the payment attempt id — a later retry is a different attempt",
    entityTypes: ["checkout_session"],
    params: ["amount", "currency"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "ACTION_REQUIRED",
    routeKind: "CHECKOUT_SESSION",
    noOp: [
      ...UNIVERSAL_NO_OP,
      "attempt already SUCCEEDED — the failure event is out of order and ignored",
    ],
  },

  ORDER_CREATED: {
    businessEvent: "A master order was created from a captured payment",
    producerFile: "payments/payment-webhook.service.ts",
    producerMethod: "handleSuccessEvent",
    emitterMethod: "orderCreated",
    transactionSource: "the webhook's own $transaction in handleWebhook",
    targetCompany: "SUPPLIER",
    recipientRule: "master_orders.supplier_company_id of the created order",
    dedupeDiscriminator: null,
    entityTypes: ["master_order"],
    params: ["orderId"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "ACTION_REQUIRED",
    routeKind: "ORDER_DETAIL",
    noOp: [
      ...UNIVERSAL_NO_OP,
      "every condition that prevents the order being created at all",
    ],
  },

  ALLOCATION_PREPARATION_STARTED: {
    businessEvent: "A supplier began preparing an allocation",
    producerFile: "fulfillment/order-allocation.service.ts",
    producerMethod: "startPreparation",
    emitterMethod: "allocationPreparationStarted",
    transactionSource: "the service's own $transaction around the guarded claim",
    targetCompany: "TRADER",
    recipientRule: "order_allocations -> master_orders.trader_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["order_allocation"],
    params: ["orderId", "allocationId"],
    channel: "IN_APP_ONLY",
    urgency: "INFORMATIONAL",
    routeKind: "ORDER_DETAIL",
    noOp: [...UNIVERSAL_NO_OP, NO_TRANSITION],
  },

  ALLOCATION_READY: {
    businessEvent: "An allocation became ready to ship",
    producerFile: "fulfillment/order-allocation.service.ts",
    producerMethod: "markReady",
    emitterMethod: "allocationReady",
    transactionSource: "the service's own $transaction around the guarded claim",
    targetCompany: "TRADER",
    recipientRule: "order_allocations -> master_orders.trader_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["order_allocation"],
    params: ["orderId", "allocationId"],
    channel: "IN_APP_ONLY",
    urgency: "INFORMATIONAL",
    routeKind: "ORDER_DETAIL",
    noOp: [...UNIVERSAL_NO_OP, NO_TRANSITION],
  },

  ALLOCATION_SHIPPED: {
    businessEvent: "An allocation was shipped with carrier tracking",
    producerFile: "fulfillment/order-allocation.service.ts",
    producerMethod: "ship",
    emitterMethod: "allocationShipped",
    transactionSource: "the service's own $transaction around the guarded claim",
    targetCompany: "TRADER",
    recipientRule: "order_allocations -> master_orders.trader_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["order_allocation"],
    params: ["orderId", "allocationId"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "INFORMATIONAL",
    routeKind: "ORDER_DETAIL",
    noOp: [...UNIVERSAL_NO_OP, NO_TRANSITION],
  },

  ALLOCATION_DELIVERED: {
    businessEvent: "Delivery of an allocation was confirmed (trader, admin or carrier)",
    producerFile: "fulfillment/order-allocation.service.ts",
    producerMethod: "confirmDeliveryTx",
    emitterMethod: "allocationDelivered",
    transactionSource: "the caller's transaction — trader, admin or carrier webhook",
    targetCompany: "TRADER",
    recipientRule: "order_allocations -> master_orders.trader_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["order_allocation"],
    params: ["orderId", "allocationId"],
    channel: "IN_APP_ONLY",
    urgency: "INFORMATIONAL",
    routeKind: "ORDER_DETAIL",
    noOp: [
      ...UNIVERSAL_NO_OP,
      "confirmDeliveryTx returned claimed=false — another path already delivered it",
    ],
  },

  MASTER_ORDER_FULFILLED: {
    businessEvent: "The last allocation of an order was delivered",
    producerFile: "fulfillment/order-allocation.service.ts",
    producerMethod: "confirmDeliveryTx",
    emitterMethod: "masterOrderFulfilled",
    transactionSource: "the caller's transaction, under the MasterOrder FOR UPDATE lock",
    targetCompany: "TRADER",
    recipientRule: "master_orders.trader_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["master_order"],
    params: ["orderId"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "INFORMATIONAL",
    routeKind: "ORDER_DETAIL",
    noOp: [
      ...UNIVERSAL_NO_OP,
      "allocations still outstanding — the order is not fulfilled",
      "the FULFILLED claim returned zero rows — a concurrent path won the race",
    ],
  },

  DISPUTE_OPENED: {
    businessEvent: "A trader opened a dispute on a delivered allocation",
    producerFile: "disputes/dispute.service.ts",
    producerMethod: "openDispute",
    emitterMethod: "disputeOpened",
    transactionSource: "the service's own $transaction",
    targetCompany: "SUPPLIER",
    recipientRule: "the disputed allocation's master_orders.supplier_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["dispute"],
    params: ["orderId", "allocationId", "disputeId"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "ACTION_REQUIRED",
    routeKind: "DISPUTE_DETAIL",
    noOp: [
      ...UNIVERSAL_NO_OP,
      "the HTTP idempotency layer replayed a stored response — no new dispute",
    ],
  },

  DISPUTE_SUPPLIER_RESPONDED: {
    businessEvent: "A supplier responded to an open dispute",
    producerFile: "disputes/dispute.service.ts",
    producerMethod: "supplierRespond",
    emitterMethod: "disputeSupplierResponded",
    transactionSource: "the service's own $transaction",
    targetCompany: "TRADER",
    recipientRule: "the dispute's allocation -> master_orders.trader_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["dispute"],
    params: ["disputeId"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "INFORMATIONAL",
    routeKind: "DISPUTE_DETAIL",
    noOp: [...UNIVERSAL_NO_OP, "an idempotent replay of the same response"],
  },

  DISPUTE_DECIDED: {
    businessEvent: "An administrator decided a dispute",
    producerFile: "disputes/dispute.service.ts",
    producerMethod: "executeDecisionTx",
    emitterMethod: "disputeDecided",
    transactionSource: "the admin decision's transaction",
    targetCompany: "TRADER",
    recipientRule: "the dispute's allocation -> master_orders.trader_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["dispute"],
    params: ["disputeId"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "INFORMATIONAL",
    routeKind: "DISPUTE_DETAIL",
    noOp: [...UNIVERSAL_NO_OP, "an idempotent replay of the same decision"],
  },

  REFUND_INITIATED: {
    businessEvent: "A refund attempt was accepted by the provider",
    producerFile: "refunds/refund-execution.service.ts",
    producerMethod: "startAttempt",
    emitterMethod: "refundInitiated",
    transactionSource: "the service's own $transaction",
    targetCompany: "TRADER",
    recipientRule: "refund_obligations -> payment_attempts -> checkout_sessions.trader_company_id",
    dedupeDiscriminator: "the refund attempt id — a later retry is a different attempt",
    entityTypes: ["master_order", "checkout_session"],
    params: ["amount", "currency"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "INFORMATIONAL",
    routeKind: "ORDER_DETAIL",
    noOp: [
      ...UNIVERSAL_NO_OP,
      "the provider rejected the attempt — the obligation goes to FAILED, no initiation",
    ],
  },

  REFUND_FAILED: {
    businessEvent: "A refund attempt was definitively reported failed by the provider",
    producerFile: "refunds/refund-webhook.service.ts",
    producerMethod: "processEventTx",
    emitterMethod: "refundFailed",
    transactionSource: "the webhook's own $transaction",
    targetCompany: "TRADER",
    recipientRule: "refund_obligations -> payment_attempts -> checkout_sessions.trader_company_id",
    dedupeDiscriminator: "the refund attempt id",
    entityTypes: ["master_order", "checkout_session"],
    params: ["amount", "currency"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "ACTION_REQUIRED",
    routeKind: "ORDER_DETAIL",
    noOp: [
      ...UNIVERSAL_NO_OP,
      "the attempt was already DEFINITIVE_FAILED — a duplicate webhook",
    ],
  },

  REPLACEMENT_REQUIRED: {
    businessEvent: "A dispute decision obliged the supplier to send a replacement",
    producerFile: "disputes/dispute.service.ts",
    producerMethod: "executeDecisionTx",
    emitterMethod: "replacementRequired",
    transactionSource: "the admin decision's transaction",
    targetCompany: "SUPPLIER",
    recipientRule: "the dispute's allocation -> master_orders.supplier_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["replacement_obligation"],
    params: ["orderId", "allocationId"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "ACTION_REQUIRED",
    routeKind: "REPLACEMENT_DETAIL",
    noOp: [...UNIVERSAL_NO_OP, "the decision was not a replacement outcome"],
  },

  REPLACEMENT_SHIPPED: {
    businessEvent: "A replacement obligation was shipped",
    producerFile: "replacement/replacement-obligation.service.ts",
    producerMethod: "ship",
    emitterMethod: "replacementShipped",
    transactionSource: "the service's own $transaction around the guarded claim",
    targetCompany: "TRADER",
    recipientRule: "replacement_obligations -> allocation -> master_orders.trader_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["replacement_obligation"],
    params: ["orderId", "allocationId"],
    channel: "IN_APP_ONLY",
    urgency: "INFORMATIONAL",
    routeKind: "REPLACEMENT_DETAIL",
    noOp: [...UNIVERSAL_NO_OP, NO_TRANSITION],
  },

  REPLACEMENT_DELIVERED: {
    businessEvent: "A replacement obligation was confirmed delivered",
    producerFile: "replacement/replacement-obligation.service.ts",
    producerMethod: "confirmDeliveryTx",
    emitterMethod: "replacementDelivered",
    transactionSource: "the caller's transaction — trader, admin or carrier webhook",
    targetCompany: "TRADER",
    recipientRule: "replacement_obligations -> allocation -> master_orders.trader_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["replacement_obligation"],
    params: ["orderId", "allocationId"],
    channel: "IN_APP_ONLY",
    urgency: "INFORMATIONAL",
    routeKind: "REPLACEMENT_DETAIL",
    noOp: [...UNIVERSAL_NO_OP, "the guarded claim returned zero rows"],
  },

  REPLACEMENT_FAILED: {
    businessEvent: "A replacement obligation was marked failed",
    producerFile: "replacement/replacement-obligation.service.ts",
    producerMethod: "markFailed",
    emitterMethod: "replacementFailed",
    transactionSource: "the service's own $transaction around the guarded claim",
    targetCompany: "TRADER",
    recipientRule: "replacement_obligations -> allocation -> master_orders.trader_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["replacement_obligation"],
    params: ["orderId", "allocationId"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "ACTION_REQUIRED",
    routeKind: "REPLACEMENT_DETAIL",
    noOp: [...UNIVERSAL_NO_OP, NO_TRANSITION],
  },

  SETTLEMENT_EXECUTED: {
    businessEvent: "A supplier payout was executed with a non-zero net amount",
    producerFile: "settlement/supplier-payout.service.ts",
    producerMethod: "settleTx",
    emitterMethod: "settlementExecuted",
    transactionSource: "the settlement's own $transaction",
    targetCompany: "SUPPLIER",
    recipientRule: "the payout's allocation -> master_orders.supplier_company_id",
    dedupeDiscriminator: null,
    entityTypes: ["supplier_payout"],
    params: ["amount", "currency"],
    channel: "EMAIL_AND_IN_APP",
    urgency: "INFORMATIONAL",
    routeKind: "SETTLEMENT_DETAIL",
    noOp: [
      ...UNIVERSAL_NO_OP,
      "outcome was ZERO_BALANCE — nothing was transferred, so nothing is announced",
    ],
  },
};
