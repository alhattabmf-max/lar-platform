import { readFileSync, readdirSync } from "fs";
import { join } from "path";

/**
 * Every raw `INSERT INTO` must name `updated_at` when the target table
 * requires it.
 *
 * Why this exists
 * ---------------
 * `outbox_events.updated_at` is NOT NULL with no database default:
 * Prisma satisfies it from `@updatedAt` in the CLIENT, so
 * `tx.outboxEvent.create()` works and a hand-written
 * `INSERT INTO outbox_events (...)` that omits the column fails with
 * Postgres 23502.
 *
 * `NotificationWriterService.insertEmailIntents` did exactly that. It
 * threw inside the payment webhook's transaction, which rolled back the
 * captured payment and the order it had just created — so no purchase
 * could complete at all. Unit tests passed throughout, because they
 * stub the transaction client and never reach Postgres.
 *
 * How it stays honest
 * -------------------
 * The list of tables that require the column is derived from
 * `schema.prisma`, not hardcoded: a model whose `updatedAt` field
 * carries no `@default(...)` needs the column supplied explicitly. Add
 * a model tomorrow and this guard covers it without being edited.
 */

const API_ROOT = join(__dirname, "..", "..", "..");
const SRC = join(API_ROOT, "src");
const SCHEMA = join(API_ROOT, "prisma", "schema.prisma");

/** `model Foo {` … `}` — one entry per model block. */
function modelBlocks(schema: string): { model: string; body: string }[] {
  const blocks: { model: string; body: string }[] = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(schema)) !== null) {
    blocks.push({ model: match[1], body: match[2] });
  }
  return blocks;
}

/**
 * The table name Postgres sees. Every model in this schema declares
 * `@@map`, so a model without one is not something raw SQL could be
 * referring to by a name this parser knows — it is skipped rather than
 * guessed at, and the anchor test below keeps that from silently
 * emptying the checked set.
 */
function tableNameOf(body: string): string | null {
  return body.match(/@@map\("([^"]+)"\)/)?.[1] ?? null;
}

/** Tables whose `updated_at` a raw INSERT must supply itself. */
function tablesRequiringUpdatedAt(): Set<string> {
  const schema = readFileSync(SCHEMA, "utf8");
  const required = new Set<string>();

  for (const { body } of modelBlocks(schema)) {
    const line = body.split("\n").find((l) => /^\s*updatedAt\s/.test(l));
    if (!line) continue;
    // A column with its own database default is filled by Postgres.
    if (/@default\(/.test(line)) continue;

    const table = tableNameOf(body);
    if (table) required.add(table);
  }
  return required;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.includes(".spec.") ? [full] : [];
  });
}

interface RawInsert {
  file: string;
  table: string;
  columns: string;
}

/** Every `INSERT INTO <table> ( <columns> )` written in the source. */
function rawInserts(): RawInsert[] {
  const found: RawInsert[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    const re = /INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      found.push({ file, table: match[1], columns: match[2] });
    }
  }
  return found;
}

describe("raw INSERT statements supply updated_at where the column demands it", () => {
  const required = tablesRequiringUpdatedAt();

  it("finds the tables that require it, from schema.prisma", () => {
    // Anchors the derivation: if this stops matching, the parser has
    // drifted from the schema and every assertion below is vacuous.
    expect(required.has("outbox_events")).toBe(true);
    expect(required.size).toBeGreaterThan(10);
  });

  it("finds raw INSERT statements to check", () => {
    expect(rawInserts().length).toBeGreaterThan(0);
  });

  it.each(
    rawInserts()
      .filter((insert) => tablesRequiringUpdatedAt().has(insert.table))
      .map((insert) => [insert.file.replace(SRC, "src"), insert.table, insert.columns] as const)
  )("%s — INSERT INTO %s names updated_at", (_file, _table, columns) => {
    expect(columns.split(",").map((c) => c.trim())).toContain("updated_at");
  });
});
