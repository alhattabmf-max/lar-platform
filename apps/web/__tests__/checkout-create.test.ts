import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckoutSessionView } from "@platform/types";
import {
  canonicalIntent,
  checkoutIntentFingerprint,
  createCheckoutSession,
  type CheckoutIntent,
} from "@/lib/checkout-create";
import { claimKey, hasKey } from "@/lib/idempotency-store";
import { apiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/errors";

/**
 * Creating a checkout session, idempotently, across a reload.
 *
 * The failure under test: the POST reaches the server, the session and
 * its quantity lock are created, and the response is lost. The person
 * submits again. Without a key that survives the reload they arrive
 * with a fresh one, the server reads a NEW operation, and a SECOND
 * session locks quantity twice — with both locks counting toward their
 * cooldown.
 */

const SESSION = "22222222-2222-2222-2222-222222222222";

const INTENT: CheckoutIntent = {
  opportunityId: "55555555-5555-5555-5555-555555555555",
  quantity: 8,
  allocations: [
    { companyLocationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", quantity: 4 },
    { companyLocationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantity: 4 },
  ],
};

function sessionView(): CheckoutSessionView {
  return {
    id: SESSION,
    opportunityId: INTENT.opportunityId,
    status: "LOCKED",
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
    paymentDeadlineAt: null,
    allocations: [],
    masterOrderId: null,
  };
}

function apiError(status: number, code = "VALIDATION_FAILED") {
  return new ApiError({
    kind:
      status === 409
        ? "conflict"
        : status === 400 || status === 422
          ? "validation"
          : status >= 500
            ? "server"
            : "unknown",
    status,
    code: code as never,
    requestId: "req-1",
    message: "failure",
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the api-client
   spy is driven with hand-written resolutions; restating its generic
   signature here would test the type, not the behaviour. */
let post: any;

/** The Idempotency-Key header sent on the nth request. */
const keyOnCall = (n: number): string => post.mock.calls[n][2].idempotencyKey;

beforeEach(() => {
  window.sessionStorage.clear();
  post = vi.spyOn(apiClient, "post");
});

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

/** The keys actually written, so tests read the same slot a reload would. */
const storedKeys = () => Object.keys(window.sessionStorage);

/**
 * Waits until `post` has been called `n` times.
 *
 * The request goes out only after `crypto.subtle.digest` resolves, so
 * asserting in the same turn as the call would always see zero — and a
 * fixed number of ticks is a guess about how many turns the digest
 * takes. Worse, a call left suspended at that await resumes during a
 * LATER test and writes its key into storage that has just been
 * cleared, which shows up as an unrelated failure somewhere else.
 */
async function awaitCalls(n: number) {
  await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(n));
}

describe("the fingerprint identifies the INTENT, not the request object", () => {
  it("matches the server's canonical form", async () => {
    // Must match `canonicalize()` in checkout-session.service.ts, which
    // hashes {opportunityId, quantity, allocations sorted by
    // companyLocationId} into request_hash. If the forms disagreed, a
    // retry listing branches differently would claim a different key
    // and create a second session.
    expect(canonicalIntent(INTENT)).toEqual({
      opportunityId: INTENT.opportunityId,
      quantity: 8,
      allocations: [
        { companyLocationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantity: 4 },
        { companyLocationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", quantity: 4 },
      ],
    });
  });

  it("is identical for reordered allocations — the same purchase", async () => {
    const reordered = { ...INTENT, allocations: [...INTENT.allocations].reverse() };

    expect(await checkoutIntentFingerprint(reordered)).toBe(
      await checkoutIntentFingerprint(INTENT)
    );
  });

  it("differs when the quantity changes", async () => {
    expect(await checkoutIntentFingerprint({ ...INTENT, quantity: 12 })).not.toBe(
      await checkoutIntentFingerprint(INTENT)
    );
  });

  it("differs when a branch changes", async () => {
    const moved = {
      ...INTENT,
      allocations: [
        { companyLocationId: "cccccccc-cccc-cccc-cccc-cccccccccccc", quantity: 4 },
        { companyLocationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantity: 4 },
      ],
    };

    expect(await checkoutIntentFingerprint(moved)).not.toBe(
      await checkoutIntentFingerprint(INTENT)
    );
  });

  it("differs when a branch's split changes but the total does not", async () => {
    // 6+2 and 4+4 both total 8, and they are different purchases.
    const resplit = {
      ...INTENT,
      allocations: [
        { companyLocationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantity: 6 },
        { companyLocationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", quantity: 2 },
      ],
    };

    expect(await checkoutIntentFingerprint(resplit)).not.toBe(
      await checkoutIntentFingerprint(INTENT)
    );
  });

  it("differs when the opportunity changes", async () => {
    expect(
      await checkoutIntentFingerprint({ ...INTENT, opportunityId: "66666666-6666-6666-6666-666666666666" })
    ).not.toBe(await checkoutIntentFingerprint(INTENT));
  });
});

describe("the key survives a reload", () => {
  it("reuses the stored key for the same intent after a remount", async () => {
    // A reload is a remount. The second call reads the slot the first
    // one wrote, so the server sees a retry rather than a new purchase.
    post.mockResolvedValue(sessionView());

    await createCheckoutSession(INTENT);
    const firstKey = keyOnCall(0);

    // Success clears it, so put it back to model the lost-response case
    // this exists for: the request left, the answer never arrived.
    const digest = await checkoutIntentFingerprint(INTENT);
    window.sessionStorage.setItem(`forsa.idem.checkout-create.${digest}`, firstKey);

    await createCheckoutSession(INTENT);

    expect(keyOnCall(1)).toBe(firstKey);
  });

  it("names the slot by fingerprint, so a changed intent gets a different key", async () => {
    post.mockRejectedValue(apiError(503));

    await expect(createCheckoutSession(INTENT)).rejects.toThrow();
    await expect(createCheckoutSession({ ...INTENT, quantity: 12 })).rejects.toThrow();

    const keys = post.mock.calls.map((_c: unknown, i: number) => keyOnCall(i));
    expect(keys[0]).not.toBe(keys[1]);
    expect(storedKeys()).toHaveLength(2);
  });

  it("reuses one key for a reordered retry of the same intent", async () => {
    post.mockRejectedValue(apiError(503));

    await expect(createCheckoutSession(INTENT)).rejects.toThrow();
    await expect(
      createCheckoutSession({ ...INTENT, allocations: [...INTENT.allocations].reverse() })
    ).rejects.toThrow();

    const keys = post.mock.calls.map((_c: unknown, i: number) => keyOnCall(i));
    expect(keys[0]).toBe(keys[1]);
    expect(storedKeys()).toHaveLength(1);
  });
});

describe("what the key's lifecycle does on each outcome", () => {
  it("clears on definitive success, once the session id is in hand", async () => {
    post.mockResolvedValue(sessionView());

    const session = await createCheckoutSession(INTENT);

    expect(session.id).toBe(SESSION);
    expect(storedKeys()).toHaveLength(0);
  });

  it("RETAINS on a network or unknown failure", async () => {
    // The request may have reached the server. The whole purpose of the
    // key is to make the retry recognisable as one.
    post.mockRejectedValue(new TypeError("fetch failed"));

    await expect(createCheckoutSession(INTENT)).rejects.toThrow();

    expect(storedKeys()).toHaveLength(1);
  });

  it("RETAINS on a 5xx", async () => {
    post.mockRejectedValue(apiError(503));

    await expect(createCheckoutSession(INTENT)).rejects.toThrow();

    expect(storedKeys()).toHaveLength(1);
  });

  it("RETAINS on a conflict", async () => {
    // This endpoint's conflict is "could not complete checkout under
    // concurrent load — please retry", which is retryable and must keep
    // the key. Releasing would turn that retry into a second session.
    post.mockRejectedValue(apiError(409, "CONFLICT"));

    await expect(createCheckoutSession(INTENT)).rejects.toThrow();

    expect(storedKeys()).toHaveLength(1);
  });

  it("CLEARS on a validation failure", async () => {
    // The server rejected the request itself and its transaction rolled
    // back, taking the idempotency row with it. There is nothing to
    // replay, and whatever the person does next is a new operation.
    post.mockRejectedValue(apiError(400));

    await expect(createCheckoutSession(INTENT)).rejects.toThrow();

    expect(storedKeys()).toHaveLength(0);
  });

  it("rethrows the failure unchanged, deciding only the key policy", async () => {
    const error = apiError(400);
    post.mockRejectedValue(error);

    await expect(createCheckoutSession(INTENT)).rejects.toBe(error);
  });
});

describe("a double submit makes ONE request", () => {
  it("gives the second caller the first caller's promise", async () => {
    // Two clicks, or a click plus an Enter. Two racing requests would
    // both claim the same key and make the second wait on a row lock.
    let resolve: ((v: CheckoutSessionView) => void) | undefined;
    post.mockImplementation(
      () => new Promise<CheckoutSessionView>((r) => { resolve = r; })
    );

    // Both calls in ONE synchronous turn, which is what a double
    // click actually is.
    const first = createCheckoutSession(INTENT);
    const second = createCheckoutSession(INTENT);

    await awaitCalls(1);

    resolve?.(sessionView());
    expect(await first).toEqual(await second);
    expect(await first).toBe(await second);
  });

  it("allows a fresh request once the first has settled", async () => {
    post.mockResolvedValue(sessionView());

    await createCheckoutSession(INTENT);
    await createCheckoutSession(INTENT);

    expect(post).toHaveBeenCalledTimes(2);
  });

  it("does not dedupe two DIFFERENT intents", async () => {
    const pending: ((v: CheckoutSessionView) => void)[] = [];
    post.mockImplementation(
      () => new Promise<CheckoutSessionView>((resolve) => pending.push(resolve))
    );

    const first = createCheckoutSession(INTENT);
    const second = createCheckoutSession({ ...INTENT, quantity: 12 });

    await awaitCalls(2);

    // Settled before leaving: the in-flight map is module state, and a
    // request left pending forever would be handed to the next test
    // asking for the same intent.
    pending.forEach((resolve) => resolve(sessionView()));
    await Promise.all([first, second]);
  });
});

describe("the two operations never collide", () => {
  it("gives create-session and payment-attempt different keys", async () => {
    post.mockRejectedValue(apiError(503));

    await expect(createCheckoutSession(INTENT)).rejects.toThrow();
    const createKey = keyOnCall(0);

    const attemptKey = claimKey("payment-attempt", SESSION);

    expect(createKey).not.toBe(attemptKey);
    expect(hasKey("payment-attempt", SESSION)).toBe(true);
  });

  it("keeps them in separately named slots", async () => {
    post.mockRejectedValue(apiError(503));

    await expect(createCheckoutSession(INTENT)).rejects.toThrow();
    claimKey("payment-attempt", SESSION);

    const names = storedKeys().sort();
    expect(names).toHaveLength(2);
    expect(names.some((n) => n.startsWith("forsa.idem.checkout-create."))).toBe(true);
    expect(names.some((n) => n.startsWith("forsa.idem.payment-attempt."))).toBe(true);
  });
});

describe("nothing readable is stored", () => {
  it("puts a one-way digest in the key name, never the intent", async () => {
    post.mockRejectedValue(apiError(503));
    await expect(createCheckoutSession(INTENT)).rejects.toThrow();

    const [name] = storedKeys();
    const digest = await checkoutIntentFingerprint(INTENT);

    expect(name).toBe(`forsa.idem.checkout-create.${digest}`);
    expect(name).not.toContain(INTENT.opportunityId);
    expect(name).not.toContain("aaaaaaaa");
    expect(name).not.toMatch(/quantity|allocation|location|branch/i);
  });

  it("stores an opaque UUID as the value", async () => {
    post.mockRejectedValue(apiError(503));
    await expect(createCheckoutSession(INTENT)).rejects.toThrow();

    const [name] = storedKeys();
    expect(window.sessionStorage.getItem(name)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
  });
});

describe("the key reaches no channel it should not", () => {
  const SOURCE = readFileSync(join(__dirname, "..", "lib", "checkout-create.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("uses sessionStorage only, via the shared store", () => {
    expect(SOURCE).toContain('from "./idempotency-store"');
    expect(SOURCE).not.toContain("localStorage");
    expect(SOURCE).not.toContain("document.cookie");
  });

  it("never logs it or puts it in a URL", () => {
    expect(SOURCE).not.toContain("console.");
    expect(SOURCE).not.toMatch(/searchParams\.set/);
    expect(SOURCE).not.toMatch(/location\.(href|hash|search)/);
  });

  it("sends it only as the Idempotency-Key header", () => {
    expect(SOURCE).toContain("idempotencyKey: key");
    // The intent is the BODY; the key is a header. Never the reverse.
    expect(SOURCE).toMatch(
      /post<CheckoutSessionView>\(\s*"\/trader\/checkout-sessions",\s*intent,\s*\{ idempotencyKey: key \}/
    );
  });
});
