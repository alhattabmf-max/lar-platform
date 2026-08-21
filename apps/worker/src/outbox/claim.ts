import { Prisma, type PrismaClient } from "@prisma/client";
import {
  CLAIM_BATCH_SIZE,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  RELAY_SUPPORTED_EVENT_TYPES,
  type EmailErrorClass,
} from "@platform/email";

/**
 * The outbox relay's database layer: terminalisation, claim, and the
 * three settlement primitives. No provider call, no template, no
 * scheduling — this module only moves rows between states.
 *
 * STRUCTURAL CONTRACT: it touches `outbox_events` and nothing else. No
 * `audit_logs` (the relay has no business actor, and infrastructure
 * events do not belong in an audit trail), no `notifications` (they do
 * not exist yet, and the relay must never depend on them), and no
 * `users` — recipient resolution happens in the processor, not here. A
 * structural test asserts this against the source.
 *
 * TIME: every timestamp comes from the DATABASE's `now()`, evaluated
 * inside the transaction. `new Date()` is never used for eligibility, a
 * lease boundary, or a settlement stamp: the application clock can
 * drift from the database's, and two workers on different hosts would
 * then disagree about whether a lease had expired.
 *
 * PARAMETERISATION: every value — including the event-type allowlist
 * and the lease interval — is a bound parameter through
 * `Prisma.sql`/`$queryRaw`. No SQL fragment is built by string
 * concatenation.
 */

/** Exactly the columns the processor needs. No rendered content, no recipient address. */
export interface ClaimedOutboxRow {
  id: string;
  eventType: string;
  /** Raw, unvalidated. The processor runs it through the closed schema. */
  payload: unknown;
  attempts: number;
  claimToken: string;
}

export interface TerminalisedRow {
  id: string;
}

export interface ClaimOptions {
  /** Identifies the claiming process. Observability only — never a correctness guard. */
  lockedBy: string;
  batchSize?: number;
  leaseSeconds?: number;
}

/**
 * The positive allowlist, as a bound parameter.
 *
 * A code constant rather than a setting: a configurable watermark could
 * be misconfigured in production into a retroactive send of every
 * historical row, whereas this cannot. Everything outside it — and at
 * the 8D0 baseline that is at least thirty distinct literal event types
 * plus several constructed at runtime — is invisible here: never read,
 * never locked, never updated.
 */
const SUPPORTED_TYPES: string[] = [...RELAY_SUPPORTED_EVENT_TYPES];

/**
 * Retires rows that can never be attempted again.
 *
 * Runs BEFORE the claim, in the same transaction and against the same
 * `now()`. It exists because `attempts` is incremented AT CLAIM: a
 * worker that dies after claiming its eighth attempt leaves a row at
 * `attempts = MAX_ATTEMPTS`, still PROCESSING, with a lease that will
 * expire. The claim predicate requires `attempts < MAX_ATTEMPTS`, so
 * without this sweep that row would be permanently stuck — leased to
 * nobody, eligible for nothing, and invisible in any PENDING count.
 *
 * Two shapes are retired:
 *   - PROCESSING with an expired lease and no attempts left (the crash
 *     case above);
 *   - PENDING with no attempts left (defensive: a settlement that
 *     returned a row to PENDING at the budget boundary).
 *
 * `published_at` is explicitly forced NULL. A row reaching this path
 * was never delivered, and leaving a stale publication stamp on a
 * FAILED row would misreport it as sent.
 */
export async function terminaliseExhausted(
  tx: Prisma.TransactionClient,
  errorClass: EmailErrorClass = "ATTEMPTS_EXHAUSTED"
): Promise<TerminalisedRow[]> {
  return tx.$queryRaw<TerminalisedRow[]>`
    UPDATE outbox_events
    SET status          = 'FAILED',
        failed_at       = now(),
        error_class     = ${errorClass},
        next_attempt_at = NULL,
        published_at    = NULL,
        locked_at       = NULL,
        locked_until    = NULL,
        locked_by       = NULL,
        claim_token     = NULL
    WHERE event_type = ANY(${SUPPORTED_TYPES})
      AND attempts >= ${MAX_ATTEMPTS}
      AND (
        (status = 'PROCESSING' AND locked_until < now())
        OR status = 'PENDING'
      )
    RETURNING id
  `;
}

/**
 * Leases a batch of eligible rows.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes multiple workers safe without
 * a distributed lock: a second worker skips rows the first has locked
 * rather than blocking on them, so batches are disjoint. This is the
 * same cross-process contract the existing lifecycle sweeps use.
 *
 * `ORDER BY created_at, id` is a TOTAL order. `created_at` alone is
 * not unique, and rows tying on it would make batch composition
 * non-deterministic across workers and across test runs.
 *
 * The `OR (PROCESSING AND locked_until < now())` branch IS the crash
 * recovery — there is no separate reaper. A worker that died mid-flight
 * leaves its row PROCESSING; once the lease lapses another worker
 * picks it up with `attempts` already incremented.
 *
 * `gen_random_uuid()` produces a fresh, unguessable `claim_token` PER
 * ROW rather than one per batch.
 *
 * To be precise about what this does and does not buy: a batch-wide
 * token would NOT let one row's settlement affect another, because
 * every settlement also matches on `id`. The reasons for per-row are
 * narrower and still worth having — each lease attempt is isolated, a
 * leaked or mis-logged token compromises exactly one row, tests and
 * traces can follow a single row unambiguously, and no future change
 * can come to depend on a batch-shared token as though it identified
 * the batch.
 */
