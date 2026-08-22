import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { CheckoutSessionView } from "@platform/types";
import {
  MAX_POLL_ATTEMPTS,
  MAX_POLL_MS,
  POLL_INTERVAL_MS,
  PaymentStatusPoller,
  isPollTerminalStatus,
} from "@/components/checkout/payment-status-poller";
import { apiClient } from "@/lib/api-client";
import { claimKey, hasKey, releaseKey } from "@/lib/idempotency-store";
import { CHECKOUT_SESSION_STATUSES } from "@platform/types";

/**
 * The waiting screen, driven by fake timers.
 *
 * These are the assertions that cannot be made by reading the source:
 * that the polling is actually bounded, that two requests are never in
 * flight at once, that a hidden tab stops consuming the budget, and
 * that unmounting really does stop everything. Each describes a way a
 * poller becomes a problem in production rather than in review.
 */

const SESSION = "22222222-2222-2222-2222-222222222222";
const ORDER = "33333333-3333-3333-3333-333333333333";

const refresh = vi.fn();
const push = vi.fn();
// ONE object for the whole file. Next's useRouter returns a stable
// reference; a fresh object per render would change the effect's
// dependencies and restart the poller on every re-render — an artefact
// of the mock rather than of the component.
const router = { refresh, push };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function view(overrides: Partial<CheckoutSessionView> = {}): CheckoutSessionView {
  return {
    id: SESSION,
    opportunityId: "55555555-5555-5555-5555-555555555555",
    status: "PAYMENT_PENDING",
    quantity: 8,
    shareQuantity: 4,
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    currency: "SAR",
    unitPriceInclTaxAmount: "115.00",
    productsSubtotalExclTaxAmount: "800.00",
    productsTaxAmount: "120.00",
    productsSubtotalInclTaxAmount: "920.00",
    totalShippingFeeAmount: "75.50",
    grandTotalAmount: "995.50",
    lockExpiresAt: "2026-08-21T12:00:00.000Z",
    paymentDeadlineAt: "2026-08-21T12:30:00.000Z",
    allocations: [],
    masterOrderId: null,
    ...overrides,
  } as CheckoutSessionView;
}

const LABELS = {
  waitingLabel: "Checking…",
  stoppedLabel: "Stopped checking",
  recheckLabel: "Check now",
  contractErrorLabel: "Inconsistent response",
};

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the api-client
   spy is driven with hand-written resolutions; restating its generic
   signature here would test the type, not the behaviour. */
let get: any;

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  setVisibility("visible");
  window.sessionStorage.clear();
  get = vi.spyOn(apiClient, "get");
});

afterEach(() => {
  cleanup();
  get.mockRestore();
  vi.useRealTimers();
});

/**
 * Advances the clock and lets every resolved promise settle.
 *
 * Wrapped in `act` because the poller sets state from an async
 * callback: without it the state updates happen but React has not
 * re-rendered by the time an assertion reads the DOM.
 */
async function tick(times = 1) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
  }
}

describe("the poller's actual constants", () => {
  it("polls every 3 seconds and gives up after 5 minutes", () => {
    expect(POLL_INTERVAL_MS).toBe(3_000);
    expect(MAX_POLL_MS).toBe(300_000);
  });

  it("bounds itself by a request COUNT derived from those two", () => {
    // Counted rather than clock-measured: a throttled background tab
    // gets fewer firings, and measuring wall time would stop it while
    // it had barely polled at all.
    expect(MAX_POLL_ATTEMPTS).toBe(100);
    expect(MAX_POLL_ATTEMPTS).toBe(Math.floor(MAX_POLL_MS / POLL_INTERVAL_MS));
  });
});

describe("polling is bounded", () => {
  it("stops after MAX_POLL_ATTEMPTS and says so", async () => {
    get.mockResolvedValue(view());

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);

    await tick(MAX_POLL_ATTEMPTS + 5);

    expect(get.mock.calls.length).toBe(MAX_POLL_ATTEMPTS);
    expect(screen.getByText(LABELS.stoppedLabel)).toBeTruthy();
    expect(screen.getByRole("button", { name: LABELS.recheckLabel })).toBeTruthy();
  });

  it("never starts at all for a session that is already terminal", async () => {
    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAID" {...LABELS} />);

    await tick(5);

    expect(get).not.toHaveBeenCalled();
  });
});

