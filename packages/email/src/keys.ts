/**
 * The two idempotency keys of the email channel.
 *
 * They protect different things and are easy to confuse, so both are
 * built here and neither is ever assembled by hand at a call site:
 *
 *   CREATION  `email:v1:${notificationId}:${recipientUserId}`
 *             Written to `outbox_events.idempotency_key`, where the
 *             existing partial unique index rejects a second row for
 *             the same (notification, recipient). Enforced by the
 *             DATABASE, not by application logic — which is the only
 *             thing that holds when two transactions race.
 *
 *   DELIVERY  `outbox:${outboxEventId}`
 *             Handed to the provider on every attempt at that row,
 *             unchanged across retries. If the process dies after the
 *             provider accepted but before settlement commits, the
 *             re-sent message carries the same key and a provider that
 *             honours idempotency keys collapses the duplicate.
 *
 * The delivery key is derived from the OUTBOX ROW id, not from the
 * notification: one notification can legitimately produce a row per
 * recipient, and keying delivery on the notification would make a
 * provider suppress every recipient after the first.
 */

export const CREATION_KEY_PREFIX = "email:v1";
export const DELIVERY_KEY_PREFIX = "outbox";

function assertIdentifier(value: string, field: string): void {
  if (value.length === 0) {
    throw new Error(`${field} must not be empty when building an email idempotency key`);
  }
  // A colon would make the composed key ambiguous — two different pairs
  // could produce one string and the unique index would then reject a
  // legitimate row.
  if (value.includes(":")) {
    throw new Error(`${field} must not contain ":" — it is the key separator`);
  }
}

/** For `outbox_events.idempotency_key` at creation time. */
export function buildCreationIdempotencyKey(
  notificationId: string,
  recipientUserId: string
): string {
  assertIdentifier(notificationId, "notificationId");
  assertIdentifier(recipientUserId, "recipientUserId");
  return `${CREATION_KEY_PREFIX}:${notificationId}:${recipientUserId}`;
}

/** For the provider, stable across every attempt at one outbox row. */
export function buildProviderDeliveryKey(outboxEventId: string): string {
  assertIdentifier(outboxEventId, "outboxEventId");
  return `${DELIVERY_KEY_PREFIX}:${outboxEventId}`;
}
