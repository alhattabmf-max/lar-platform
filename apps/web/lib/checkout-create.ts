import type {
  CheckoutSessionView,
  CreateCheckoutAllocationRequest,
  CreateCheckoutSessionRequest,
} from "@platform/types";
import { canonicalCheckoutRequest } from "@platform/types";
import { apiClient } from "./api-client";
import { claimKey, fingerprint, releaseKey } from "./idempotency-store";
import { toUserFacingError, type UserFacingError } from "./error-messages";

/**
 * Creating a checkout session — the FIRST of the two idempotent
 * operations in the purchase flow.
 *
 * The failure this exists to prevent: the POST reaches the server, the
 * session and its quantity lock are created, and the response is lost
 * — a dropped connection, a closed laptop, a reload. The person sees
 * nothing happen and submits again. Without a key that survives the
 * reload they arrive with a fresh one, the server reads a NEW
 * operation, and a SECOND session locks quantity they did not ask for
 * twice. Both locks then count toward their cooldown.
 *
 * So the key is derived from the operation's own inputs and stored in
 * `sessionStorage`:
 *
 *   forsa.idem.checkout-create.<intentFingerprint>
 *
 * `intentFingerprint` is SHA-256 over the canonical intent, matching
 * the form the server hashes into `request_hash`. Deriving the key's
 * NAME from the inputs is what makes reload-survival correct rather
 * than merely persistent:
 *
 *   - the same intent after a reload finds the same slot, and reuses
 *     the same key, so the retry is recognisable as a retry;
 *   - a changed intent produces a different fingerprint, a different
 *     slot, and therefore a new key — automatically, with nobody
 *     having to remember to rotate it. Reusing a key for changed
 *     inputs is a 409 by design on the server, and this makes it
 *     unreachable from here.
 *
 * The fingerprint is a one-way digest, so the storage key name carries
 * no opportunity id, no quantity, and no branch allocation. A storage
 * key is readable by any script on the origin and visible in devtools;
 * "8 cartons to the Riyadh branch" is commercial detail with no
 * business being there. The stored VALUE is an opaque UUID.
 */

/**
 * Aliases of the SHARED request contract, not a second declaration.
 *
 * The names are kept because "intent" is what this layer calls a purchase
 * before it exists — but the shape is the contract's, so a field renamed on the
 * API side stops compiling here rather than drifting.
 */
export type CheckoutAllocationIntent = CreateCheckoutAllocationRequest;
export type CheckoutIntent = CreateCheckoutSessionRequest;

/**
 * The canonical form of an intent.
 *
 * Delegates to the SHARED canonicaliser, which lives beside the request
 * contract it canonicalises. It previously restated the sort-and-project here,
 * which is the version that can drift from `canonicalize()` in
 * `checkout-session.service.ts` — and if it ever did, a client listing its
 * branches in a different order on a retry would compute a different
 * fingerprint, claim a different key, and create a second session holding a
 * second quantity lock.
 *
 * Sorting is what makes ordering irrelevant to identity: the same purchase
 * described in a different order is the same purchase.
 */
export function canonicalIntent(intent: CheckoutIntent): unknown {
  return canonicalCheckoutRequest(intent);
}

/** The storage discriminator for an intent. One-way. */
export function checkoutIntentFingerprint(intent: CheckoutIntent): Promise<string | null> {
  return fingerprint(canonicalIntent(intent));
}

/**
 * Failures after which the stored key must NOT be kept.
 *
 * The server rejected the request itself and its transaction rolled
 * back, taking the idempotency row with it — there is nothing left to
 * replay, and whatever the person does next is a new operation.
 *
 * `conflict` is deliberately absent. This endpoint raises two of them:
 * "could not complete checkout under concurrent load — please retry",
 * which is retryable and must keep the key, and the key-reuse
 * conflict, which cannot arise here because the key is derived from
 * the inputs. Releasing on conflict would turn the retryable one into
 * a second session.
 *
 * `network`, `unknown` and `server` are absent for the same reason as
 * always: the outcome is unknown, and that is precisely what the key
 * is for.
 */
function clearsTheKey(error: UserFacingError): boolean {
  return error.kind === "validation" || error.kind === "forbidden" || error.kind === "notFound";
}

/**
 * In-flight operations, keyed by the canonical intent.
 *
 * A double submit — two clicks, a click plus an Enter — must produce
 * ONE request, not two racing ones that both claim the same key and
 * make the second wait on a row lock.
 *
 * Keyed by the canonical JSON rather than by the fingerprint, and that
 * distinction is the whole point: the fingerprint is only available
 * after an `await`, and registering AFTER an await does not dedupe
 * anything. Both clicks would reach the await, both would suspend,
 * both would resume to find an empty map, and both would send a
 * request. The map has to be claimed in the same synchronous turn as
 * the call.
 *
 * The canonical JSON never leaves memory — it is not stored, sent or
 * logged — so it carries no PII anywhere a fingerprint would be
 * required.
 *
 * Module-level, because a component that re-renders between the two
 * events would otherwise lose the first request. Entries are removed
 * as soon as the request settles, so this never grows.
 */
const inFlight = new Map<string, Promise<CheckoutSessionView>>();

/**
 * Creates a checkout session, idempotently, across reloads.
 *
 * Returns the server's `CheckoutSessionView` — the same shape
 * `GET /trader/checkout-sessions/:id` answers with, so a caller that
 * navigates to the checkout page sees no difference between the
 * response it was handed and the one the page fetches.
 */
export function createCheckoutSession(
  intent: CheckoutIntent
): Promise<CheckoutSessionView> {
  // Computed SYNCHRONOUSLY, so the in-flight slot is claimed in the
  // same turn as the call. Anything after an await is too late.
  const canonical = JSON.stringify(canonicalIntent(intent));

  const existing = inFlight.get(canonical);
  if (existing) return existing;

  const request = send(intent).finally(() => inFlight.delete(canonical));
  inFlight.set(canonical, request);

  return request;
}

async function send(intent: CheckoutIntent): Promise<CheckoutSessionView> {
  const digest = await checkoutIntentFingerprint(intent);

  // No `crypto.subtle` — an insecure context. Falling back to
  // something reversible would put the intent into a storage key name,
  // so this degrades to a per-call key instead: still one key per
  // request and its retries, just without reload survival.
  const discriminator = digest ?? `volatile-${Date.now()}`;

  const key = claimKey("checkout-create", discriminator);

  try {
    const session = await apiClient.post<CheckoutSessionView>(
      "/trader/checkout-sessions",
      intent,
      { idempotencyKey: key }
    );

    // Definitive success. The session id is in hand, so nothing should
    // remain that a stale replay could return a response about.
    releaseKey("checkout-create", discriminator);
    return session;
  } catch (error: unknown) {
    if (clearsTheKey(toUserFacingError(error))) {
      releaseKey("checkout-create", discriminator);
    }
    // Rethrown unchanged: the caller renders the failure, and only the
    // key policy is decided here.
    throw error;
  }
}