describe("only one request is ever in flight", () => {
  it("does not stack a second request while the first is pending", async () => {
    // A slow response plus a fired timer is how a poller turns a server
    // hiccup into an outage.
    let release: ((v: CheckoutSessionView) => void) | undefined;
    get.mockImplementation(
      () =>
        new Promise<CheckoutSessionView>((resolve) => {
          release = resolve;
        })
    );

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);

    await tick(6);
    expect(get).toHaveBeenCalledTimes(1);

    release?.(view());
    await vi.advanceTimersByTimeAsync(0);
    await tick(1);

    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("a hidden tab does not consume the budget", () => {
  it("issues no request while hidden, and resumes when visible", async () => {
    get.mockResolvedValue(view());
    setVisibility("hidden");

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);

    await tick(20);
    expect(get).not.toHaveBeenCalled();
    // The skipped checks must not count, or a tab hidden for five
    // minutes would come back already given up.
    expect(screen.getByText(LABELS.waitingLabel)).toBeTruthy();

    setVisibility("visible");
    await tick(1);

    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("reaching a terminal status", () => {
  it.each(["PAID", "EXPIRED", "ABANDONED"] as const)("stops polling on %s", async (status) => {
    get.mockResolvedValue(
      view(status === "PAID" ? { status, masterOrderId: ORDER } : { status, masterOrderId: null })
    );

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);

    await tick(1);
    expect(get).toHaveBeenCalledTimes(1);

    await tick(5);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("hands PAID back to the server rather than routing itself", async () => {
    // The page owns where a paid session goes. Duplicating that
    // decision here is how the two come to disagree.
    get.mockResolvedValue(view({ status: "PAID", masterOrderId: ORDER }));

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);
    await tick(1);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("releases the payment-attempt key on PAID", async () => {
    claimKey("payment-attempt", SESSION);
    expect(hasKey("payment-attempt", SESSION)).toBe(true);

    get.mockResolvedValue(view({ status: "PAID", masterOrderId: ORDER }));

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);
    await tick(1);

    // Nothing left that a stale replay could return a response about.
    expect(hasKey("payment-attempt", SESSION)).toBe(false);
  });

  it("releases the key on EXPIRED too — there is nothing left to retry", async () => {
    claimKey("payment-attempt", SESSION);
    get.mockResolvedValue(view({ status: "EXPIRED", masterOrderId: null }));

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);
    await tick(1);

    expect(hasKey("payment-attempt", SESSION)).toBe(false);
  });
});

describe("a response that contradicts its own contract", () => {
  it("stops and reports, rather than navigating to /orders/null", async () => {
    // The union guarantees PAID carries an order id. This pair cannot
    // come from the write path, which commits both together — so seeing
    // it means something is broken, and the honest move is to say so.
    // Deliberately impossible under the contract, which is the point:
    // the union has no PAID-with-null variant, so constructing one takes
    // a cast through unknown.
    get.mockResolvedValue({
      ...view(),
      status: "PAID",
      masterOrderId: null,
    } as unknown as CheckoutSessionView);

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);

    await tick(1);
    expect(screen.getByRole("alert").textContent).toContain(LABELS.contractErrorLabel);

    await tick(5);
    expect(get).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("a failed poll is not a failed payment", () => {
  it("keeps waiting after a network error", async () => {
    // The capture is decided by the webhook, not by whether this
    // request succeeded.
    get.mockRejectedValueOnce(new Error("network")).mockResolvedValue(view());

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);

    await tick(2);

    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.getByText(LABELS.waitingLabel)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("unmounting stops everything", () => {
  it("fires no further request and aborts the one in flight", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    get.mockImplementation((...args: unknown[]) => {
      const options = args[1] as { signal?: AbortSignal } | undefined;
      signals.push(options?.signal);
      return new Promise<CheckoutSessionView>(() => {});
    });

    const { unmount } = render(
      <PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />
    );

    await tick(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);

    unmount();

    // Without the abort, an unmounted component's response still
    // resolves and still runs its handlers.
    expect(signals[0]?.aborted).toBe(true);

    await tick(10);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe("the poller never writes", () => {
  it("issues no POST at any point", async () => {
    const post = vi.spyOn(apiClient, "post");
    get.mockResolvedValue(view());

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);
    await tick(10);

    expect(post).not.toHaveBeenCalled();
    post.mockRestore();
  });
});

describe("releaseKey is safe to call when nothing is stored", () => {
  it("does not throw", () => {
    expect(() => releaseKey("payment-attempt", SESSION)).not.toThrow();
  });
});

describe("a failed attempt puts the session back to LOCKED", () => {
  /**
   * The real failure path, from the code:
   *
   *   `PaymentAttemptService.markAttemptFailedAndRestoreCheckout` and
   *   `PaymentWebhookService.handleFailureEvent` both mark the attempt
   *   FAILED and then — if `lock_expires_at` is still in the future —
   *   set the session back to `status = 'LOCKED', payment_deadline_at
   *   = NULL`. If the lock HAS expired, both set `EXPIRED` instead.
   *
   * `LOCKED` is not terminal for the session: the trader can pay
   * again. It IS terminal for the attempt this screen is waiting on,
   * and treating it as "keep waiting" would poll a hundred times over
   * five minutes for a change that already happened.
   */

  it("counts LOCKED as terminal for the WAIT, though not for the session", () => {
    expect(isPollTerminalStatus("LOCKED")).toBe(true);
    expect(isPollTerminalStatus("PAYMENT_PENDING")).toBe(false);

    // A superset of the contract's terminal set, not a replacement for
    // it: PAID, EXPIRED and ABANDONED still end the wait.
    for (const status of CHECKOUT_SESSION_STATUSES) {
      expect([status, isPollTerminalStatus(status)]).toEqual([
        status,
        status !== "PAYMENT_PENDING",
      ]);
    }
  });

  it("stops polling immediately and issues no further request", async () => {
    get.mockResolvedValue(view({ status: "LOCKED", masterOrderId: null }));

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);

    await tick(1);
    expect(get).toHaveBeenCalledTimes(1);

    // Not 100 attempts over five minutes for an answer already known.
    await tick(MAX_POLL_ATTEMPTS + 5);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("aborts the request in flight rather than waiting for unmount", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    get.mockImplementation((...args: unknown[]) => {
      const options = args[1] as { signal?: AbortSignal } | undefined;
      signals.push(options?.signal);
      return Promise.resolve(view({ status: "LOCKED", masterOrderId: null }));
    });

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);
    await tick(1);

    expect(signals[0]?.aborted).toBe(true);
  });

  it("refreshes, so the server routes back to the retry path", async () => {
    // The payment page sends a LOCKED session to
    // /trader/checkout/[id], where a new payment can be started. The
    // poller does not route: duplicating that decision is how the two
    // come to disagree.
    get.mockResolvedValue(view({ status: "LOCKED", masterOrderId: null }));

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);
    await tick(1);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("releases the key, so the next payment is a NEW attempt", async () => {
    // The server's scope is (company, session) and its request hash is
    // over the session id alone. Reusing the stored key would replay
    // the dead attempt's response instead of starting a real one, and
    // send the trader straight back to this screen to wait on an
    // attempt that already failed.
    const original = claimKey("payment-attempt", SESSION);
    expect(hasKey("payment-attempt", SESSION)).toBe(true);

    get.mockResolvedValue(view({ status: "LOCKED", masterOrderId: null }));

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);
    await tick(1);

    expect(hasKey("payment-attempt", SESSION)).toBe(false);
    expect(claimKey("payment-attempt", SESSION)).not.toBe(original);
  });

  it("releases ONLY after the status is actually observed", async () => {
    // Never optimistically on a failed request: a poll that could not
    // reach the server says nothing about the attempt.
    claimKey("payment-attempt", SESSION);
    get.mockRejectedValue(new Error("network"));

    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="PAYMENT_PENDING" {...LABELS} />);
    await tick(3);

    expect(hasKey("payment-attempt", SESSION)).toBe(true);
  });

  it("never starts polling when the server already rendered LOCKED", async () => {
    render(<PaymentStatusPoller checkoutSessionId={SESSION} initialStatus="LOCKED" {...LABELS} />);

    await tick(5);

    expect(get).not.toHaveBeenCalled();
  });
});
