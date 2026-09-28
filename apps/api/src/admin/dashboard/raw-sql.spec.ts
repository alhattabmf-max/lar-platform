import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The raw SQL on these screens, checked for the two faults that reached
 * production and the one that stopped the file compiling.
 *
 * WHY A SOURCE TEST. Every service test in this directory injects a
 * mock, so no query text is ever sent anywhere — which is exactly how a
 * query that could not run shipped. These queries were then executed by
 * hand against the real database; what is pinned here is the SHAPE, so
 * the same mistakes cannot come back unnoticed.
 */

const DIR = __dirname;

function services(): { name: string; source: string }[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".service.ts"))
    .map((name) => ({ name, source: readFileSync(join(DIR, name), "utf8") }));
}

/**
 * Every `$queryRaw` template in a file, with its contents.
 *
 * Stops at the FIRST backtick, because that is exactly where the
 * template ends as far as the parser is concerned — which is the point
 * the backtick test below makes.
 */
function rawQueries(source: string): string[] {
  return [...source.matchAll(/\$queryRaw<[^>]*>`([^`]*)`/g)].map(
    (match) => match[1],
  );
}

/** SQL comment lines, wherever they appear. */
function sqlComments(source: string): string[] {
  return source.split("\n").filter((line) => /^\s*--\s/.test(line));
}

describe("the raw SQL these screens depend on", () => {
  it("finds the queries to check", () => {
    // A guard against this suite passing because the scan found none.
    const total = services().reduce(
      (sum, file) => sum + rawQueries(file.source).length,
      0,
    );
    expect(total).toBeGreaterThan(5);
  });

  it("casts an enum column before comparing it with bound parameters", () => {
    // THE FAULT: `d.status NOT IN (${Prisma.join(...)})` sends TEXT
    // parameters against a PostgreSQL enum column, and there is no
    // implicit operator between them. It failed at run time with
    // "operator does not exist: DisputeStatus <> text" — and neither
    // TypeScript nor the build could see it, because the query is a
    // string until Postgres reads it.
    for (const file of services()) {
      for (const query of rawQueries(file.source)) {
        const comparisons = [
          ...query.matchAll(/(\w+\.status)\s*(?:NOT\s+)?IN\s*\(\$\{/g),
        ];
        for (const [, column] of comparisons) {
          expect({ file: file.name, column, query }).toMatchObject({
            query: expect.stringContaining(`${column}::text`),
          });
        }
      }
    }
  });

  it("never reaches a refund through a column it does not have", () => {
    // THE OTHER FAULT: `refund_obligations` has no `order_allocation_id`
    // at all. It carries `payment_attempt_id`, which the order carries
    // too — and it is also reachable from `refund_attempts` by its own
    // id, which is how the refunded total gets there. Both are correct;
    // the allocation is the one that does not exist.
    for (const file of services()) {
      for (const query of rawQueries(file.source)) {
        if (!query.includes("refund_obligations")) continue;
        expect({ file: file.name, query }).toMatchObject({
          query: expect.not.stringMatching(
            /refund_obligations\s+\w+\s+ON\s+\w+\.order_allocation_id/,
          ),
        });
      }
    }
  });

  it("carries no backtick in an SQL comment, which would end the template", () => {
    // A backtick in an SQL comment closes the tagged template and the
    // file stops parsing — with an error pointing at the line AFTER it
    // rather than at the comment. Identifiers go in prose above the
    // query, where backticks are legal.
    for (const file of services()) {
      const offenders = sqlComments(file.source).filter((line) =>
        line.includes("`"),
      );
      expect({ file: file.name, offenders }).toMatchObject({ offenders: [] });
    }
  });

  it("buckets a chart by the window's own start, never by a calendar week", () => {
    // THE FAULT: `date_trunc('week', created_at)` always returns a
    // MONDAY, while the bucket array in `dashboard-period.ts` starts
    // wherever the window starts — a Thursday for the 90-day window.
    // The two key spaces never met, so every real order fell outside
    // the chart and both graphs drew flat zeros over live data. It was
    // silent: the query ran, returned rows, and every row was discarded
    // by a Map lookup that missed.
    //
    // The replacement divides elapsed seconds by the bucket length,
    // which is the same arithmetic the array performs — so the two
    // cannot disagree.
    for (const file of services()) {
      for (const query of rawQueries(file.source)) {
        if (!/AS bucket/i.test(query)) continue;

        // The file name rides in the VALUE, because a bare regex
        // failure names neither the query nor the service it came from.
        expect(`${file.name}: ${query}`).not.toMatch(/date_trunc\(/i);
        expect(`${file.name}: ${query}`).toMatch(/FLOOR\(EXTRACT\(EPOCH FROM/i);
      }
    }
  });

  it("bounds every window query at both ends, half-open", () => {
    // A closed range double-counts anything landing exactly on the
    // boundary; an unbounded one scans the whole table.
    for (const file of services()) {
      for (const query of rawQueries(file.source)) {
        if (!query.includes("created_at >=")) continue;
        expect(query).toMatch(/created_at\s*<\s*\$\{/);
      }
    }
  });

  it("interpolates no user-supplied string into the SQL text", () => {
    // Everything variable is a bound parameter or a Prisma helper: a
    // search term spliced into a query is how one becomes an injection.
    for (const file of services()) {
      for (const query of rawQueries(file.source)) {
        for (const [, expression] of query.matchAll(/\$\{([^}]*)\}/g)) {
          const safe =
            expression.includes("new Date(") ||
            expression.includes("Prisma.join") ||
            // NAMED ONE BY ONE, never matched by a loose pattern. Each
            // of these is a local holding a value the service computed
            // itself — `from` is the window's start as a Date, `step`
            // is the bucket length in seconds from `bucketSeconds`,
            // `MAX_CASES_PER_SOURCE` is the follow-up board's per-queue
            // ceiling — and none of them is reachable from a request
            // body. A rule like "any short identifier" would let the next one
            // through without anybody deciding it should be.
            /^\s*(granularity|REPEATED_FAILURE_THRESHOLD|MAX_CASES_PER_SOURCE|from|step)\s*$/.test(
              expression,
            ) ||
            expression.includes('=== "daily"');
          expect({ file: file.name, expression, safe }).toMatchObject({
            safe: true,
          });
        }
      }
    }
  });
});
