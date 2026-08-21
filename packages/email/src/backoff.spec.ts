import {
  BASE_DELAY_MS,
  MAX_DELAY_MS,
  baseDelayForAttempt,
  hasAttemptsRemaining,
  nextAttemptAt,
} from "./backoff";
import { MAX_ATTEMPTS } from "./relay-timing";

const NOW = new Date("2026-08-21T00:00:00.000Z");

/** A pinned random source — the reason the RNG is injected rather than global. */
const fixed = (value: number) => () => value;

describe("the backoff curve", () => {
  it("starts at the base delay on the first attempt", () => {
    expect(baseDelayForAttempt(1)).toBe(BASE_DELAY_MS);
  });

  it("doubles with each attempt", () => {
    expect(baseDelayForAttempt(2)).toBe(BASE_DELAY_MS * 2);
    expect(baseDelayForAttempt(3)).toBe(BASE_DELAY_MS * 4);
    expect(baseDelayForAttempt(4)).toBe(BASE_DELAY_MS * 8);
  });

  it("is capped at six hours", () => {
    expect(baseDelayForAttempt(MAX_ATTEMPTS)).toBeLessThanOrEqual(MAX_DELAY_MS);
    expect(baseDelayForAttempt(50)).toBe(MAX_DELAY_MS);
  });

  it("never returns a negative or zero delay, even for a nonsense attempt", () => {
    expect(baseDelayForAttempt(0)).toBeGreaterThan(0);
    expect(baseDelayForAttempt(-5)).toBeGreaterThan(0);
  });

  it("is monotonically non-decreasing", () => {
    let previous = 0;
    for (let attempt = 1; attempt <= 20; attempt++) {
      const delay = baseDelayForAttempt(attempt);
      expect(delay).toBeGreaterThanOrEqual(previous);
      previous = delay;
    }
  });
});

describe("jitter is testable because the random source is injected", () => {
  it("takes the lower bound at random() = 0", () => {
    const at = nextAttemptAt({ attempts: 1, now: NOW, random: fixed(0) });

    expect(at.getTime() - NOW.getTime()).toBe(BASE_DELAY_MS * 0.5);
  });

  it("takes the upper bound at random() = 1", () => {
    const at = nextAttemptAt({ attempts: 1, now: NOW, random: fixed(1) });

    expect(at.getTime() - NOW.getTime()).toBe(BASE_DELAY_MS);
  });

  it("never schedules earlier than half the base delay", () => {
    for (const r of [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1]) {
      const delay = nextAttemptAt({ attempts: 3, now: NOW, random: fixed(r) }).getTime() - NOW.getTime();

      expect(delay).toBeGreaterThanOrEqual(baseDelayForAttempt(3) * 0.5);
      expect(delay).toBeLessThanOrEqual(baseDelayForAttempt(3));
    }
  });

  it("always schedules strictly in the future", () => {
    const at = nextAttemptAt({ attempts: 1, now: NOW, random: fixed(0) });

    expect(at.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("is deterministic for a pinned source — the same inputs give the same instant", () => {
    const a = nextAttemptAt({ attempts: 4, now: NOW, random: fixed(0.33) });
    const b = nextAttemptAt({ attempts: 4, now: NOW, random: fixed(0.33) });

    expect(a.getTime()).toBe(b.getTime());
  });

  it("spreads two rows that failed together", () => {
    const a = nextAttemptAt({ attempts: 2, now: NOW, random: fixed(0.1) });
    const b = nextAttemptAt({ attempts: 2, now: NOW, random: fixed(0.9) });

    expect(a.getTime()).not.toBe(b.getTime());
  });

  it("measures from the supplied clock, not the process clock", () => {
    // The caller holds the database's now(); the application clock is
    // not the authority on time anywhere in this system.
    const other = new Date("2030-01-01T00:00:00.000Z");
    const at = nextAttemptAt({ attempts: 1, now: other, random: fixed(1) });

    expect(at.getTime()).toBe(other.getTime() + BASE_DELAY_MS);
  });
});

describe("the attempt budget", () => {
  it("allows an attempt while below the maximum", () => {
    expect(hasAttemptsRemaining(0)).toBe(true);
    expect(hasAttemptsRemaining(MAX_ATTEMPTS - 1)).toBe(true);
  });

  it("refuses once the maximum has been reached", () => {
    // attempts is incremented AT CLAIM, so reaching MAX_ATTEMPTS means
    // the budget is spent even if the process died before recording an
    // outcome for the last one.
    expect(hasAttemptsRemaining(MAX_ATTEMPTS)).toBe(false);
  });

  it("refuses beyond the maximum", () => {
    expect(hasAttemptsRemaining(MAX_ATTEMPTS + 1)).toBe(false);
  });

  it("draws the boundary at 7 vs 8 for the approved budget", () => {
    expect(hasAttemptsRemaining(7)).toBe(true);
    expect(hasAttemptsRemaining(8)).toBe(false);
  });
});
