import { newIdempotencyKey, type IdempotencyKey } from "./idempotency";

/**
 * Where an in-flight operation's idempotency key survives a reload.
 *
 * A `useRef` holds a key across re-renders, which covers a double
 * click and an in-place retry. It does NOT survive a remount — and a
 * remount is exactly what a reload is. Someone whose connection
 * stalled mid-request, who then reloads and presses the button again,
 * would arrive with a fresh key: to the server that is a NEW operation,
 * which is the precise failure idempotency exists to prevent.
 *
 * So the key lives in `sessionStorage`, keyed by the operation and the
 * entity it acts on.
 *
 * WHY sessionStorage and not the alternatives:
 *
 *  - `localStorage` persists across tabs and browser restarts. A key
 *    for an operation abandoned last week would be replayed against a
 *    session that no longer exists, and it would outlive the sign-out
 *    of the person who created it.
 *  - A cookie would be sent on every request to the API, putting an
 *    operation identifier into the traffic of endpoints that have
 *    nothing to do with it.
 *  - The URL would put it in history, in the referrer, and in any log
 *    that records paths.
 *
 * `sessionStorage` is scoped to one tab and cleared when it closes,
 * which matches the lifetime of the operation itself.
 *
 * WHAT MAY GO IN A KEY NAME. Only the operation name and an opaque
 * identifier — here a server-generated UUID. No email, no company name,
 * no legal name, and no raw quantity or branch allocation: a storage
 * key is readable by any script on the origin and visible in devtools,
 * and "8 cartons to the Riyadh branch" is commercial detail. Where an
 * operation must be distinguished by its INPUTS, use
 * `fingerprint()` below, which is one-way.
 */

/** Namespaced so nothing else on the origin collides with these. */
const PREFIX = "forsa.idem";

/** The operations that own a stored key. A closed list, not free text. */
export const IDEMPOTENT_OPERATIONS = [
  "checkout-create",
  "payment-attempt",
  "dispute-open",
] as const;
export type IdempotentOperationName = (typeof IDEMPOTENT_OPERATIONS)[number];

/**
 * Builds the storage key name.
 *
 * `discriminator` must be opaque — a UUID, or a `fingerprint()` digest.
 * Never a value that can be read back as business detail.
 */
function storageKey(operation: IdempotentOperationName, discriminator: string): string {
  return `${PREFIX}.${operation}.${discriminator}`;
}

/**
 * A one-way digest of an operation's inputs.
 *
 * For the case where an operation has no id yet — creating a checkout
 * session is defined by its opportunity, quantity and allocations, and
 * none of that may appear in a key name. SHA-256 over a canonical form
 * gives a stable discriminator that cannot be read back.
 *
 * The canonical form must match the server's: `checkout-session.service`
 * hashes `{opportunityId, quantity, allocations sorted by
 * companyLocationId}`. Changing any of them changes the digest, so a
 * changed request naturally gets a different key rather than colliding
 * with the previous one and being replayed.
 *
 * Async because `crypto.subtle` is, and unavailable outside a secure
 * context — the caller must handle that rather than silently falling
 * back to something reversible.
 */
export async function fingerprint(canonicalInput: unknown): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;

  const bytes = new TextEncoder().encode(JSON.stringify(canonicalInput));
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** True when there is a `sessionStorage` to use at all. */
function available(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage != null;
  } catch {
    // Access itself throws when storage is disabled by policy.
    return false;
  }
}

/**
 * The key for this operation, creating and storing one if absent.
 *
 * Reading before writing is the whole point: the second call after a
 * reload returns the SAME key the first call generated, so the retry
 * the server sees is a retry rather than a new purchase.
 *
 * If storage is unavailable — private mode, a policy, a browser that
 * throws on quota — this falls back to a fresh in-memory key rather
 * than failing the operation. That degrades to the per-mount behaviour,
 * which still guards a double click, and it never degrades to sending
 * no key at all.
 */
export function claimKey(
  operation: IdempotentOperationName,
  discriminator: string
): IdempotencyKey {
  const name = storageKey(operation, discriminator);

  if (available()) {
    try {
      const existing = window.sessionStorage.getItem(name);
      if (existing) return existing as IdempotencyKey;

      const created = newIdempotencyKey();
      window.sessionStorage.setItem(name, created);
      return created;
    } catch {
      // Fall through to the in-memory key.
    }
  }

  return newIdempotencyKey();
}

/**
 * Discards the stored key, so the next attempt is a NEW operation.
 *
 * Call this when the operation has reached a conclusion:
 *
 *  - it SUCCEEDED — the session is paid, the order exists. Keeping the
 *    key would let a stale replay return a response about something
 *    already finished.
 *  - it failed TERMINALLY and the person explicitly chose to try again.
 *    A definitive refusal is not a retry of the same attempt; reusing
 *    the key would replay the refusal forever.
 *  - the session was abandoned or expired — there is nothing left to
 *    retry against.
 *
 * Do NOT call it for a network-unknown outcome. That is the one case
 * where the request may have reached the server, and the whole purpose
 * of the key is to make the retry recognisable.
 */
export function releaseKey(
  operation: IdempotentOperationName,
  discriminator: string
): void {
  if (!available()) return;
  try {
    window.sessionStorage.removeItem(storageKey(operation, discriminator));
  } catch {
    // Nothing to do: an unremovable key expires with the tab.
  }
}

/** Whether a key is currently stored. Exposed for tests, not for flow control. */
export function hasKey(
  operation: IdempotentOperationName,
  discriminator: string
): boolean {
  if (!available()) return false;
  try {
    return window.sessionStorage.getItem(storageKey(operation, discriminator)) !== null;
  } catch {
    return false;
  }
}
