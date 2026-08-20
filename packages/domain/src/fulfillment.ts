export type OrderAllocationStatus = "AWAITING_PREPARATION" | "PREPARING" | "READY_TO_SHIP" | "SHIPPED" | "DELIVERED";

const ALLOWED_TRANSITIONS: Record<OrderAllocationStatus, OrderAllocationStatus[]> = {
  AWAITING_PREPARATION: ["PREPARING"],
  PREPARING: ["READY_TO_SHIP"],
  READY_TO_SHIP: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
};

export function isValidOrderAllocationTransition(from: OrderAllocationStatus, to: OrderAllocationStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export type FulfillmentDelayClass = "ON_TIME" | "LATE" | "CRITICAL";

/**
 * Always anchored to paidAt — a supplier starting preparation late
 * never resets the clock. referenceTime is deliveredAt when known,
 * otherwise "now".
 */
export function classifyFulfillmentDelay(input: {
  paidAt: Date;
  preparationDueAt: Date;
  referenceTime: Date;
  lateThresholdPercent: number;
  criticalThresholdPercent: number;
}): FulfillmentDelayClass {
  const totalWindowMs = input.preparationDueAt.getTime() - input.paidAt.getTime();
  const elapsedMs = input.referenceTime.getTime() - input.paidAt.getTime();
  const elapsedRatio = totalWindowMs > 0 ? (elapsedMs / totalWindowMs) * 100 : 100;

  if (elapsedRatio <= input.lateThresholdPercent) return "ON_TIME";
  if (elapsedRatio <= input.criticalThresholdPercent) return "LATE";
  return "CRITICAL";
}
