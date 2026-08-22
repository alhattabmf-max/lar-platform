"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  isTerminalCheckoutStatus,
  type CheckoutSessionStatus,
  type CheckoutSessionView,
} from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { releaseKey } from "@/lib/idempotency-store";

/**
 * Waits for the capture to land, then hands the page back to the
 * server to decide what that means.
 *
 * The trader's browser is NOT what completes a payment. The provider
 * calls the webhook, and that request marks the session PAID and
 * creates the MasterOrder on one transaction client. This component's
 * only job is to notice, so nobody sits on a page that will never
 * change by itself.
 *
 * It POSTs nothing. Polling a read is safe to repeat; a poll that
 * retried a write would create a payment every few seconds.
 *
 * Why poll rather than refresh the whole route on a timer: a route
 * refresh re-renders the page and disturbs focus and scroll position
 * repeatedly while someone reads it. This asks one small question and
 * refreshes only when the answer has actually changed.
 */

/**
 * Between polls, in milliseconds.
 *
 * A capture arrives via a webhook the browser cannot observe, so this
 * is a guess at "soon enough to feel immediate". Three seconds is
 * about the limit of feeling instant without turning one waiting user
 * into twenty requests a minute.
 */
export const POLL_INTERVAL_MS = 3_000;

/**
 * When to stop asking, in milliseconds.
 *
 * Five minutes, which is the same order as the payment deadline the
 * server sets on the attempt. Reaching it is NOT a failed payment: the
 * capture may still arrive by webhook. It only means automatic checking
 * has stopped, and the reader is offered a manual re-check — polling
 * forever would leave a forgotten tab requesting all night.
 */
export const MAX_POLL_MS = 5 * 60 * 1_000;

/** The most polls this can ever issue: the timeout divided by the interval. */
export const MAX_POLL_ATTEMPTS = Math.floor(MAX_POLL_MS / POLL_INTERVAL_MS);

/**
 * Statuses that end the wait: `PAID`, `EXPIRED`, `ABANDONED`.
 *
 * Imported rather than restated, so a status added to the contract
 * cannot be terminal for the server and non-terminal here — which
 * would leave someone waiting on a session that had already finished.
 */
export { isTerminalCheckoutStatus };

/**
 * Statuses that end THIS wait — a strict superset of the contract's
 * terminal set, because `LOCKED` belongs here too.
 *
 * `LOCKED` is NOT terminal for the session: the lock is still valid
 * and the trader can pay again. It IS terminal for the attempt this
 * screen is waiting on. Both failure paths put it there —
 * `markAttemptFailedAndRestoreCheckout` after a definitive provider
 * refusal, and `handleFailureEvent` on a FAILURE webhook — each
 * marking the attempt FAILED and returning the session to `LOCKED`
 * while the lock has not expired. (If it HAS expired, both go to
 * `EXPIRED`, which the contract already calls terminal.)
 *
 * Without this, a session that came back to `LOCKED` would be polled
 * a hundred times over five minutes for a change that has already
 * happened, while the person sat watching "checking the payment
 * status…" for a payment that failed a minute ago.
 *
 * The poller only ever runs from `PAYMENT_PENDING` — the page
 * redirects a `LOCKED` session to checkout before rendering this — so
 * observing `LOCKED` here can only mean an attempt started and then
 * failed. That is what makes it safe to treat as a proven terminal
 * failure of the attempt.
 */
export function isPollTerminalStatus(status: CheckoutSessionStatus): boolean {
  return isTerminalCheckoutStatus(status) || status === "LOCKED";
}

export interface PaymentStatusPollerProps {
  checkoutSessionId: string;
  /** The status rendered on the server, so the first poll has a baseline. */
  initialStatus: CheckoutSessionStatus;
  waitingLabel: string;
  stoppedLabel: string;
  recheckLabel: string;
  contractErrorLabel: string;
}

