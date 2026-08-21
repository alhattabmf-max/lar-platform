/**
 * The email provider contract.
 *
 * Framework-free on purpose: this package is imported by `apps/worker`,
 * which is plain Node + BullMQ and has no NestJS and no path into
 * `apps/api`. The API binds the same interface to its DI container in a
 * thin adapter; there is exactly one implementation of the sending
 * behaviour and both processes share it.
 */

/**
 * Modes a provider can report.
 *
 * Only `mock` exists today, matching `EMAIL_PROVIDER_MODE` in
 * `@platform/config`. It is a union rather than a bare string so adding
 * a real provider is a typed change that forces every switch on it to
 * be revisited.
 */
export const EMAIL_PROVIDER_MODES = ["mock"] as const;
export type EmailProviderMode = (typeof EMAIL_PROVIDER_MODES)[number];

export interface SendEmailCommand {
  /** Resolved by the caller. Never read from the outbox payload, which holds no address. */
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  /**
   * Stable per-message key, supplied by the caller and never invented
   * by the provider.
   *
   * The relay always passes `outbox:${outboxEventId}` — the SAME value
   * on every retry of the same row, which is what lets a provider that
   * honours idempotency keys collapse a duplicate send after a crash.
   * Optional because direct transactional sends (email verification,
   * password reset) have no outbox row and therefore no stable key; for
   * those, a duplicate is a resend the user asked for.
   */
  idempotencyKey?: string;
  /**
   * Cancels an in-flight send.
   *
   * The relay passes a signal wired to a hard timeout well below the
   * claim lease. An implementation must actually honour it — a promise
   * that merely loses a race leaves the request running and the
   * connection held, which is the failure this parameter exists to
   * prevent.
   */
  signal?: AbortSignal;
}

/**
 * Retained as the historical name for the command shape.
 *
 * Pre-8D0 callers (`AuthService`) and their test doubles were written
 * against `SendEmailParams`; keeping the alias means adding
 * `idempotencyKey` and `signal` did not force an unrelated rename
 * across the auth flows.
 */
export type SendEmailParams = SendEmailCommand;

export interface EmailProvider {
  /**
   * What this provider actually is.
   *
   * Read from the provider itself rather than from configuration, so a
   * log line cannot claim one mode while another object does the
   * sending. Every relay log carries it, because with `mock` a
   * successfully "sent" message is a log line and nothing more.
   */
  readonly mode: EmailProviderMode;

  /** Resolves on acceptance by the provider. Rejects with a classified error otherwise. */
  sendEmail(command: SendEmailCommand): Promise<void>;
}

/**
 * True when the configured provider does not deliver anything.
 *
 * Exposed so callers state it explicitly instead of re-deriving the
 * comparison — and so the meaning of a "published" email event is
 * always reported alongside whether delivery was simulated.
 */
export function isSimulatedDelivery(mode: EmailProviderMode): boolean {
  return mode === "mock";
}
