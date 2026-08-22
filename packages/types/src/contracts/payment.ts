/**
 * Payment attempt contracts.
 *
 * FIELD → SOURCE mapping:
 *
 *   id        payment_attempts.id
 *   status    payment_attempts.status, narrowed to what a start can return
 *   amount    quote_snapshots.grand_total_amount (Decimal(14,2))
 *   currency  quote_snapshots.currency
 *
 * Four fields, and that is the whole contract. Everything else on the
 * row is provider or internal machinery — `providerCode`,
 * `providerReference`, `idempotencyKey`, `policyAcceptanceId`,
 * `acceptedByUserId`, the raw webhook payload — and none of it means
 * anything to a trader while all of it is useful to an attacker
 * probing how the integration works.
 */

/**
 * What `POST /trader/checkout-sessions/:id/payment-attempts` can
 * answer with.
 *
 * A closed list of three, deliberately narrower than the full
 * `PaymentAttemptStatus` enum. `SUCCEEDED` is NOT here: a capture is
 * confirmed by the provider's webhook, never by the response to the
 * request that started the attempt, and offering the status here would
 * invite a client to treat its own POST as proof of payment.
 *
 *   CREATED  the attempt exists; the provider has not confirmed an
 *            intent yet, or answered with a retryable unknown
 *   PENDING  the provider accepted the intent and will call back
 *   FAILED   the provider refused definitively; the checkout session
 *            has been returned to LOCKED or EXPIRED
 */
export const PAYMENT_ATTEMPT_START_STATUSES = ["CREATED", "PENDING", "FAILED"] as const;
export type PaymentAttemptStartStatus = (typeof PAYMENT_ATTEMPT_START_STATUSES)[number];

export interface PaymentAttemptView {
  id: string;
  status: PaymentAttemptStartStatus;
  /**
   * The amount that will be charged, as a fixed-scale DECIMAL STRING.
   *
   * Taken from the frozen quote, never recomputed — this is the same
   * figure `CheckoutSessionView.grandTotalAmount` carries, and the two
   * must be byte-identical or one screen contradicts the other.
   */
  amount: string;
  currency: string;
}

export const PAYMENT_ATTEMPT_VIEW_KEYS = [
  "id",
  "status",
  "amount",
  "currency",
] as const satisfies readonly (keyof PaymentAttemptView)[];