export async function claimBatch(
  tx: Prisma.TransactionClient,
  options: ClaimOptions
): Promise<ClaimedOutboxRow[]> {
  const batchSize = options.batchSize ?? CLAIM_BATCH_SIZE;
  const leaseSeconds = options.leaseSeconds ?? LEASE_SECONDS;

  const rows = await tx.$queryRaw<
    { id: string; event_type: string; payload: unknown; attempts: number; claim_token: string }[]
  >`
    WITH batch AS (
      SELECT id FROM outbox_events
      WHERE event_type = ANY(${SUPPORTED_TYPES})
        AND attempts < ${MAX_ATTEMPTS}
        AND (
          (status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
          OR
          (status = 'PROCESSING' AND locked_until < now())
        )
      ORDER BY created_at ASC, id ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events o
    SET status       = 'PROCESSING',
        locked_at    = now(),
        locked_until = now() + make_interval(secs => ${leaseSeconds}),
        locked_by    = ${options.lockedBy},
        claim_token  = gen_random_uuid(),
        attempts     = o.attempts + 1
    FROM batch
    WHERE o.id = batch.id
    RETURNING o.id, o.event_type, o.payload, o.attempts, o.claim_token
  `;

  // Projected onto the closed shape the processor consumes. The row
  // deliberately carries no recipient address, no subject and no
  // rendered body — the payload holds no address at all, and rendering
  // happens after validation, downstream of this module.
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    payload: row.payload,
    attempts: row.attempts,
    claimToken: row.claim_token,
  }));
}

/**
 * Runs terminalisation and the claim in ONE transaction against ONE
 * database clock.
 *
 * Short and free of external I/O by design: the provider call happens
 * afterwards, outside any transaction. Holding a transaction open
 * across a network round trip would pin a connection for its whole
 * duration and make the lease meaningless.
 */
export interface ClaimPassResult {
  terminalised: TerminalisedRow[];
  claimed: ClaimedOutboxRow[];
}

export async function runClaimPass(
  prisma: PrismaClient,
  options: ClaimOptions
): Promise<ClaimPassResult> {
  return prisma.$transaction(async (tx) => {
    // Order matters: retiring exhausted rows first means the claim
    // below cannot re-lease one, and a row retired here is reported as
    // terminalised rather than silently skipped.
    const terminalised = await terminaliseExhausted(tx);
    const claimed = await claimBatch(tx, options);
    return { terminalised, claimed };
  });
}

/**
 * Settlement.
 *
 * Every statement is conditioned on all THREE of `id`, `status =
 * 'PROCESSING'` and the exact `claim_token`. `locked_by` is not
 * sufficient: the same worker id can re-claim a row after a lease
 * expiry, so a slow, superseded attempt would still match on it and
 * could overwrite the current claim's result. A token is unique per
 * claim attempt, so a superseded settlement matches zero rows.
 *
 * A zero-row result is therefore NOT success — it means this attempt
 * was superseded — and every caller must treat it that way. The return
 * value is the affected row count precisely so it cannot be ignored.
 *
 * All four lease fields plus the token are cleared atomically in the
 * same statement as the status change, which is also what the
 * all-or-none CHECK constraint requires.
 */
export async function settlePublished(
  prisma: Prisma.TransactionClient | PrismaClient,
  id: string,
  claimToken: string
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE outbox_events
    SET status          = 'PUBLISHED',
        published_at    = now(),
        next_attempt_at = NULL,
        failed_at       = NULL,
        error_class     = NULL,
        locked_at       = NULL,
        locked_until    = NULL,
        locked_by       = NULL,
        claim_token     = NULL
    WHERE id = ${id}::uuid
      AND status = 'PROCESSING'
      AND claim_token = ${claimToken}::uuid
  `;
}

/**
 * Returns a row to PENDING with a backoff deferral.
 *
 * `nextAttemptAt` is computed by the caller from the DATABASE's `now()`
 * — never from the process clock — and passed in, so this module stays
 * free of the jitter policy while the timestamp still originates from
 * the one authoritative clock.
 */
export async function settleRetry(
  prisma: Prisma.TransactionClient | PrismaClient,
  id: string,
  claimToken: string,
  nextAttemptAt: Date,
  errorClass: EmailErrorClass
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE outbox_events
    SET status          = 'PENDING',
        next_attempt_at = ${nextAttemptAt},
        error_class     = ${errorClass},
        failed_at       = NULL,
        published_at    = NULL,
        locked_at       = NULL,
        locked_until    = NULL,
        locked_by       = NULL,
        claim_token     = NULL
    WHERE id = ${id}::uuid
      AND status = 'PROCESSING'
      AND claim_token = ${claimToken}::uuid
  `;
}

/**
 * Dead-letters a row.
 *
 * `error_class` is a member of the closed set — never free text, and
 * never an exception message. `last_error` is left untouched: it is
 * written nowhere in this repository and would be exactly the column an
 * exception message leaked into.
 */
export async function settleFailed(
  prisma: Prisma.TransactionClient | PrismaClient,
  id: string,
  claimToken: string,
  errorClass: EmailErrorClass
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE outbox_events
    SET status          = 'FAILED',
        failed_at       = now(),
        error_class     = ${errorClass},
        next_attempt_at = NULL,
        published_at    = NULL,
        locked_at       = NULL,
        locked_until    = NULL,
        locked_by       = NULL,
        claim_token     = NULL
    WHERE id = ${id}::uuid
      AND status = 'PROCESSING'
      AND claim_token = ${claimToken}::uuid
  `;
}

/**
 * The database's current time.
 *
 * Prisma's fluent API cannot emit `now()`, so a raw read is the only
 * way to obtain the clock the SQL above compares against. Callers use
 * it to compute `nextAttemptAt`, so backoff is measured from the same
 * clock that decides eligibility.
 */
export async function databaseNow(
  prisma: Prisma.TransactionClient | PrismaClient
): Promise<Date> {
  const rows = await prisma.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  return rows[0].now;
}