export function PaymentStatusPoller({
  checkoutSessionId,
  initialStatus,
  waitingLabel,
  stoppedLabel,
  recheckLabel,
  contractErrorLabel,
}: PaymentStatusPollerProps) {
  const router = useRouter();

  const [stopped, setStopped] = useState(isPollTerminalStatus(initialStatus));
  const [contractError, setContractError] = useState(false);

  // Counted rather than clock-measured. A tab throttled in the
  // background gets fewer timer firings, and measuring elapsed wall
  // time would stop it while it had barely polled at all.
  const attempts = useRef(0);

  // Whether this wait has already concluded.
  //
  // In a REF, not state, because it has to survive the effect being
  // re-created. React re-runs an effect whenever a dependency's
  // identity changes, and a restart would otherwise reset the local
  // `cancelled` flag and issue another request against a session that
  // was already resolved.
  const finished = useRef(false);

  useEffect(() => {
    if (isPollTerminalStatus(initialStatus) || finished.current) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One request at a time, always. Without this, a slow response
    // followed by a fired timer would stack requests on a server that
    // is already slow — the classic way a poller turns a hiccup into an
    // outage.
    let inFlight = false;
    const controller = new AbortController();

    /**
     * Ends the wait immediately.
     *
     * Marks it finished, clears any pending timer and aborts anything
     * still in flight — rather than relying on the effect's cleanup,
     * which does not run until unmount or a dependency change. After a
     * terminal status the answer is already known; leaving a scheduled
     * timer or an open request would mean asking again for it.
     */
    function stopNow() {
      finished.current = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    }

    async function poll() {
      if (cancelled || inFlight) return;

      if (attempts.current >= MAX_POLL_ATTEMPTS) {
        stopNow();
        setStopped(true);
        return;
      }

      // A hidden tab does not poll. The capture is decided by the
      // webhook, so nothing is lost by waiting until someone is
      // actually looking — and a background tab left open for hours
      // must not keep the connection busy. The attempt is not counted
      // either: a skipped check should not consume the budget.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      inFlight = true;
      attempts.current += 1;

      try {
        const session = await apiClient.get<CheckoutSessionView>(
          `/trader/checkout-sessions/${checkoutSessionId}`,
          { signal: controller.signal }
        );
        if (cancelled) return;

        if (session.status === "PAID") {
          // The union guarantees an order id here. Seeing PAID with a
          // null one means the response contradicts its own contract —
          // stop, and say so, rather than navigating to
          // `/trader/orders/null` or waiting for a change that has
          // already happened.
          if (!session.masterOrderId) {
            stopNow();
            setContractError(true);
            setStopped(true);
            return;
          }

          // Paid: the operation is finished, so nothing should remain
          // that a stale replay could act on.
          stopNow();
          releaseKey("payment-attempt", checkoutSessionId);
          router.refresh();
          return;
        }

        if (isPollTerminalStatus(session.status)) {
          // Every remaining case is a proven terminal outcome for THIS
          // attempt:
          //
          //   LOCKED     the attempt failed and the lock survived. The
          //              key MUST go: the server's idempotency scope is
          //              (company, session) with a request hash over
          //              the session id alone, so a new payment reusing
          //              the stored key would replay the dead attempt's
          //              response instead of starting a real one — and
          //              the trader would be sent back to this screen
          //              to wait on an attempt that already failed.
          //   EXPIRED    the lock lapsed; nothing to retry against.
          //   ABANDONED  released deliberately.
          //
          // Released only here, after the status has actually been
          // observed — never optimistically on a failed request.
          stopNow();
          releaseKey("payment-attempt", checkoutSessionId);
          // The server re-renders and decides what to show: LOCKED goes
          // back to checkout, where a fresh payment can be started under
          // a new key. Routing from here as well would duplicate the
          // decision, and two copies of a decision eventually disagree.
          router.refresh();
          return;
        }
      } catch {
        // A failed poll is not a failed payment — the capture is
        // decided by the webhook, not by whether this request
        // succeeded. Keep waiting rather than reporting an error a
        // reader would reasonably take to mean "the payment broke".
      } finally {
        inFlight = false;
      }

      if (!cancelled && !finished.current) timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Aborts a request already in flight. Without it, an unmounted
      // component's response still resolves and still runs its
      // handlers.
      controller.abort();
    };
  }, [checkoutSessionId, initialStatus, router]);

  if (contractError) {
    return (
      <p role="alert" className="text-sm text-danger-text">
        {contractErrorLabel}
      </p>
    );
  }

  if (stopped) {
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="text-sm text-content-muted">
          {stoppedLabel}
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="self-start text-sm text-secondary hover:opacity-90"
        >
          {recheckLabel}
        </button>
      </div>
    );
  }

  return (
    <p role="status" aria-live="polite" className="text-sm text-content-muted">
      {waitingLabel}
    </p>
  );
}
