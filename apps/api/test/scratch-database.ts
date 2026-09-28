import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * CREATING AND DROPPING A DATABASE WITHOUT A SHELL.
 *
 * THE DEBT THIS PAYS OFF. Two integration suites build a brand-new
 * database, migrate into it, exercise something only a fresh install
 * shows, and drop it again. Both did it by shelling out:
 *
 *     PGPASSWORD=platform psql -h localhost -U platform -d postgres -c "…"
 *     DATABASE_URL="…" npx prisma migrate deploy
 *
 * and both failed on this project's own machine for two separate
 * reasons. `execSync` on Windows runs `cmd.exe`, which has no
 * `VAR=value command` form and reads `PGPASSWORD=platform` as the name
 * of a program. And `psql` is not installed on the host at all here —
 * Postgres runs in a container — so even the portable spelling would
 * have had nothing to run.
 *
 * NEITHER PROBLEM IS ABOUT THE DATABASE, and neither was ever evidence
 * that a fresh install misbehaves. They were about how the tests asked
 * for one.
 *
 * SO NOTHING SHELLS OUT ANY MORE. `CREATE DATABASE` and `DROP DATABASE`
 * are ordinary statements; a `PrismaClient` pointed at the maintenance
 * database issues them, over the connection every other test already
 * uses. There is no client to install, no password on a command line,
 * and no shell to disagree about.
 *
 * `prisma migrate deploy` still runs as a child process — it is a
 * program, not a statement — but its environment goes through
 * `execFileSync`'s own `env` option rather than through shell syntax,
 * and `execFileSync` takes an argument list so nothing is parsed by a
 * shell at all.
 */

/**
 * Where `CREATE DATABASE` is issued from.
 *
 * Derived from `DATABASE_URL` so it follows whatever host, port and
 * credentials the suite is already running against — including the
 * `platform_test` redirection that `setup-test-database.ts` installs —
 * rather than hard-coding localhost the way the shell commands did.
 */
function maintenanceUrl(): string {
  const configured = process.env.DATABASE_URL;
  if (!configured) {
    throw new Error("scratch-database: DATABASE_URL is not set");
  }
  const url = new URL(configured);
  url.pathname = "/postgres";
  // `schema` is a Prisma-specific parameter and means nothing to the
  // maintenance database; anything else on the query string (SSL, pool
  // settings) is kept.
  url.searchParams.delete("schema");
  return url.toString();
}

/** The connection string for a scratch database beside the current one. */
export function scratchUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = `/${name}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

/**
 * An identifier safe to interpolate into DDL.
 *
 * `CREATE DATABASE` takes no bind parameters — the name has to be in
 * the statement text — so the name is restricted to a shape that cannot
 * carry anything else. Every caller passes a literal; this is here so
 * that stays true if one ever passes a variable.
 */
function assertPlainName(name: string): void {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`scratch-database: refusing unusual database name "${name}"`);
  }
}

async function withMaintenance<T>(run: (client: PrismaClient) => Promise<T>): Promise<T> {
  const client = new PrismaClient({ datasources: { db: { url: maintenanceUrl() } } });
  try {
    return await run(client);
  } finally {
    await client.$disconnect();
  }
}

/** Drops the database if it is there. Safe to call when it is not. */
export async function dropScratchDatabase(name: string): Promise<void> {
  assertPlainName(name);
  await withMaintenance(async (client) => {
    // FORCE, because a suite that failed halfway may have left a
    // connection open and `DROP DATABASE` refuses while one exists —
    // which would leave the next run failing on a database it cannot
    // create and cannot remove. Postgres 13 and later.
    await client.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });
}

/** Drops and recreates the database, empty. */
export async function createScratchDatabase(name: string): Promise<string> {
  assertPlainName(name);
  await dropScratchDatabase(name);
  await withMaintenance(async (client) => {
    await client.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  });
  return scratchUrl(name);
}

/**
 * Runs the migration history into a database.
 *
 * `npx prisma migrate deploy` is a program and stays a child process,
 * but it is invoked with an argument LIST and an explicit environment:
 * no shell parses any of this, on any platform.
 */
export function migrateInto(url: string, options: { cwd: string; schema?: string }): void {
  const args = ["prisma", "migrate", "deploy"];
  if (options.schema) args.push("--schema", options.schema);

  execFileSync("npx", args, {
    cwd: options.cwd,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
    // npx on Windows is a .cmd, which cannot be executed directly.
    shell: process.platform === "win32",
  });
}
