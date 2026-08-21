/**
 * Runs tasks with a fixed ceiling on how many are in flight.
 *
 * Deliberately NOT `Promise.all` over the batch: that would open one
 * provider connection per claimed row, so the concurrency would be set
 * by whatever the claim happened to return rather than by a number
 * anyone chose. The lease-safety invariant in `@platform/email` is
 * computed from a FIXED concurrency, and it is only meaningful if the
 * code actually honours one.
 *
 * The pool never rejects. A task that throws yields a `rejected` result
 * for that item and the rest of the batch continues — one row failing
 * to send must not abandon the other nineteen, all of which are already
 * leased and would otherwise sit until their lease expired.
 */

export type PoolOutcome<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

export interface BoundedPoolOptions {
  concurrency: number;
  /** Observed peak in-flight count, for the test that proves the ceiling holds. */
  onInFlightChange?: (inFlight: number) => void;
}

export async function runBounded<TItem, TResult>(
  items: readonly TItem[],
  task: (item: TItem, index: number) => Promise<TResult>,
  options: BoundedPoolOptions
): Promise<PoolOutcome<TResult>[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const results: PoolOutcome<TResult>[] = new Array(items.length);

  let next = 0;
  let inFlight = 0;

  const changed = (): void => options.onInFlightChange?.(inFlight);

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;

      inFlight++;
      changed();
      try {
        results[index] = { status: "fulfilled", value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      } finally {
        inFlight--;
        changed();
      }
    }
  }

  // Exactly `concurrency` runners, each pulling the next index until the
  // list is exhausted. Slots refill as tasks finish rather than waiting
  // for a whole wave, so one slow send does not idle the other four.
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(runners);

  return results;
}
