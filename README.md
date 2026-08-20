# FORSA Platform Monorepo — Phases 1–7 (7A–7E complete)

> Commercial name not yet finalized. Internally referred to as `PROJECT_NAME`
> everywhere in code, per the Blueprint's branding rule.

## Prerequisites

- Node.js `22.22.2` (see `.nvmrc`) — `nvm use`
- pnpm `9.15.0` (pinned in `package.json` → `packageManager`, activated via Corepack: `corepack enable`)
- Docker + Docker Compose (for PostgreSQL, Redis, MinIO) — or equivalent
  local services (see note below)

> **Local execution note:** this project has been built and verified,
> across every phase through 7E, in an environment without a Docker
> daemon available. PostgreSQL, Redis, and MinIO were run as native
> local services instead, using the exact same versions and ports
> `docker-compose.yml` defines. `docker-compose.yml` remains the
> official way to run local infrastructure and has not been changed
> to work around that constraint.
>
> `docker build` for `apps/api` and `apps/worker` is exercised for
> real — including an image smoke test (`/health` for the API, boot +
> graceful shutdown for the worker) — in CI (`.github/workflows/ci.yml`),
> which runs on GitHub-hosted runners that do have Docker available.
> This is the authoritative place those images are actually built and
> verified; see `docs/PHASE_5_FINAL_VERIFICATION_REPORT.md` for the
> historical record of the Phase 1–5 local verification approach.

## First-time setup

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm --filter api run prisma:generate
pnpm --filter api run prisma:migrate
```

## Running locally

```bash
pnpm run dev:api      # http://localhost:3000  (health: /health, /ready)
pnpm run dev:web      # http://localhost:3001
pnpm run dev:worker
```

## Quality checks (same as CI)

```bash
pnpm run lint
pnpm run typecheck
pnpm run test          # unit tests across every app/package, including packages/domain
pnpm --filter api run test:e2e
pnpm --filter api run test:integration    # includes the permanent upgrade-path regression test
pnpm --filter worker run test:integration
pnpm run build          # always cleans dist/ and stale .tsbuildinfo first — see `clean` script
```

## Database backup / restore

See [`scripts/db/README.md`](./scripts/db/README.md) for the
`backup-db.sh` / `restore-db.sh` / `verify-backup.sh` scripts —
custom-format `pg_dump`, SHA-256 checksums, restore-to-new-database-only
by default, no credentials ever logged.

## Project layout & documentation

Start at [`docs/README.md`](./docs/README.md) — the documentation index.

Directly useful links:

- [`docs/architecture.md`](./docs/architecture.md) — full architecture
  across Phases 1–7: Auth, Companies, Products, Opportunities, Checkout,
  Payment/Ledger, Fulfillment, Disputes, Replacement, Refunds,
  Settlement, and Internal Invoice Drafts.
- [`docs/pdpl-readiness.md`](./docs/pdpl-readiness.md) — PDPL design posture.
- [`docs/error-codes.md`](./docs/error-codes.md) — error code catalogue.
- [`docs/admin-security.md`](./docs/admin-security.md) — admin auth/2FA/session design.
- [`docs/PHASE_5_FINAL_VERIFICATION_REPORT.md`](./docs/PHASE_5_FINAL_VERIFICATION_REPORT.md) — historical Phase 1–5 verification record.

## Billing status (important, read before assuming otherwise)

All invoicing documents produced by this platform today are
**`INTERNAL_PRODUCT_DRAFT` / `INTERNAL_COMMISSION_DRAFT` /
`INTERNAL_ADJUSTMENT_DRAFT`** — internal records only, each explicitly
carrying `documentPurpose: "NOT_A_TAX_INVOICE"`. There is **no ZATCA
integration** (no clearance, no reporting, no QR code) in this phase.
See `docs/architecture.md` for the full explanation of why, and what
changes when real tax invoicing is added later.
