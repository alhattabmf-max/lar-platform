# Deferred test debt

Known test defects that are recorded rather than fixed, with the reason
for deferring and what it would take to close them.

NOTHING HERE IS A PRODUCTION DEFECT. In every case the platform behaves
correctly and only the test is wrong about it — either because it cannot
run in this environment, or because it still describes a contract the
platform has since changed on purpose.

_Last reviewed: 2026-09-15._

---

## 1. ~~Isolated-database suites assume a POSIX shell~~ — PAID, 2026-09-15

**Files**

- `apps/api/test/scratch-database.ts` *(new)*
- `apps/api/test/checkout-no-tariff-isolated.integration-spec.ts`
- `apps/api/test/upgrade-path-regression.integration-spec.ts`

**What they do.** Both create a brand-new database, run
`prisma migrate deploy` into it, exercise something that can only be
seen on a fresh install, then drop it. The first proves that a
just-migrated system has NO shipping tariff configured and that checkout
refuses with `SHIPPING_TARIFF_NOT_CONFIGURED` before writing a single
row. The second replays the migration history in bounded ranges, runs
the financial-snapshot backfill and its verification gate against each
stage, and finishes by proving the upgraded database matches
`schema.prisma`.

**Why they used to fail, and it was TWO faults, not one.** They shelled
out with POSIX syntax — `PGPASSWORD=platform psql …` — which `cmd.exe`
reads as the name of a program. That was the recorded reason. The
second only became visible once the first was fixed: **there is no
`psql` on this host at all.** Postgres runs in a container here, so the
portable spelling would have had nothing to run either.

**How it was fixed.** By removing the shell from the path entirely,
which is what this note always prescribed. `CREATE DATABASE` and
`DROP DATABASE` are ordinary statements, and `test/scratch-database.ts`
issues them through a `PrismaClient` pointed at the maintenance
database — over the same connection every other test already uses. No
client to install, no password on a command line, no shell to disagree
about. `prisma migrate deploy` is a program and stays a child process,
but it is invoked through `execFileSync` with an argument list and an
explicit `env`, so nothing is parsed by a shell on any platform.

Two things were repaired in passing. The connection strings are now
DERIVED from `DATABASE_URL` rather than written out, so these suites
follow the `platform_test` redirection like everything else instead of
ignoring it. And the drop is `WITH (FORCE)`, so a suite that failed
halfway cannot leave a database that the next run can neither create
nor remove.

**What the Zero Drift assertion says now.** It required the diff to be
empty, and that stopped being true when the two registers gained
trigram indexes: `USING GIN (… gin_trgm_ops)` cannot be written in
Prisma's schema language, so those indexes live in their migrations
alone and the diff asks to drop them on every run. The assertion names
its accepted exceptions ONE BY ONE — four trigram indexes, and the
`company_locations.city_id` delete rule, which is §2's debt — and fails
on anything else. A rule like «ignore every DropIndex» would have
hidden the next real divergence.

**A third fault, found by fixing these.** With both suites really
running, the integration run went from 3 failures to 10 — all on the
money path, all «Transaction already closed: the timeout for this
transaction was 5000 ms». Not a regression: Prisma's interactive
transaction budget is a PRODUCTION setting doing its job, and two
suites deploying a hundred and twelve migrations apiece had made one
shared Postgres the bottleneck. `maxWorkers: 2` on the integration
config fixed it, and measured FASTER than the default — 213 s against
253 s — because these suites wait on one server rather than on the CPU.

**Result: 46 suites, 332 of 332 tests green, with no manual step.**

---

## 2. The E2E suite is behind several completed platform changes

**Scale.** 64 of 331 E2E cases fail, across 17 of 34 suites. The number
was **identical before and after** the DIRECT/GROUP work — that change
added no failure and fixed none of these.

**What they are.** Five families, none of which is a product defect:

| Family | What the tests still assume |
|---|---|
| Contract drift | list endpoints return an array (they return a paginated object); money is a number (it is a decimal string); trader/public opportunity field names as they were |
| Deleted endpoints | `financial.e2e` still exercises `admin/bank-accounts/{pending-review,approve,reject}` — a controller deliberately removed, its work folded into approving the company |
| The verification flow | `admin-operations` expects the old approve path: `approve` answers 409, `pending-suppliers` comes back empty |
| Banners / branding / images | an invalid `promotionalBanner.create` against the current schema, CORP header expectations, 404 where 400 was expected |
| Shared-database pollution | sorting and pagination cases expect their own three offers inside one page of a database holding hundreds |

**Why they are recorded rather than fixed.** Each family needs a
decision about what the test should now assert — which is a reading of
intent, not a mechanical repair. Rewriting the removed-endpoint suite in
particular means deciding what replaces it on the verification-request
path.

**What was already repaired** while the DIRECT work passed through:
registration payloads matched to the current `RegisterCompanyDto`, the
branch a registration no longer invents created explicitly, the supplier
verification flow driven through its real endpoints, `publishTestPolicy`
made idempotent (it used to invalidate every other suite's trader), and
a real `testTimeout` on both suites. That took E2E from 110 failures to
64.

**Deferred on 2026-09-15** by the owner's instruction: «لا تصلح مشاكل
E2E القديمة غير المرتبطة بهذا التغيير الآن».
