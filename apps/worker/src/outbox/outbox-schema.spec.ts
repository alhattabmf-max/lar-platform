import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards on the schema and migration 89 that can be checked without a
 * database.
 *
 * The enum-cardinality test is the one that matters most: the CHECK
 * constraint in migration 89 is written by EXCLUSION — it lists the
 * pre-existing statuses and negates them — because PostgreSQL forbids
 * using a newly added enum label in the transaction that added it. That
 * formulation is exact today and would silently mis-classify any FUTURE
 * status as one that must carry a lease. This test is what turns that
 * latent trap into a build failure.
 */

const REPO = join(__dirname, "..", "..", "..", "..");
const SCHEMA_PATH = join(REPO, "apps", "api", "prisma", "schema.prisma");
const MIGRATIONS_DIR = join(REPO, "apps", "api", "prisma", "migrations");
const MIGRATION_89 = "20260824000100_8d0_add_outbox_relay_fields";

const schema = readFileSync(SCHEMA_PATH, "utf8");
const migration = readFileSync(join(MIGRATIONS_DIR, MIGRATION_89, "migration.sql"), "utf8");

function enumValues(name: string): string[] {
  const match = schema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
  if (!match) throw new Error(`enum ${name} not found in schema.prisma`);
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
}

describe("OutboxStatus cardinality guard", () => {
  it("is exactly the four expected values", () => {
    // Adding a fifth MUST fail here, because migration 89's CHECK
    // constraint would place it in the "must be leased" branch.
    expect(enumValues("OutboxStatus").sort()).toEqual(
      ["PENDING", "PROCESSING", "PUBLISHED", "FAILED"].sort()
    );
  });

  it("contains PROCESSING, the in-flight state crash recovery depends on", () => {
    expect(enumValues("OutboxStatus")).toContain("PROCESSING");
  });

  it("has exactly four values, no more", () => {
    expect(enumValues("OutboxStatus")).toHaveLength(4);
  });
});

describe("migration 89 — structure", () => {
  it("adds PROCESSING to the enum", () => {
    expect(migration).toContain(`ALTER TYPE "OutboxStatus" ADD VALUE 'PROCESSING'`);
  });

  it.each([
    "next_attempt_at",
    "locked_at",
    "locked_until",
    "locked_by",
    "claim_token",
    "error_class",
    "failed_at",
  ])("adds the %s column", (column) => {
    expect(migration).toContain(`ADD COLUMN "${column}"`);
  });

  it("adds exactly seven columns", () => {
    // Comments stripped first: the file's own prose mentions ADD COLUMN
    // when explaining what is and is not metadata-only, and counting
    // that would be counting documentation.
    const sql = migration.replace(/--.*$/gm, "");

    expect(sql.match(/ADD COLUMN/g)).toHaveLength(7);
  });

  it("creates the claim index on the full predicate", () => {
    expect(migration.replace(/\s+/g, " ")).toContain(
      `CREATE INDEX "outbox_events_claim_idx" ON "outbox_events" ("event_type", "status", "next_attempt_at", "locked_until")`
    );
  });

  it("creates the failed index as a PARTIAL index", () => {
    expect(migration.replace(/\s+/g, " ")).toContain(
      `CREATE INDEX "outbox_events_failed_idx" ON "outbox_events" ("status", "failed_at") WHERE "status" = 'FAILED'`
    );
  });
});

describe("migration 89 — historical rows are untouched", () => {
  it("issues no UPDATE, no backfill and no DELETE", () => {
    const sql = migration.replace(/--.*$/gm, "");

    expect(sql).not.toMatch(/\bUPDATE\b/);
    expect(sql).not.toMatch(/\bDELETE\b/);
    expect(sql).not.toMatch(/\bINSERT\b/);
  });

  it("gives no new column a DEFAULT, so the table is not rewritten", () => {
    const sql = migration.replace(/--.*$/gm, "");

    expect(sql).not.toMatch(/ADD COLUMN[^,;]*DEFAULT/i);
  });

  it("declares no new column NOT NULL", () => {
    const sql = migration.replace(/--.*$/gm, "");

    expect(sql).not.toMatch(/ADD COLUMN[^,;]*NOT NULL/i);
  });
});

describe("migration 89 — the lease CHECK constraint", () => {
  const constraint = migration.slice(migration.indexOf("ADD CONSTRAINT")).replace(/\s+/g, " ");

  it("is named and added to outbox_events", () => {
    expect(migration).toContain(`ADD CONSTRAINT "outbox_events_lease_all_or_none" CHECK`);
  });

  it("never names the newly added PROCESSING label", () => {
    // Naming it would fail with "unsafe use of new value of enum type",
    // because ALTER TYPE ADD VALUE runs in this same transaction.
    expect(constraint).not.toContain("PROCESSING");
  });

  it("uses no ::text cast to sidestep that restriction", () => {
    expect(constraint).not.toContain("::text");
  });

  it("lists the three pre-existing labels and negates them", () => {
    expect(constraint).toContain(`"status" IN ('PENDING','PUBLISHED','FAILED')`);
    expect(constraint).toContain(`"status" NOT IN ('PENDING','PUBLISHED','FAILED')`);
  });

  it.each(["claim_token", "locked_at", "locked_until", "locked_by"])(
    "requires %s NULL on the non-leased branch and NOT NULL on the leased branch",
    (column) => {
      expect(constraint).toContain(`"${column}" IS NULL`);
      expect(constraint).toContain(`"${column}" IS NOT NULL`);
    }
  );

  it("constrains exactly the four lease columns", () => {
    const nullChecks = [...constraint.matchAll(/"(\w+)" IS NULL/g)].map((m) => m[1]);

    expect([...new Set(nullChecks)].sort()).toEqual(
      ["claim_token", "locked_at", "locked_until", "locked_by"].sort()
    );
  });

  it("explains why it is written by exclusion", () => {
    // The reasoning must survive in the file; a future maintainer
    // "simplifying" it to `status = 'PROCESSING'` would break the
    // migration on a fresh database.
    expect(migration).toMatch(/unsafe use of|newly added|new value of enum/i);
  });
});

