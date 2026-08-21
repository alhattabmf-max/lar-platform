import { z } from "zod";
import {
  EMAIL_PARAM_KEYS,
  EMAIL_TEMPLATE_IDS,
  TEMPLATE_PARAM_KEYS,
  type EmailParamKey,
  type EmailTemplateId,
} from "./templates";

/**
 * The `EMAIL_NOTIFICATION_V1` outbox payload.
 *
 * CLOSED by construction: `.strict()` rejects any key not declared
 * here, `v` must equal 1, `template` must be a known id, and `params`
 * must contain only the keys that specific template accepts.
 *
 * There is deliberately **no email address in the payload**. The relay
 * resolves `users.email` from `recipientUserId` at send time, so the
 * outbox row carries no PII and the right to erasure works naturally —
 * delete the user and there is no address left to send to.
 *
 * No HTML, no rendered text, and no counterparty-sensitive amounts.
 *
 * This is an INTERNAL channel contract between the outbox producer and
 * the relay. It is not an HTTP or UI wire contract, which is why it
 * lives here and not in `@platform/types`.
 */

const UUID = z.string().uuid();

/** Scalars only — an object or array here would be a structured leak. */
const paramValue = z.union([z.string(), z.number()]);

const paramsShape = Object.fromEntries(
  EMAIL_PARAM_KEYS.map((key) => [key, paramValue.optional()])
) as Record<EmailParamKey, z.ZodOptional<typeof paramValue>>;

const payloadSchema = z
  .object({
    v: z.literal(1),
    notificationId: UUID,
    recipientUserId: UUID,
    template: z.enum(EMAIL_TEMPLATE_IDS),
    params: z.object(paramsShape).strict(),
  })
  .strict();

export type EmailNotificationV1 = z.infer<typeof payloadSchema>;

export const EMAIL_NOTIFICATION_V1 = "EMAIL_NOTIFICATION_V1";

/**
 * The ONLY event type the relay will ever claim.
 *
 * A code constant, not a setting. A configurable watermark
 * (`created_at >= relayEnabledAt`) was rejected precisely because one
 * deployment mistake would cause a retroactive send of every historical
 * row; a constant cannot be misconfigured in production, and adding
 * `EMAIL_NOTIFICATION_V2` later is a reviewed code change.
 *
 * Every other event type in the table — and at the 8D0 baseline there
 * are at least thirty distinct literals plus several constructed at
 * runtime — is invisible to the relay: never read, never locked, never
 * updated.
 */
export const RELAY_SUPPORTED_EVENT_TYPES = [EMAIL_NOTIFICATION_V1] as const;

export type PayloadValidationResult =
  | { ok: true; payload: EmailNotificationV1 }
  | { ok: false };

/**
 * Validates an outbox payload.
 *
 * Returns a bare `{ ok: false }` on failure — carrying no message, no
 * offending key and no value. A validation message from a schema
 * library routinely echoes the data it rejected, and this result is
 * about to be logged and written to `error_class`. The caller records
 * `PAYLOAD_INVALID` and the outbox event id, and nothing else.
 *
 * An invalid payload is NOT retryable: another attempt cannot repair
 * malformed data, so the row goes straight to `FAILED`.
 */
export function validateEmailNotificationV1(input: unknown): PayloadValidationResult {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  // The per-template whitelist is a second, narrower gate: the schema
  // above accepts the union of all permitted keys, this rejects those
  // the specific template has no place for.
  const allowed = TEMPLATE_PARAM_KEYS[parsed.data.template as EmailTemplateId];
  for (const key of Object.keys(parsed.data.params)) {
    if (!(allowed as readonly string[]).includes(key)) return { ok: false };
  }

  return { ok: true, payload: parsed.data };
}
