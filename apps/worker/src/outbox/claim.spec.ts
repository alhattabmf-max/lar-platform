import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_ATTEMPTS, CLAIM_BATCH_SIZE, LEASE_SECONDS } from "@platform/email";
import {
  claimBatch,
  databaseNow,
  runClaimPass,
  settleFailed,
  settlePublished,
  settleRetry,
  terminaliseExhausted,
} from "./claim";

/**
 * These tests assert the SQL this module EMITS — its predicates, its
 * bound parameters and its SET clauses.
 *
 * That is a complete local proof for the properties that are decided
 * entirely by the statement text: which event types can be touched at
 * all, which columns a settlement clears, and what a settlement is
 * conditioned on. It is NOT a proof of what PostgreSQL then does with
 * concurrent sessions, expired leases or row counts — those live in
 * test/outbox-relay.integration-spec.ts and have never been run.
 */

type Captured = { sql: string; values: unknown[] };

function capture() {
  const calls: Captured[] = [];

  const record =
    (result: unknown) =>
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      // Reconstruct the statement with visible placeholders, then
      // collapse whitespace so assertions are not formatting-sensitive.
      const sql = strings.raw.join(" ? ").replace(/\s+/g, " ").trim();
      calls.push({ sql, values });
      return Promise.resolve(result);
    };

  const tx = {
    $queryRaw: jest.fn(record([])),
    $executeRaw: jest.fn(record(1)),
  };

  return { tx, calls };
}

function lastSql(calls: Captured[]): string {
  return calls[calls.length - 1].sql;
}

const CLAIM_SOURCE = readFileSync(join(__dirname, "claim.ts"), "utf8");

/** Comments stripped, so this module's own explanations are never read as code. */
const CLAIM_CODE = CLAIM_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/.*$/gm,
  "$1"
);

describe("structural contract — what this module may touch", () => {
  it.each(["audit_logs", "notifications", "notification_recipients", "users", "companies"])(
    "never references %s",
    (table) => {
      expect(CLAIM_CODE).not.toContain(table);
    }
  );

  it("references only outbox_events", () => {
    const tables = [...CLAIM_CODE.matchAll(/\b(?:FROM|UPDATE|JOIN|INTO)\s+([a-z_]+)/g)].map(
      (match) => match[1]
    );
    const distinct = [...new Set(tables)].filter((name) => name !== "batch");

    expect(distinct).toEqual(["outbox_events"]);
  });

  it("performs no provider call, rendering or scheduling", () => {
    expect(CLAIM_CODE).not.toContain("sendEmail");
    expect(CLAIM_CODE).not.toContain("renderEmail");
    expect(CLAIM_CODE).not.toContain("bullmq");
  });
});

describe("time comes from the database, never from Node", () => {
  it("never constructs a Date in SQL-bearing code", () => {
    expect(CLAIM_CODE).not.toContain("new Date(");
    expect(CLAIM_CODE).not.toContain("Date.now(");
  });

  it("uses now() for every timestamp it writes", () => {
    for (const clause of ["locked_at = now()", "published_at = now()", "failed_at = now()"]) {
      expect(CLAIM_CODE.replace(/\s+/g, " ")).toContain(clause);
    }
  });

  it("builds the lease from now() plus a parameterised interval", () => {
    const normalised = CLAIM_CODE.replace(/\s+/g, " ");

    expect(normalised).toContain("locked_until = now() + make_interval(secs =>");
    // Never `now() + ($n || ' seconds')::interval` — string-built
    // intervals are the concatenation this design forbids.
    expect(normalised).not.toContain("seconds')::interval");
  });

  it("reads the clock through a raw select, because Prisma cannot emit now()", async () => {
    const { tx, calls } = capture();
    tx.$queryRaw = jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ sql: strings.raw.join(" ? ").replace(/\s+/g, " ").trim(), values });
        return Promise.resolve([{ now: new Date("2026-08-21T00:00:00.000Z") }]);
      }
    ) as never;

    const now = await databaseNow(tx as never);

    expect(lastSql(calls)).toContain("SELECT now()");
    expect(now.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  });
});