describe("migration 89 — placement in the sequence", () => {
  const directories = readdirSync(MIGRATIONS_DIR).filter((entry) =>
    statSync(join(MIGRATIONS_DIR, entry)).isDirectory()
  );

  it("occupies position 89 in the sequence", () => {
    // Asserted by POSITION, not by "is last": migration 90 lands in 8D
    // and later phases add more, so a last-element assertion would
    // break on every subsequent migration for no real reason.
    const sorted = [...directories].sort();

    expect(sorted.indexOf(MIGRATION_89)).toBe(88);
    expect(sorted).toHaveLength(directories.length);
  });

  it("follows the 8C banners migration immediately", () => {
    const sorted = [...directories].sort();
    const index = sorted.indexOf(MIGRATION_89);

    expect(sorted[index - 1]).toBe("20260823000100_8c_create_promotional_banners");
  });

  it("gives every migration directory exactly one migration.sql", () => {
    for (const dir of directories) {
      expect(readdirSync(join(MIGRATIONS_DIR, dir))).toEqual(["migration.sql"]);
    }
  });
});

/**
 * Two database objects are owned by the MIGRATION, not by
 * `schema.prisma`, because Prisma 5 can represent neither:
 *
 *   outbox_events_failed_idx        a PARTIAL index (WHERE status = 'FAILED')
 *   outbox_events_lease_all_or_none a CHECK constraint
 *
 * They are deliberately not downgraded to weaker forms Prisma could
 * express. The consequences to hold in mind:
 *
 *  - `prisma migrate diff` may report these two as a difference. That
 *    output must NOT be treated as a blanket pass/fail gate: CI has to
 *    separate these two KNOWN migration-owned objects from any other
 *    drift, and fail on anything else.
 *  - CI must additionally assert them positively against the catalog —
 *    `pg_indexes.indexdef` for the partial predicate and
 *    `pg_constraint.consrc`/`pg_get_constraintdef` for the CHECK —
 *    because a diff that ignores them proves only that they were
 *    ignored, not that they exist.
 *  - Neither can be verified here: both need a live database.
 *
 * The guard below is what CAN be checked offline: no later migration
 * may drop either object.
 */
describe("migration-owned database objects survive later migrations", () => {
  const MIGRATION_OWNED = ["outbox_events_failed_idx", "outbox_events_lease_all_or_none"];

  const laterMigrations = readdirSync(MIGRATIONS_DIR)
    .filter((entry) => statSync(join(MIGRATIONS_DIR, entry)).isDirectory())
    .filter((entry) => entry > MIGRATION_89);

  it.each(MIGRATION_OWNED)("no later migration drops %s", (objectName) => {
    const offenders = laterMigrations.filter((dir) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8").replace(
        /--.*$/gm,
        ""
      );
      // Matches DROP INDEX / DROP CONSTRAINT naming the object, quoted
      // or bare. Deliberately narrow: a broad "mentions the name"
      // search would fire on a legitimate re-creation.
      return new RegExp(`DROP\\s+(INDEX|CONSTRAINT)[^;]*"?${objectName}"?`, "i").test(sql);
    });

    expect(offenders).toEqual([]);
  });

  it.each(MIGRATION_OWNED)("%s is created by migration 89", (objectName) => {
    expect(migration).toContain(objectName);
  });

  it("records that these two are not representable in schema.prisma", () => {
    // If a future Prisma version gains partial indexes or CHECK
    // constraints, this expectation is the prompt to move them into the
    // schema and retire the special case.
    expect(schema).not.toContain("outbox_events_failed_idx");
    expect(schema).not.toContain("outbox_events_lease_all_or_none");
  });
});

describe("schema.prisma matches migration 89", () => {
  const model = schema.slice(schema.indexOf("model OutboxEvent"));
  const body = model.slice(0, model.indexOf("\n}"));

  it.each([
    ["nextAttemptAt", "next_attempt_at"],
    ["lockedAt", "locked_at"],
    ["lockedUntil", "locked_until"],
    ["lockedBy", "locked_by"],
    ["claimToken", "claim_token"],
    ["errorClass", "error_class"],
    ["failedAt", "failed_at"],
  ])("declares %s mapped to %s", (field, column) => {
    expect(body).toMatch(new RegExp(`${field}\\s+\\S+\\?\\s+@map\\("${column}"\\)`));
  });

  it("declares every new field nullable", () => {
    for (const field of [
      "nextAttemptAt",
      "lockedAt",
      "lockedUntil",
      "lockedBy",
      "claimToken",
      "errorClass",
      "failedAt",
    ]) {
      expect(body).toMatch(new RegExp(`${field}\\s+\\w+\\?`));
    }
  });

  it("types claimToken as a uuid, matching the column", () => {
    expect(body).toMatch(/claimToken\s+String\?\s+@map\("claim_token"\)\s+@db\.Uuid/);
  });

  it("declares the claim index with the same name the migration creates", () => {
    expect(body).toContain('map: "outbox_events_claim_idx"');
  });

  it("keeps the pre-existing status index", () => {
    expect(body).toContain("@@index([status])");
  });
});
