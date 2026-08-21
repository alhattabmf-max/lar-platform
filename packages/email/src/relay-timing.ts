/**
 * The timing constants that bind the provider call to the claim lease,
 * and the invariant that keeps them honest.
 *
 * They live together because they are only safe as a SET. The relay
 * leases a row for `LEASE_SECONDS`, then dispatches a batch through a
 * bounded pool; if the slowest possible traversal of that batch could
 * outlast the lease, another worker may re-claim a row while the first
 * is still talking to the provider. `claim_token` makes the resulting
 * settlement harmless — the superseded attempt matches zero rows — but
 * the message would already have been sent twice.
 *
 * So the numbers are not tuning knobs; changing one without the others
 * is a correctness change. `assertLeaseSafety()` is executed by a unit
 * test, which is what stops that from happening quietly.
 *
 * There is no lease renewal in 8D0, deliberately: renewal adds a second
 * clock and a new failure mode (a renewal that fails mid-flight) to
 * solve a problem this invariant already prevents.
 */

/** Rows claimed per pass. */
export const CLAIM_BATCH_SIZE = 20;

/** Concurrent provider calls. A fixed pool — never `Promise.all` over the batch. */
export const DISPATCH_CONCURRENCY = 5;

/** Hard per-call timeout, enforced by a real abort. */
export const PROVIDER_TIMEOUT_MS = 20_000;

/** How long a claimed row stays leased. */
export const LEASE_SECONDS = 120;

/**
 * Headroom the worst case must leave before the lease expires.
 *
 * Covers what the worst-case formula does not model: claim commit,
 * recipient lookup, template rendering, settlement round trips, and
 * ordinary scheduling jitter.
 */
export const SAFETY_MARGIN_MS = 20_000;

/** Attempt budget per row. Exceeding it dead-letters the row. */
export const MAX_ATTEMPTS = 8;

export interface LeaseSafetyReport {
  /** Sequential waves the pool needs to drain a full batch. */
  waves: number;
  /** Worst-case dispatch time if every call consumes the full timeout. */
  worstCaseDispatchMs: number;
  /** Worst case plus the margin. */
  requiredMs: number;
  /** The lease, in milliseconds. */
  leaseMs: number;
  safe: boolean;
}

export function computeLeaseSafety(
  input: {
    claimBatchSize?: number;
    dispatchConcurrency?: number;
    providerTimeoutMs?: number;
    leaseSeconds?: number;
    safetyMarginMs?: number;
  } = {}
): LeaseSafetyReport {
  const claimBatchSize = input.claimBatchSize ?? CLAIM_BATCH_SIZE;
  const dispatchConcurrency = input.dispatchConcurrency ?? DISPATCH_CONCURRENCY;
  const providerTimeoutMs = input.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
  const leaseSeconds = input.leaseSeconds ?? LEASE_SECONDS;
  const safetyMarginMs = input.safetyMarginMs ?? SAFETY_MARGIN_MS;

  const waves = Math.ceil(claimBatchSize / dispatchConcurrency);
  const worstCaseDispatchMs = waves * providerTimeoutMs;
  const requiredMs = worstCaseDispatchMs + safetyMarginMs;
  const leaseMs = leaseSeconds * 1000;

  return { waves, worstCaseDispatchMs, requiredMs, leaseMs, safe: requiredMs < leaseMs };
}

/**
 * Throws when the configured constants could let a batch outlive its
 * lease. Called from a unit test, so the build fails rather than a
 * duplicate send appearing in production.
 */
export function assertLeaseSafety(): void {
  const report = computeLeaseSafety();
  if (!report.safe) {
    throw new Error(
      "Relay lease safety violated: worst-case dispatch " +
        `(${report.waves} waves x ${PROVIDER_TIMEOUT_MS}ms) + margin ${SAFETY_MARGIN_MS}ms ` +
        `= ${report.requiredMs}ms, which is not below the lease of ${report.leaseMs}ms. ` +
        "Lower CLAIM_BATCH_SIZE, raise DISPATCH_CONCURRENCY, shorten PROVIDER_TIMEOUT_MS, " +
        "or lengthen LEASE_SECONDS."
    );
  }
}
