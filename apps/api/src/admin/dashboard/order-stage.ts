import type { AdminOrderStage } from "@platform/types";

/**
 * Which of the four stages an order is shown in.
 *
 * `MasterOrderStatus` HAS TWO VALUES — `IN_FULFILLMENT` and
 * `FULFILLED` — and the console shows four columns. The gap is not a
 * missing enum value: it is that "troubled" is not a fulfilment status
 * at all. An order can be perfectly `IN_FULFILLMENT` and still need an
 * administrator, because a dispute was opened on it or a refund could
 * not be paid.
 *
 * SO THE MAPPING IS DERIVED, and this is the one place it lives. The
 * rules, in order:
 *
 *   1. TROUBLED WINS. An order needing intervention is that, whatever
 *      its fulfilment says. Deciding otherwise would hide a disputed
 *      order inside "completed".
 *   2. Otherwise `FULFILLED` is completed.
 *   3. Otherwise it is in fulfilment.
 *
 * THE THREE ARE EXCLUSIVE and they sum to the total. `paid` is not one
 * of them: it is the total itself, because `master_orders` cannot be
 * written without a successful payment — there is no unpaid order to
 * count separately, and none to display.
 *
 * WHAT MAKES AN ORDER TROUBLED, all read from records the platform
 * already keeps:
 *
 *   - a dispute on one of its allocations that has not been resolved;
 *   - a refund attempt that failed definitively;
 *   - an allocation still unprepared past `preparation_due_at`, which
 *     is the deadline the fulfilment flow itself wrote.
 */

/** The fulfilment statuses this mapper knows. Adding one fails the test. */
export const KNOWN_ORDER_STATUSES = ["IN_FULFILLMENT", "FULFILLED"] as const;

export interface OrderStageInput {
  status: string;
  /** Any unresolved dispute on any of its allocations. */
  hasOpenDispute: boolean;
  /** Any refund attempt that ended `DEFINITIVE_FAILED`. */
  hasFailedRefund: boolean;
  /** Any allocation still awaiting preparation past its deadline. */
  hasOverduePreparation: boolean;
}

export function isTroubled(order: OrderStageInput): boolean {
  return (
    order.hasOpenDispute || order.hasFailedRefund || order.hasOverduePreparation
  );
}

export function orderStage(order: OrderStageInput): AdminOrderStage {
  if (isTroubled(order)) return "troubled";
  if (order.status === "FULFILLED") return "completed";
  return "inFulfilment";
}

/**
 * The disputes that still need somebody.
 *
 * `RESOLVED_*` is finished by any reading; the rest are live. Written
 * as the resolved list rather than the open one so a NEW resolution
 * kind added later is treated as open — visible and dealt with — rather
 * than silently disappearing from the count.
 */
export const RESOLVED_DISPUTE_STATUSES = [
  "RESOLVED_ACCEPTED",
  "RESOLVED_PARTIAL",
  "RESOLVED_REJECTED",
  "RESOLVED_REPLACED",
] as const;
