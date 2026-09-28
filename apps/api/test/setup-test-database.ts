/**
 * TESTS WRITE TO `platform_test`. NOTHING ELSE.
 *
 * WHAT WENT WRONG WITHOUT THIS. `apps/api/.env` points `DATABASE_URL`
 * at `platform_dev` — correctly, it is what the dev server reads — and
 * `@prisma/client` loads that file on import. Every suite that built a
 * `PrismaClient` therefore connected to the SAME database the owner
 * develops against, and no suite cleans up after itself. Measured on
 * 2026-09-15, after months of runs: 17,370 companies, 31,511 branches,
 * 23,408 cities, 15,655 regions, 8,075 taxonomy nodes, 8,607 offers,
 * 236 admin accounts — 252 MB. The marketplace page pulls the cities,
 * the regions and the whole category tree on every render, which came
 * to 5.7 MB and thirteen seconds. The platform was not slow; the
 * database it was reading was full of test debris.
 *
 * HOW THIS FIXES IT. `setupFiles` runs before the test module is
 * imported, and therefore before `@prisma/client` is imported and
 * loads `.env`. `dotenv` never overwrites a variable that is already
 * set, so assigning here WINS over the file — no edit to `.env`, and
 * the dev server keeps reading what it always read.
 *
 * AND THEN IT REFUSES. Setting the variable would be a convention, and
 * a convention is something a future config can forget. The assertion
 * below makes it a rule: if the URL this process will actually use
 * does not name a database on the allowed list, the suite throws here
 * rather than opening a connection. A test cannot write to
 * `platform_dev` because it cannot reach it.
 */

/** The one database the suites may build a default client against. */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://platform:platform@localhost:5432/platform_test?schema=public";

/**
 * Databases a test process is allowed to touch.
 *
 * `platform_test` is the shared one. The two prefixes belong to suites
 * that build their own throwaway database to prove something about a
 * FRESH install — `checkout-no-tariff-isolated` and
 * `upgrade-path-regression` — and drop it again at the end. They pass
 * their URL explicitly to their own `PrismaClient`, so they never rely
 * on the variable set here; the prefixes are listed so that a future
 * suite doing the same is not refused for doing the right thing.
 */
const ALLOWED_EXACT = ["platform_test"];
const ALLOWED_PREFIXES = ["platform_checkout_", "platform_upgrade_"];

function databaseNameOf(url: string): string {
  // `postgresql://user:pass@host:5432/NAME?schema=public` — the path,
  // without its leading slash and without the query.
  const path = url.split("?")[0];
  return path.slice(path.lastIndexOf("/") + 1);
}

function isAllowed(name: string): boolean {
  return (
    ALLOWED_EXACT.includes(name) ||
    ALLOWED_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

process.env.DATABASE_URL = TEST_DATABASE_URL;

const name = databaseNameOf(process.env.DATABASE_URL);
if (!isAllowed(name)) {
  throw new Error(
    [
      `Refusing to run tests against the database "${name}".`,
      "",
      "Tests may only write to platform_test (or a throwaway database a",
      "suite creates for itself). The development database holds the",
      "owner's own products, categories and offers, and no suite here",
      "cleans up after itself — a run against it is not recoverable by",
      "re-running anything.",
      "",
      `Allowed: ${ALLOWED_EXACT.join(", ")}, or a database named ${ALLOWED_PREFIXES.map((p) => `${p}*`).join(" / ")}.`,
      `Set TEST_DATABASE_URL to change where the suites point.`,
    ].join("\n")
  );
}

export {};