describe("no SQL is assembled by string concatenation", () => {
  it("interpolates nothing but tagged-template parameters", () => {
    // A `${...}` inside a raw tagged template is a BOUND PARAMETER.
    // What must not appear is ordinary string building around SQL.
    expect(CLAIM_CODE).not.toMatch(/\$queryRawUnsafe|\$executeRawUnsafe/);
    expect(CLAIM_CODE).not.toMatch(/["'`]\s*\+\s*\w+\s*\+\s*["'`]/);
    expect(CLAIM_CODE).not.toMatch(/\.join\([^)]*\)\s*\}\s*`/);
  });

  it("binds the event-type allowlist rather than inlining it", async () => {
    const { tx, calls } = capture();

    await terminaliseExhausted(tx as never);

    expect(lastSql(calls)).toContain("event_type = ANY( ? )");
    // Asserted by membership, not by position: the bound values follow
    // template order, and asserting an index would break the moment a
    // SET clause is reordered.
    expect(calls[0].values).toContainEqual(["EMAIL_NOTIFICATION_V1"]);
    // The literal must not appear in the statement text itself.
    expect(lastSql(calls)).not.toContain("EMAIL_NOTIFICATION_V1");
  });
});

describe("terminalisation of exhausted rows", () => {
  it("only ever touches supported event types", async () => {
    const { tx, calls } = capture();

    await terminaliseExhausted(tx as never);

    expect(calls[0].values).toContainEqual(["EMAIL_NOTIFICATION_V1"]);
  });

  it("targets rows at or beyond the attempt budget", async () => {
    const { tx, calls } = capture();

    await terminaliseExhausted(tx as never);

    expect(lastSql(calls)).toContain("attempts >= ?");
    expect(calls[0].values).toContain(MAX_ATTEMPTS);
  });

  it("covers expired PROCESSING and plain PENDING, and nothing else", async () => {
    const { tx, calls } = capture();

    await terminaliseExhausted(tx as never);
    const sql = lastSql(calls);

    expect(sql).toContain("status = 'PROCESSING' AND locked_until < now()");
    expect(sql).toContain("OR status = 'PENDING'");
    expect(sql).not.toContain("status = 'PUBLISHED'");
  });

  it("writes FAILED with ATTEMPTS_EXHAUSTED", async () => {
    const { tx, calls } = capture();

    await terminaliseExhausted(tx as never);

    expect(lastSql(calls)).toContain("status = 'FAILED'");
    expect(calls[0].values).toContain("ATTEMPTS_EXHAUSTED");
  });

  it("clears every lease field and both scheduling stamps", async () => {
    const { tx, calls } = capture();

    await terminaliseExhausted(tx as never);
    const sql = lastSql(calls);

    for (const clause of [
      "locked_at = NULL",
      "locked_until = NULL",
      "locked_by = NULL",
      "claim_token = NULL",
      "next_attempt_at = NULL",
    ]) {
      expect(sql).toContain(clause);
    }
  });

  it("forces published_at to NULL — a retired row was never delivered", async () => {
    const { tx, calls } = capture();

    await terminaliseExhausted(tx as never);

    expect(lastSql(calls)).toContain("published_at = NULL");
  });
});

describe("the claim predicate", () => {
  async function claimSql() {
    const { tx, calls } = capture();
    await claimBatch(tx as never, { lockedBy: "worker-1" });
    return { sql: lastSql(calls), values: calls[0].values };
  }

  it("filters to the positive allowlist first", async () => {
    const { sql, values } = await claimSql();

    expect(sql).toContain("event_type = ANY( ? )");
    expect(values[0]).toEqual(["EMAIL_NOTIFICATION_V1"]);
  });

  it("refuses rows that have spent their attempt budget", async () => {
    const { sql, values } = await claimSql();

    // The reason terminalisation must run first: a row at the budget is
    // unclaimable here and would otherwise be stranded.
    expect(sql).toContain("attempts < ?");
    expect(values).toContain(MAX_ATTEMPTS);
  });

  it("takes PENDING rows whose deferral has elapsed", async () => {
    const { sql } = await claimSql();

    expect(sql).toContain(
      "status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= now())"
    );
  });

  it("recovers crashed rows via an expired lease, with no separate reaper", async () => {
    const { sql } = await claimSql();

    expect(sql).toContain("status = 'PROCESSING' AND locked_until < now()");
  });

  it("uses SKIP LOCKED so a second worker never blocks", async () => {
    const { sql } = await claimSql();

    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("orders by a TOTAL order, so batches are deterministic", async () => {
    const { sql } = await claimSql();

    expect(sql).toContain("ORDER BY created_at ASC, id ASC");
  });

  it("bounds the batch", async () => {
    const { sql, values } = await claimSql();

    expect(sql).toContain("LIMIT ?");
    expect(values).toContain(CLAIM_BATCH_SIZE);
  });

  it("increments attempts at claim, not at settlement", async () => {
    const { sql } = await claimSql();

    expect(sql).toContain("attempts = o.attempts + 1");
  });

  it("moves the row to PROCESSING and binds the worker id", async () => {
    const { sql, values } = await claimSql();

    expect(sql).toContain("status = 'PROCESSING'");
    expect(sql).toContain("locked_by = ?");
    expect(values).toContain("worker-1");
  });

  it("binds the lease length rather than inlining it", async () => {
    const { values } = await claimSql();

    expect(values).toContain(LEASE_SECONDS);
  });

  it("generates a fresh unguessable token per ROW, not per batch", async () => {
    const { sql } = await claimSql();

    // Not because a batch token would let one row settle another — every
    // settlement also matches on `id`. Per-row isolates each lease
    // attempt, keeps the blast radius of a leaked token to one row, and
    // stops any future change depending on a batch-shared token.
    expect(sql).toContain("claim_token = gen_random_uuid()");
  });

  it("honours caller-supplied batch size and lease", async () => {
    const { tx, calls } = capture();

    await claimBatch(tx as never, { lockedBy: "w", batchSize: 3, leaseSeconds: 45 });

    expect(calls[0].values).toContain(3);
    expect(calls[0].values).toContain(45);
  });
});

describe("what a claim returns", () => {
  it("returns only the closed set of columns the processor needs", async () => {
    const { tx } = capture();
    tx.$queryRaw = jest.fn(() =>
      Promise.resolve([
        {
          id: "row-1",
          event_type: "EMAIL_NOTIFICATION_V1",
          payload: { v: 1 },
          attempts: 3,
          claim_token: "token-1",
        },
      ])
    ) as never;

    const claimed = await claimBatch(tx as never, { lockedBy: "w" });

    expect(Object.keys(claimed[0]).sort()).toEqual(
      ["attempts", "claimToken", "eventType", "id", "payload"].sort()
    );
  });

  it("carries no recipient address, subject or rendered body", async () => {
    const { tx, calls } = capture();

    await claimBatch(tx as never, { lockedBy: "w" });

    // The payload itself holds no address — the relay resolves the
    // recipient at send time — and rendering happens downstream.
    const sql = lastSql(calls);
    expect(sql).not.toContain("subject");
    expect(sql).not.toContain("html");
    expect(sql).not.toContain("email");
  });

  it("returns the raw payload for the processor's validator, unparsed here", async () => {
    const { tx } = capture();
    tx.$queryRaw = jest.fn(() =>
      Promise.resolve([
        { id: "r", event_type: "EMAIL_NOTIFICATION_V1", payload: { anything: true }, attempts: 1, claim_token: "t" },
      ])
    ) as never;

    const claimed = await claimBatch(tx as never, { lockedBy: "w" });

    expect(claimed[0].payload).toEqual({ anything: true });
  });
});

describe("a pass terminalises before it claims", () => {
  it("issues the two statements in that order, in one transaction", async () => {
    const { tx, calls } = capture();
    const prisma = {
      $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    };

    await runClaimPass(prisma as never, { lockedBy: "worker-1" });

    expect(calls).toHaveLength(2);
    // The class is a BOUND VALUE, so it identifies the terminalisation
    // statement through its parameters rather than its text.
    expect(calls[0].values).toContain("ATTEMPTS_EXHAUSTED");
    expect(calls[0].sql).toContain("status = 'FAILED'");
    expect(calls[1].sql).toContain("FOR UPDATE SKIP LOCKED");
  });

  it("runs both against the same transaction client, hence one clock", async () => {
    const seen: unknown[] = [];
    const { tx } = capture();
    const prisma = {
      $transaction: (fn: (client: unknown) => Promise<unknown>) => {
        seen.push(tx);
        return fn(tx);
      },
    };

    await runClaimPass(prisma as never, { lockedBy: "w" });

    expect(seen).toHaveLength(1);
  });

  it("orders terminalisation first in the source, not merely at runtime", () => {
    const body = CLAIM_CODE.slice(CLAIM_CODE.indexOf("export async function runClaimPass"));

    expect(body.indexOf("terminaliseExhausted")).toBeLessThan(body.indexOf("claimBatch"));
  });
});

describe("settlement is conditioned on the claim token", () => {
  const CASES = [
    ["publish", (p: unknown) => settlePublished(p as never, "id-1", "token-1"), "'PUBLISHED'"],
    [
      "retry",
      (p: unknown) =>
        settleRetry(p as never, "id-1", "token-1", new Date("2026-08-21T00:00:00Z"), "PROVIDER_5XX"),
      "'PENDING'",
    ],
    ["fail", (p: unknown) => settleFailed(p as never, "id-1", "token-1", "PAYLOAD_INVALID"), "'FAILED'"],
  ] as const;

  it.each(CASES)("%s requires id, PROCESSING and the exact token", async (_label, run) => {
    const { tx, calls } = capture();

    await run(tx);
    const sql = lastSql(calls);

    expect(sql).toContain("WHERE id = ?");
    expect(sql).toContain("status = 'PROCESSING'");
    expect(sql).toContain("claim_token = ?");
    expect(calls[0].values).toContain("token-1");
  });

  it.each(CASES)("%s clears all four lease fields atomically", async (_label, run) => {
    const { tx, calls } = capture();

    await run(tx);
    const sql = lastSql(calls);

    for (const clause of [
      "locked_at = NULL",
      "locked_until = NULL",
      "locked_by = NULL",
      "claim_token = NULL",
    ]) {
      expect(sql).toContain(clause);
    }
  });

  it.each(CASES)("%s sets the expected terminal status", async (_label, run, status) => {
    const { tx, calls } = capture();

    await run(tx);

    expect(lastSql(calls)).toContain(`status = ${status}`);
  });

  it.each(CASES)("%s returns the affected row count, so zero cannot be ignored", async (_label, run) => {
    const { tx } = capture();

    // Zero rows means this attempt was superseded — never success.
    await expect(run(tx)).resolves.toBe(1);
  });

  it.each(CASES)("%s never conditions on locked_by", async (_label, run) => {
    // The same worker id can re-claim after a lease expiry, so matching
    // on it would let a superseded attempt overwrite a newer result.
    //
    // Asserted against the emitted WHERE clause rather than the whole
    // source: every settlement legitimately SETS locked_by = NULL, so a
    // source-wide search for the identifier proves nothing.
    const { tx, calls } = capture();

    await run(tx);
    const where = lastSql(calls).split(" WHERE ")[1];

    expect(where).toBeDefined();
    expect(where).not.toContain("locked_by");
    expect(where).toContain("claim_token");
  });
});

describe("settlement field hygiene", () => {
  it("publishing stamps published_at and clears the failure fields", async () => {
    const { tx, calls } = capture();

    await settlePublished(tx as never, "id-1", "token-1");
    const sql = lastSql(calls);

    expect(sql).toContain("published_at = now()");
    expect(sql).toContain("failed_at = NULL");
    expect(sql).toContain("error_class = NULL");
    expect(sql).toContain("next_attempt_at = NULL");
  });

  it("retrying binds the deferral and clears the terminal fields", async () => {
    const { tx, calls } = capture();
    const when = new Date("2026-08-21T01:00:00.000Z");

    await settleRetry(tx as never, "id-1", "token-1", when, "PROVIDER_TIMEOUT");
    const sql = lastSql(calls);

    expect(sql).toContain("next_attempt_at = ?");
    expect(calls[0].values).toContain(when);
    expect(sql).toContain("failed_at = NULL");
    expect(sql).toContain("published_at = NULL");
    expect(calls[0].values).toContain("PROVIDER_TIMEOUT");
  });

  it("failing stamps failed_at and clears the scheduling fields", async () => {
    const { tx, calls } = capture();

    await settleFailed(tx as never, "id-1", "token-1", "RECIPIENT_NOT_FOUND");
    const sql = lastSql(calls);

    expect(sql).toContain("failed_at = now()");
    expect(sql).toContain("next_attempt_at = NULL");
    expect(sql).toContain("published_at = NULL");
  });

  it("never writes last_error", () => {
    // Left untouched by design: a free-text column is exactly where a
    // provider exception message would end up.
    expect(CLAIM_CODE).not.toContain("last_error");
  });

  it("never writes an exception message into error_class", () => {
    expect(CLAIM_CODE).not.toMatch(/error_class\s*=\s*\$\{[^}]*message/);
    expect(CLAIM_CODE).not.toContain(".message");
  });
});
