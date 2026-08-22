import {
  NOTIFICATION_PARAM_KEYS,
  NOTIFICATION_TYPE_PARAM_KEYS,
  type NotificationParams,
  type NotificationType,
} from "@platform/types";

/**
 * Validation of notification `params` — ON WRITE, always.
 *
 * Reading is too late: once a value is in the row it is in backups, in
 * replicas, and in whatever exported it. So the gate is here, and there
 * is deliberately no sanitising step on the read path that might create
 * the impression the write path can be relaxed.
 *
 * Two gates, not one:
 *   1. the global vocabulary — only the six scalar keys exist at all;
 *   2. the PER-TYPE whitelist — a `disputeId` on a settlement is
 *      malformed even though `disputeId` is a legal key somewhere else.
 *
 * A single global list would accept that second case and render a
 * message that silently drops the field.
 */

export class InvalidNotificationParamsError extends Error {
  readonly reason: "UNKNOWN_KEY" | "NOT_ALLOWED_FOR_TYPE" | "NON_SCALAR" | "NOT_AN_OBJECT";

  constructor(reason: InvalidNotificationParamsError["reason"]) {
    // The reason CODE, never the offending key or its value: this error
    // is about to be logged, and echoing the data would put it there.
    super(reason);
    this.name = "InvalidNotificationParamsError";
    this.reason = reason;
  }
}

function isScalar(value: unknown): value is string | number {
  return (typeof value === "string" || typeof value === "number") && Number.isFinite(Number(value)) !== false;
}

/**
 * Returns the params unchanged, or throws.
 *
 * Deliberately does NOT strip offending keys and continue. Silently
 * dropping a field a caller meant to send hides a producer bug until
 * someone notices a message missing an order number; failing the write
 * surfaces it in 8D.2 where it can be fixed.
 */
export function assertValidNotificationParams(
  type: NotificationType,
  params: unknown
): NotificationParams {
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    throw new InvalidNotificationParamsError("NOT_AN_OBJECT");
  }

  const allowed = NOTIFICATION_TYPE_PARAM_KEYS[type];

  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined) continue;

    if (!(NOTIFICATION_PARAM_KEYS as readonly string[]).includes(key)) {
      throw new InvalidNotificationParamsError("UNKNOWN_KEY");
    }
    if (!(allowed as readonly string[]).includes(key)) {
      throw new InvalidNotificationParamsError("NOT_ALLOWED_FOR_TYPE");
    }
    // Objects, arrays, booleans and null are all rejected: a structured
    // value is how nested data — and eventually free text — gets in.
    if (typeof value !== "string" && typeof value !== "number") {
      throw new InvalidNotificationParamsError("NON_SCALAR");
    }
  }

  return params as NotificationParams;
}

/** True when the params satisfy both gates. Never throws. */
export function isValidNotificationParams(type: NotificationType, params: unknown): boolean {
  try {
    assertValidNotificationParams(type, params);
    return true;
  } catch {
    return false;
  }
}

export { isScalar };
