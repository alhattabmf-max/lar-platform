import { MAX_ATTEMPTS } from "./relay-timing";

/**
 * Retry scheduling for a failed send.
 *
 * `delay = min(base * 2^(attempts - 1), 6h)`, then jittered into the
 * upper half of that window: `delay * (0.5 + random * 0.5)`. Jitter
 * spreads a batch that failed together — without it, every row from one
 * provider outage retries in the same instant and reproduces the
 * outage's load pattern.
 *
 * The random source is INJECTED. A test cannot pin `Math.random` called
 * from inside a closure, and an unpinnable clock or RNG is how a timing
 * test becomes flaky and is then deleted.
 */

export type RandomSource = () => number;

export const BASE_DELAY_MS = 30_000;
export const MAX_DELAY_MS = 6 * 60 * 60 * 1000;

/** The deterministic part, before jitter. Exported so tests can assert the curve. */
export function baseDelayForAttempt(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(BASE_DELAY_MS * 2 ** exponent, MAX_DELAY_MS);
}

export interface NextAttemptInput {
  /** `attempts` AFTER the claim incremented it. */
  attempts: number;
  now: Date;
  random?: RandomSource;
}

/**
 * When a retryable failure should next become eligible.
 *
 * `now` is passed in rather than read from the process clock: the
 * caller holds the database's `now()`, and the application clock is not
 * the authority on time anywhere in this system.
 */
export function nextAttemptAt({ attempts, now, random = Math.random }: NextAttemptInput): Date {
  const base = baseDelayForAttempt(attempts);
  const jittered = base * (0.5 + random() * 0.5);
  return new Date(now.getTime() + Math.round(jittered));
}

/**
 * Whether a row has any attempt left.
 *
 * `attempts` is incremented AT CLAIM, so a row that has been claimed
 * `MAX_ATTEMPTS` times has exhausted its budget even if the process
 * died before recording an outcome for the last one. That is the case
 * the terminalisation sweep exists to clean up.
 */
export function hasAttemptsRemaining(attempts: number): boolean {
  return attempts < MAX_ATTEMPTS;
}
