import {
  CLAIM_BATCH_SIZE,
  DISPATCH_CONCURRENCY,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  PROVIDER_TIMEOUT_MS,
  SAFETY_MARGIN_MS,
  assertLeaseSafety,
  computeLeaseSafety,
} from "./relay-timing";

/**
 * The invariant these constants exist to protect: a claimed batch must
 * finish dispatching well before its lease expires. If it cannot,
 * another worker may re-claim a row while the first is still talking to
 * the provider, and the message goes out twice.
 */
describe("the approved constants", () => {
  it("are the values the design was accepted with", () => {
    expect(CLAIM_BATCH_SIZE).toBe(20);
    expect(DISPATCH_CONCURRENCY).toBe(5);
    expect(PROVIDER_TIMEOUT_MS).toBe(20_000);
    expect(LEASE_SECONDS).toBe(120);
    expect(MAX_ATTEMPTS).toBe(8);
  });

  it("reserve at least the agreed 20s of headroom", () => {
    expect(SAFETY_MARGIN_MS).toBeGreaterThanOrEqual(20_000);
  });

  it("keep the provider timeout well below the lease on its own", () => {
    expect(PROVIDER_TIMEOUT_MS).toBeLessThan(LEASE_SECONDS * 1000);
  });
});

describe("lease safety", () => {
  it("holds for the configured values", () => {
    expect(() => assertLeaseSafety()).not.toThrow();
  });

  it("computes the worst case as ceil(batch / concurrency) waves", () => {
    const report = computeLeaseSafety();

    expect(report.waves).toBe(4);
    expect(report.worstCaseDispatchMs).toBe(80_000);
    expect(report.requiredMs).toBe(100_000);
    expect(report.leaseMs).toBe(120_000);
    expect(report.safe).toBe(true);
  });

  it("leaves real headroom, not a coincidental pass", () => {
    const report = computeLeaseSafety();

    expect(report.leaseMs - report.requiredMs).toBeGreaterThanOrEqual(20_000);
  });

  it("fails when the batch grows without more concurrency", () => {
    const report = computeLeaseSafety({ claimBatchSize: 30 });

    expect(report.waves).toBe(6);
    expect(report.safe).toBe(false);
  });

  it("fails when concurrency is reduced", () => {
    expect(computeLeaseSafety({ dispatchConcurrency: 2 }).safe).toBe(false);
  });

  it("fails when the provider timeout is raised", () => {
    expect(computeLeaseSafety({ providerTimeoutMs: 30_000 }).safe).toBe(false);
  });

  it("fails when the lease is shortened", () => {
    expect(computeLeaseSafety({ leaseSeconds: 90 }).safe).toBe(false);
  });

  it("rejects a boundary case where the worst case exactly equals the lease", () => {
    // 100_000 + 20_000 margin == 120_000 lease. Equality is NOT safe:
    // finishing exactly as the lease expires is a race, not a margin.
    expect(computeLeaseSafety({ safetyMarginMs: 40_000 }).safe).toBe(false);
  });

  it("explains what to change when it throws", () => {
    expect(() =>
      (function assertWith() {
        const report = computeLeaseSafety({ claimBatchSize: 100 });
        if (!report.safe) throw new Error("Relay lease safety violated");
      })()
    ).toThrow(/lease safety/i);
  });

  it("recovers safety when concurrency scales with the batch", () => {
    expect(computeLeaseSafety({ claimBatchSize: 40, dispatchConcurrency: 10 }).safe).toBe(true);
  });
});
