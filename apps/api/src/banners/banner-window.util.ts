/**
 * Banner schedule-window overlap analysis.
 *
 * Pure and database-free on purpose: the concurrency limit is the one
 * piece of banner logic where an off-by-one is silently wrong rather
 * than loudly broken, so it is written to be exhaustively unit-testable
 * without a database.
 *
 * WHY THIS EXISTS AT ALL. A naive cap counting rows with is_active =
 * true is wrong: a banner whose window has ended stays is_active, so it
 * would consume a slot forever and the cap would ratchet shut. The
 * limit that actually matters is "how many can be live AT THE SAME
 * INSTANT", which is an interval-overlap question, not a row count.
 */

export interface BannerWindow {
  id: string;
  /** NULL = unbounded start (live as soon as activated). */
  startsAt: Date | null;
  /** NULL = unbounded end (live forever). EXCLUSIVE when set. */
  endsAt: Date | null;
}

type Event = { at: number; delta: 1 | -1 };

/**
 * Maximum number of windows simultaneously live at any instant from
 * `now` onward.
 *
 * Only the future is analysed. A window that has already ended can
 * never be live again, so counting it would permanently consume a slot
 * — exactly the bug a row count has. Windows already in progress are
 * clipped to start at `now`, so their past does not distort the result.
 *
 * Correctness argument: the maximum of a set of intervals is always
 * attained at some interval's start point, because the running count
 * only ever increases at a start. Evaluating every start event is
 * therefore exhaustive — no sampling and no time-stepping is involved.
 */
export function maxConcurrentWindows(windows: BannerWindow[], now: Date): number {
  const nowMs = now.getTime();
  const events: Event[] = [];

  for (const window of windows) {
    const endMs = window.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;

    // Already over: unreachable from now onward, so it cannot contend.
    // `endsAt` is exclusive, so an end exactly at `now` is already over.
    if (endMs <= nowMs) continue;

    const rawStartMs = window.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const startMs = Math.max(rawStartMs, nowMs);

    events.push({ at: startMs, delta: 1 });

    // An unbounded end never decrements — it correctly occupies a slot
    // for all future time.
    if (Number.isFinite(endMs)) events.push({ at: endMs, delta: -1 });
  }

  if (events.length === 0) return 0;

  events.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    // At an identical instant, ends are processed BEFORE starts. This is
    // what makes `endsAt` exclusive: a window ending at T and another
    // starting at T are adjacent, never overlapping.
    return a.delta - b.delta;
  });

  let running = 0;
  let peak = 0;
  for (const event of events) {
    running += event.delta;
    if (running > peak) peak = running;
  }
  return peak;
}

export interface OverlapCheckInput {
  /** Currently active windows for the placement, EXCLUDING the one being changed. */
  others: BannerWindow[];
  /** The window as it WOULD be after the change. */
  proposed: BannerWindow;
  now: Date;
  maxConcurrent: number;
}

export interface OverlapCheckResult {
  allowed: boolean;
  peak: number;
  maxConcurrent: number;
}

/**
 * Decides whether a proposed activation or window change is allowed.
 *
 * The limit is inclusive: a peak exactly equal to `maxConcurrent` is
 * accepted, and only `maxConcurrent + 1` is refused.
 */
export function checkOverlap(input: OverlapCheckInput): OverlapCheckResult {
  const peak = maxConcurrentWindows([...input.others, input.proposed], input.now);
  return {
    allowed: peak <= input.maxConcurrent,
    peak,
    maxConcurrent: input.maxConcurrent,
  };
}

/** Derived lifecycle state, using the same boundary rules as the SQL predicate. */
export function deriveBannerState(
  window: { isActive: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date
): "DRAFT" | "SCHEDULED" | "LIVE" | "EXPIRED" {
  if (!window.isActive) return "DRAFT";

  const nowMs = now.getTime();
  if (window.endsAt !== null && window.endsAt.getTime() <= nowMs) return "EXPIRED";
  if (window.startsAt !== null && window.startsAt.getTime() > nowMs) return "SCHEDULED";
  return "LIVE";
}
