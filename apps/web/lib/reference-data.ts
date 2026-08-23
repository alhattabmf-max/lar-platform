import type { Loaded } from "./marketplace-data";

/**
 * The request id of whichever reference read failed first.
 *
 * The product form needs both the taxonomy and the sales units, so either
 * failing means no form. This returns something a reader can quote to
 * support without the caller having to narrow two unions by hand — and
 * without inventing a combined "reference data" error type that would only
 * ever have this one use.
 *
 * Null when neither failed, which the caller will not render anyway.
 */
export function referenceFailureRequestId(
  ...results: readonly Loaded<unknown>[]
): string | null {
  for (const result of results) {
    if (!result.ok) return result.error.requestId;
  }
  return null;
}
