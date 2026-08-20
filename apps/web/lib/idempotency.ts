/**
 * Idempotency keys for state-changing API calls.
 *
 * The API requires an `Idempotency-Key` header on eight endpoints
 * (checkout creation, payment attempts, dispute open/evidence/respond,
 * admin dispute decision, refund attempts, invoice drafts, settlement).
 *
 * The contract that makes it work: ONE key per logical operation, reused
 * across every retry of THAT operation. A fresh key per retry defeats
 * the entire mechanism — the server sees a new operation each time and
 * happily creates a second checkout session or a second payment.
 *
 * That is why no function here is called from inside a retry loop, and
 * why the client never invents a key on the caller's behalf: the key is
 * created once by the code that owns the operation, then passed
 * explicitly.
 */

export type IdempotencyKey = string & { readonly __brand: "IdempotencyKey" };

/** Creates a key for ONE new logical operation. Never call this per attempt. */
export function newIdempotencyKey(): IdempotencyKey {
  return crypto.randomUUID() as IdempotencyKey;
}

/**
 * Holds a single key for the lifetime of one operation, including all of
 * its retries. `get()` returns the same value every time — there is
 * deliberately no way to rotate it.
 */
export class IdempotentOperation {
  private readonly key: IdempotencyKey;

  constructor(key: IdempotencyKey = newIdempotencyKey()) {
    this.key = key;
  }

  get(): IdempotencyKey {
    return this.key;
  }

  /** Header object to spread into a request. */
  headers(): Record<string, string> {
    return { "Idempotency-Key": this.key };
  }
}

/**
 * Runs `attempt` up to `maxAttempts` times with the SAME key.
 *
 * The key is bound once, before the first attempt, and handed to every
 * attempt unchanged — the structural guarantee that a retry can never
 * silently become a second operation.
 */
export async function withIdempotency<T>(
  attempt: (key: IdempotencyKey) => Promise<T>,
  options: { maxAttempts?: number; shouldRetry?: (error: unknown) => boolean } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 1;
  const operation = new IdempotentOperation();

  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await attempt(operation.get());
    } catch (error) {
      lastError = error;
      if (!options.shouldRetry?.(error)) throw error;
    }
  }
  throw lastError;
}
