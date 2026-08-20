import { Prisma } from "@prisma/client";

/**
 * THE definition of a publicly visible banner. There is exactly one.
 *
 * Every public display path — the banner list and the banner image
 * route — composes this fragment. Neither restates the condition, so
 * they cannot drift: an image cannot become fetchable for a banner the
 * list refuses to show, which is what would leak the existence of
 * drafts, scheduled banners, and expired ones.
 *
 * Boundary semantics, fixed here and nowhere else:
 *
 *   starts_at = now()  → LIVE      (inclusive lower bound)
 *   ends_at   = now()  → NOT LIVE  (exclusive upper bound)
 *   NULL on either side → unbounded on that side
 *
 * `now()` is the PostgreSQL transaction timestamp, evaluated by the
 * database inside the same statement. It is deliberately not a value
 * computed in Node and bound as a parameter — that would be
 * application time wearing database clothes, and two API instances with
 * skewed clocks would disagree about what is live.
 */
export const LIVE_BANNER_CONDITION = Prisma.sql`
  is_active = true
  AND (starts_at IS NULL OR starts_at <= now())
  AND (ends_at   IS NULL OR ends_at   >  now())
`;

/**
 * Advisory-lock namespace for banner placement serialisation.
 *
 * A fixed constant so every process derives the same key, and distinct
 * from any other advisory lock in the system so an unrelated lock can
 * never collide with a placement lock.
 */
export const BANNER_PLACEMENT_LOCK_NAMESPACE = 8301;

/**
 * Serialises all activation/window work for ONE placement.
 *
 * Row locks are not sufficient here: the overlap check reads a set of
 * rows and then writes, and a concurrent INSERT into that same set is a
 * phantom that `SELECT ... FOR UPDATE` cannot prevent. A transaction
 * scoped advisory lock keyed on the placement does prevent it, and
 * releases automatically at COMMIT or ROLLBACK — there is no path that
 * leaks a held lock.
 *
 * Different placements hash to different keys and therefore never block
 * each other.
 */
export function placementLock(placement: string): Prisma.Sql {
  return Prisma.sql`SELECT pg_advisory_xact_lock(${BANNER_PLACEMENT_LOCK_NAMESPACE}::int4, hashtext(${placement}))`;
}

/**
 * Reads the database's own clock ONCE, to be reused as a bound
 * parameter for the whole overlap computation.
 *
 * The overlap sweep compares many intervals against "now"; taking the
 * clock once means every comparison uses the same instant. Calling
 * now() per comparison would be self-consistent within a statement but
 * not across the several the sweep needs.
 */
export const SELECT_DB_NOW = Prisma.sql`SELECT now() AS now`;
