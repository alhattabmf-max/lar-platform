"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { claimKey, releaseKey } from "@/lib/idempotency-store";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";

/**
 * Starts a payment attempt for one checkout session.
 *
 * A client component because the API's CSRF guard requires a browser
 * `Origin` header on state-changing requests, and the session cookie
 * rides along with `credentials: "include"`. A server-side POST would
 * have to synthesise both.
 *
 * THE IDEMPOTENCY KEY — the second of the two keys in this flow.
 *
 * It is INDEPENDENT of the key that created the checkout session.
 * Those are two operations against two server-side scopes,
 * `TRADER_CHECKOUT_CREATE:<company>` and
 * `PAYMENT_ATTEMPT_START:<company>:<session>`, each with its own
 * request fingerprint. One key across both would make a replay of one
 * look like the other.
 *
 * It is held in `sessionStorage`, namespaced by this checkout session —
 * NOT in a `useRef`. A ref survives a re-render, which covers a double
 * click, but it dies with the component: someone whose request stalled,
 * who reloads and presses again, would arrive with a fresh key, and to
 * the server that is a NEW payment. Reload-survival is exactly what
 * this operation needs, so the key outlives the mount.
 *
 * Its lifecycle:
 *
 *  - network unknown → the SAME key is kept. The request may have
 *    reached the server; a retry has to be recognisable as one.
 *  - definitive failure + an explicit "try again" → the key is
 *    released, so the retry is a NEW operation. Reusing it would
 *    replay the stored refusal forever.
 *  - success → released, then we navigate. Nothing is left that could
 *    replay a response about a payment already under way.
 *
 * The session's own state is the outer guard: the server starts an
 * attempt only from `LOCKED`, so a second POST meets a session in
 * `PAYMENT_PENDING` and is refused. The key guards one operation's
 * retries; the status guards everything beyond that.
 */
export interface StartPaymentButtonProps {
  checkoutSessionId: string;
  locale: string;
  label: string;
  submittingLabel: string;
  retryLabel: string;
  errorTitle: string;
  requestIdLabel: string;
}

/**
 * Failures after which retrying with the SAME key is pointless.
 *
 * The server has answered definitively, and its answer is stored
 * against the key — replaying it would return the same refusal. A
 * `network` failure is deliberately absent: that is precisely the
 * unknown outcome the key exists for.
 */
function isTerminalFailure(error: UserFacingError): boolean {
  return (
    error.kind === "conflict" ||
    error.kind === "validation" ||
    error.kind === "forbidden" ||
    error.kind === "notFound"
  );
}

export function StartPaymentButton({
  checkoutSessionId,
  locale,
  label,
  submittingLabel,
  retryLabel,
  errorTitle,
  requestIdLabel,
}: StartPaymentButtonProps) {
  const router = useRouter();

  // The message catalogue at its root, so a `messageKey` from
  // `toUserFacingError` resolves directly. A translate FUNCTION cannot
  // cross the server/client boundary, which is why the labels this
  // component receives are plain strings.
  const root = useTranslations();

  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [terminal, setTerminal] = useState(false);

  async function start() {
    if (submitting) return;

    setSubmitting(true);
    setFailure(null);

    // Claimed at the moment of use, not at mount: a component that
    // renders without ever being pressed should leave nothing behind.
    // After a reload this returns the key the previous mount stored.
    const key = claimKey("payment-attempt", checkoutSessionId);

    try {
      // The response carries the attempt id, its status and the amount.
      // None of it is rendered here: the payment page reads the session
      // itself, so there is one authority on what state this is in.
      await apiClient.post(
        `/trader/checkout-sessions/${checkoutSessionId}/payment-attempts`,
        {},
        { idempotencyKey: key }
      );

      // Succeeded. Nothing is left that a stale replay could return.
      releaseKey("payment-attempt", checkoutSessionId);

      router.push(`/${locale}/trader/payment/${checkoutSessionId}`);
      // Deliberately left submitting: the navigation is in flight, and
      // re-enabling the button would invite a second attempt against a
      // session that has already moved on.
    } catch (error) {
      const userFacing = toUserFacingError(error);
      setFailure(userFacing);
      setTerminal(isTerminalFailure(userFacing));
      setSubmitting(false);
    }
  }

  /**
   * An explicit retry after a definitive refusal.
   *
   * Releasing first is what makes this a NEW operation rather than a
   * replay of the stored refusal. It is on a deliberate press, never
   * automatic: a definitive failure that retries itself is a loop.
   */
  function retryAfterTerminalFailure() {
    releaseKey("payment-attempt", checkoutSessionId);
    setTerminal(false);
    setFailure(null);
    void start();
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        onClick={terminal ? retryAfterTerminalFailure : start}
        isLoading={submitting}
        disabled={submitting}
      >
        {submitting ? submittingLabel : terminal ? retryLabel : label}
      </Button>

      {failure ? (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-danger-text">{errorTitle}</p>
          {/* The translated message for a KNOWN code, never the API's
              own text — that is an English developer string that can
              carry internal detail. */}
          <p className="text-content">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-content-muted">
              {requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
