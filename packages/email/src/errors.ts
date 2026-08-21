/**
 * Failure classification for the email channel.
 *
 * The single rule that shapes this whole module: a class is derived
 * from an exception's TYPE and its HTTP STATUS CODE, and never from
 * `error.message`. Provider exception text routinely echoes the
 * recipient address, the subject, or a fragment of the request body —
 * reading it to decide a category is precisely how that text ends up in
 * a log line or a database column.
 *
 * A source-level test asserts this file contains no `.message` read.
 */

export const EMAIL_ERROR_CLASSES = [
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_5XX",
  "PROVIDER_REJECTED_RECIPIENT",
  "TEMPLATE_RENDER_FAILED",
  "RECIPIENT_NOT_FOUND",
  "RECIPIENT_INACTIVE",
  "PAYLOAD_INVALID",
  "ATTEMPTS_EXHAUSTED",
  "UNKNOWN",
] as const;

export type EmailErrorClass = (typeof EMAIL_ERROR_CLASSES)[number];

/**
 * Classes worth another attempt.
 *
 * Everything absent from this set is terminal — retrying a malformed
 * payload, a template that cannot render, or a recipient the provider
 * refuses cannot succeed later, so burning attempts on it only delays
 * the dead-letter.
 *
 * `ATTEMPTS_EXHAUSTED` is deliberately terminal: it is the class
 * recorded when the attempt budget itself ran out, so treating it as
 * retryable would be a loop.
 */
const RETRYABLE: ReadonlySet<EmailErrorClass> = new Set<EmailErrorClass>([
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_5XX",
  "UNKNOWN",
]);

export function isRetryable(errorClass: EmailErrorClass): boolean {
  return RETRYABLE.has(errorClass);
}

export function isTerminal(errorClass: EmailErrorClass): boolean {
  return !RETRYABLE.has(errorClass);
}

/**
 * The error a provider adapter raises.
 *
 * It carries its classification as DATA rather than leaving the caller
 * to infer one. `cause` is retained for a debugger to inspect in
 * process, but nothing in the relay serialises it.
 */
export class EmailDeliveryError extends Error {
  readonly errorClass: EmailErrorClass;

  constructor(errorClass: EmailErrorClass, options?: { cause?: unknown }) {
    // The message is the CLASS name, never provider text — so even a
    // careless `String(err)` somewhere downstream cannot leak content.
    super(errorClass);
    this.name = "EmailDeliveryError";
    this.errorClass = errorClass;
    if (options && "cause" in options) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** An abort raised by our own timeout, distinguishable from a provider fault. */
export class EmailAbortedError extends Error {
  constructor() {
    super("PROVIDER_TIMEOUT");
    this.name = "EmailAbortedError";
  }
}

function statusCodeOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as Record<string, unknown>;
  for (const key of ["statusCode", "status", "httpStatus"]) {
    const value = candidate[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function nameOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const name = (error as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

/**
 * Maps anything thrown during a send onto the closed set.
 *
 * Order matters: an error that already declares its class wins, then an
 * abort, then the HTTP status code. Anything unrecognised is `UNKNOWN`,
 * which is retryable — an unclassified fault is more likely a transient
 * one than a permanent rejection, and the attempt budget bounds the
 * cost of being wrong.
 */
export function classifyEmailFailure(error: unknown): EmailErrorClass {
  if (error instanceof EmailDeliveryError) return error.errorClass;
  if (error instanceof EmailAbortedError) return "PROVIDER_TIMEOUT";

  const name = nameOf(error);
  // `AbortSignal.timeout()` and `AbortController.abort()` both surface
  // as an AbortError DOMException.
  if (name === "AbortError" || name === "TimeoutError") return "PROVIDER_TIMEOUT";

  const status = statusCodeOf(error);
  if (status !== null) {
    if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
    if (status === 429) return "PROVIDER_RATE_LIMITED";
    if (status >= 500) return "PROVIDER_5XX";
    // A 4xx that is not rate limiting is the provider refusing this
    // specific recipient or message. Retrying it repeats the refusal.
    if (status >= 400) return "PROVIDER_REJECTED_RECIPIENT";
  }

  return "UNKNOWN";
}
