# Architecture — Phases 1–7 (7A–7E complete)

> This document was originally written for Phase 1 and has been
> extended in place as each later phase shipped — the Phase 1
> sections below (stack, Error Envelope, timezone strategy, UUID
> strategy, health/readiness, PDPL/PCI posture) are still accurate
> and unchanged. A new "Phases 2–7" section follows them, covering
> everything built since.

## Stack

```text
Responsive Web (Next.js + next-intl)
↓
REST API — /api/v1 (NestJS Modular Monolith)
↓
PostgreSQL (Prisma) — source of truth for money, quantities, state
↓
Redis (BullMQ workers — introduced from a later phase onward)
↓
Object Storage (MinIO locally, any S3-compatible provider in production)
↓
Provider Adapters (Email, Maps — real providers plug in behind existing interfaces)
```

## Monorepo layout

- `apps/api` — NestJS backend, owns all business logic and the database.
- `apps/web` — Next.js frontend. No business logic lives here; it calls the API.
- `apps/worker` — background job processor. Phase 1: connects to Redis only, no jobs registered yet.
- `packages/types` — TypeScript types shared by api and web, notably the Error Envelope contract.
- `packages/config` — Zod-validated environment variable loader shared by api and worker.

## Request ID strategy

`X-Request-ID` is captured or generated in `main.ts` via pino-http's
`genReqId`, applied with `app.use(...)` as the very first Express
middleware — before Nest routing, guards, pipes, and controllers. A
second small middleware mirrors the resolved id onto the
`X-Request-ID` response header for every response. Every log line and
every error response therefore carries the same id, with no code path
able to skip it.

## Error Envelope contract

Every error response from the API has this shape:

```json
{
  "error": { "code": "VALIDATION_FAILED", "message": "...", "details": {} },
  "requestId": "...",
  "timestamp": "..."
}
```

`code` is the only field the web app's i18n layer keys off to choose
the localized (ar-SA/en-SA) message shown to the user. `message` is an
English, developer-facing default for logs and non-i18n API
consumers — it must never be rendered directly to end users. See
`docs/error-codes.md` for the full catalogue.

## Timezone strategy

All timestamps are stored in the database as `timestamptz` (UTC). The
Node process itself always runs with `TZ=UTC`. `DEFAULT_DISPLAY_TIMEZONE`
(`Asia/Riyadh` by default) is applied only at the presentation layer
when formatting a stored UTC timestamp for a human to read. No
timezone conversion happens inside business logic or the database.

## Database user privileges

`prisma migrate dev` (used only during local development to author new
migrations) needs `CREATEDB` on the database user, because it creates
a temporary shadow database to detect drift. This privilege is
**development/migration-only**. The application's runtime database
user must never have `CREATEDB` by default — it is not needed to run
the app, execute already-written migrations (`prisma migrate deploy`
does not require a shadow database), or serve any request path.
Production deployments should use two distinct credentials: one
elevated, short-lived credential to run `prisma migrate deploy` during
release, and a separate, minimally-privileged credential
(`SELECT`/`INSERT`/`UPDATE`/`DELETE` on application tables only) for
the running API/worker processes.

## UUID strategy

Primary keys are generated at the PostgreSQL level via
`gen_random_uuid()` (built into Postgres core since v13 — no extension
required), not by the Prisma client. Reasons, in order of importance:

1. **One rule, enforced by the database.** Uniqueness holds even for rows
   inserted outside Prisma (raw SQL, admin scripts, a future service in
   another language) — there is exactly one place the ID format is
   decided, not one per client.
2. **Safe to merge across replicas/services** without a central counter —
   relevant once Settlements, Outbox processing, or a future mobile
   backend generate related records independently.
3. **Non-sequential IDs also happen to avoid exposing business volume**
   (order counts, etc.) — a side benefit, not the primary justification.

## Health vs. Readiness

- `GET /health` — liveness only. Always 200 if the process can respond,
  regardless of any dependency's state.
- `GET /ready` — readiness. PostgreSQL is a **blocking** dependency in
  Phase 1: `/ready` returns 503 if it is unreachable. Redis and MinIO
  are reported as informational/non-blocking checks in the response
  body in Phase 1, because no request path in `apps/api` depends on
  them yet. **This is a Phase 1-specific fact, not a permanent rule** —
  a dependency becomes blocking once a real request path in that phase
  actually relies on it (e.g. Redis once queue-backed checkout ships).

## Object Storage isolation

All file I/O goes through `StorageService` (`apps/api/src/storage`), which
wraps `@aws-sdk/client-s3` pointed at MinIO. Swapping to any other
S3-compatible provider in production is an environment variable change
only — no application code changes.

## Provider adapters (Phase 1 defaults)

- **Email** — `EMAIL_PROVIDER_MODE=mock`. Logs the send attempt; sends nothing.
- **Maps** — `MAP_PROVIDER_MODE=manual`. Accepts human-entered coordinates;
  registration and location entry are never blocked by a missing map provider.

Both are bound behind interfaces (`EmailProvider`, `MapsProvider`) so a real
provider can be added later without touching calling code.

## PDPL readiness (design posture, not yet enforced by code in Phase 1)

See `docs/pdpl-readiness.md`.

## PCI-DSS boundary

The platform never stores or processes raw card data. All payment
collection happens through a Payment Provider Adapter (introduced in
a later phase) that redirects to or tokenizes via a licensed payment
provider — card numbers, CVVs, and expiry dates never reach platform
servers or the database in any form. This boundary is a Phase 1
architectural commitment even though no payment code exists yet.

## Phases 2–7: the full business system

Everything below was built after Phase 1's foundation and runs on top
of it — same Error Envelope, same timezone/UUID rules, same
Health/Readiness split, same provider-adapter pattern.

### The core commercial relationship (read this first)

**The supplier is the legal seller.** FORSA is an intermediary/broker
— it never buys or resells product itself. The trader (buyer) pays
FORSA at checkout; FORSA holds the funds, then settles the supplier's
net payable (product revenue minus commission and its tax) once the
order is delivered and past its dispute window. Shipping is tracked
as a **separate line item throughout** — it is never mixed into the
supplier's payable calculation, the commission base, or a dispute
refund's product-share math. This separation is enforced at the
database level (CHECK constraints and triggers), not just in
application code — see "Financial snapshot and settlement formulas"
below.

### Auth, Companies, Products, Opportunities (Phases 2–6)

- **Auth**: session-cookie based (`sid` for trader/supplier accounts,
  `asid` for admin), with CSRF enforced via Origin/Referer matching
  against `CORS_ALLOWED_ORIGINS` for every state-changing request.
  Admin accounts require full TOTP 2FA enrollment before any
  privileged action — see `docs/admin-security.md`.
- **Companies**: trader and supplier accounts each have a `Company`
  row (`accountType: TRADER | SUPPLIER`), verification status, and
  company-scoped locations, contacts, and (for suppliers) bank
  accounts and tax/invoicing profiles.
- **Products & approval**: suppliers submit products for admin
  approval. Once approved, a `ProductApprovalSnapshot` freezes the
  approved state — later product edits never retroactively change an
  already-published Opportunity's terms.
- **Opportunities**: a supplier's fundable listing (product, quantity,
  unit price, share tiers, commission policy version, shipping tariff
  policy version — all frozen at the version in effect at creation).
  A background worker (`apps/worker`) sweeps opportunities whose
  funding window has expired.

### Checkout (Phase 7B)

A trader locks a quantity of an Opportunity across one or more of
their company's delivery locations (`CheckoutLocationAllocation`,
supporting **multi-branch orders** — one checkout, several delivery
addresses, each with its own shipping tier and fee). The lock is
time-boxed (`lockExpiresAt`); a worker sweep releases expired locks
back to the Opportunity's available quantity. A `QuoteSnapshot`
freezes the exact price/tax/shipping breakdown the trader is about to
pay — nothing about the price can drift between quote and payment.

Every checkout-session creation and payment-attempt start is
idempotent via a mandatory `Idempotency-Key` header, backed by a
generic `idempotency_keys` table (scope + key + request hash):
replaying the same request returns the same result; the same key with
a different payload is rejected with 409.

### Payment, Capture, and the Ledger (Phase 7C)

Payment is provider-abstracted (`PaymentProvider` interface,
`MockPaymentProvider` today) — card data never touches FORSA's
servers. A signed webhook confirms capture. On successful capture,
**inside the same database transaction**:

- The `TraderTaxProfile` is re-read and locked (`SELECT ... FOR
  UPDATE`) and frozen onto the `MasterOrder` as
  `traderTaxProfileSnapshot` / `traderBillingLegalNameSnapshot` — the
  read at payment-*start* time is never trusted; only the read at
  capture time is authoritative. If the trader's tax profile is
  incomplete at capture time, the payment is refunded
  (`TRADER_TAX_PROFILE_INCOMPLETE`) and no order is created.
- `OrderAllocationFinancialSnapshot` rows are created per allocation
  (per delivery branch), freezing the product/tax/shipping/commission
  breakdown for that branch.
- Double-entry ledger postings are written (`JournalEntry` +
  `LedgerPosting`) — every journal entry's debits must equal its
  credits, enforced by a DB trigger, not just application code.

### Fulfillment, Shipping, Delivery (Phase 7D)

Each `OrderAllocation` (one per delivery branch) moves through a
strict forward-only state machine: `AWAITING_PREPARATION →
PREPARING → READY_TO_SHIP → SHIPPED → DELIVERED`. Delivery
confirmation freezes `disputeWindowClosesAt` (7 days from delivery) —
this field is immutable once set; there is no code path, anywhere,
that can extend or shorten a dispute window after the fact.

### Disputes, Replacement, Refunds, Settlement (Phase 7E)

- **Disputes**: a trader opens a dispute (with evidence) only while
  the delivered allocation's dispute window is still open. The
  supplier responds; an admin decides — `REJECTED`, `FULL_REFUND`,
  `PARTIAL_REFUND`, or `REPLACEMENT`. A **second** decision on the
  same dispute is allowed only after a `REPLACEMENT` decision's
  obligation has failed, and only as a refund decision — never a
  third decision, never a second replacement.
- **Replacement**: mirrors the original fulfillment state machine
  (supplier prepares → ships; trader/admin confirms delivery), tracked
  as a `ReplacementObligation` distinct from the original allocation.
- **Refunds**: `RefundExecutionService` starts a provider attempt;
  a signed, idempotent webhook confirms success/failure. Duplicate
  webhook deliveries (same provider event id, same payload hash)
  return the same recorded outcome — no re-processing, no duplicate
  ledger entries. A **duplicate success** (a second attempt succeeding
  after the obligation is already `COMPLETED`) creates a
  `RefundReconciliationIncident` plus a dedicated reconciliation
  journal entry — it is never silently absorbed or silently dropped.
- **Settlement**: an admin-only, 2FA-gated action pays the supplier's
  net payable for one delivered allocation, once its dispute window
  has closed, no dispute is open, and no refund obligation from that
  allocation's dispute is still pending. A **zero net amount**
  (e.g. a full refund) settles as `ZERO_BALANCE` — no bank transfer
  reference, no settlement journal entry, but still an auditable,
  immutable settlement record.

#### Financial snapshot and settlement formulas

```text
Per allocation (frozen at Capture):
  supplierPayableShareAmount = productAmountExclTax + productTaxAmount
                                − commissionShareAmount − commissionShareTaxAmount
  (shipping is NEVER part of this — it is tracked separately as shippingFeeAmount)

At settlement:
  productNet   = supplierPayableShareAmount − SUM(dispute-decision DEBIT SUPPLIER_PAYABLE)
  shippingNet  = shippingFeeAmount          − SUM(dispute-decision DEBIT SHIPPING_LIABILITY)
  netAmount    = productNet + shippingNet
```

Order-level consistency (checked by a deferred DB trigger, not just
application code):

```text
SUM(supplierPayableShareAmount across all allocations)
  = MasterOrder.supplierPayableAmount − QuoteSnapshot.totalShippingFeeAmount
```

### Trader/Supplier tax profiles & Internal Invoice Drafts (Phase 7E)

- **`TraderTaxProfile`** / supplier's existing tax & invoicing
  profiles: self-service, VAT-number format validated (Saudi 15-digit),
  Arabic/Persian digit input normalized before validation, never
  logged raw in Audit/Outbox (only completion state).
- **`MasterOrderBuyerBillingOverride`**: for legacy orders created
  before the trader billing snapshot existed, an admin (2FA) can copy
  the trader's *current* tax profile into an immutable override — the
  admin can never type in VAT data manually; it is always copied
  verbatim from the trader's own profile.
- **Internal Invoice Drafts — NOT tax invoices.** Every document this
  platform produces today is one of:

  ```text
  InvoiceDocumentType {
    INTERNAL_PRODUCT_DRAFT
    INTERNAL_COMMISSION_DRAFT
    INTERNAL_ADJUSTMENT_DRAFT
  }
  ```

  Each one carries `documentPurpose: "NOT_A_TAX_INVOICE"` explicitly
  inside its frozen `snapshotData`, uses `internalDocumentReference`
  (never `taxInvoiceNumber`), and has no QR code, no ZATCA clearance,
  no ZATCA reporting. **There is no tax invoicing / ZATCA integration
  in this phase.** Money amounts inside `snapshotData` are stored as
  canonical decimal strings (`"100.00"`, never a float) — a DB-level
  CHECK constraint enforces presence, format, and that `amount`
  matches the frozen equation exactly, closing the general PostgreSQL
  pitfall where a CHECK expression evaluating to `NULL` (e.g. from a
  missing JSON key) is otherwise silently treated as satisfied.

  `INTERNAL_ADJUSTMENT_DRAFT` documents point back to the draft they
  adjust (`relatedInvoiceDocumentId`); the sum of adjustments against
  one original document can never exceed that document's own amount
  (deferred DB trigger). The original draft is never mutated — every
  `invoice_documents` row is immutable (DB trigger rejects UPDATE and
  DELETE unconditionally).

### Idempotency & locking patterns used throughout

- **HTTP-facing writes**: mandatory `Idempotency-Key` header, backed
  by the shared `idempotency_keys` table — same key + same payload
  returns the same result; same key + different payload → 409.
- **Row-level races** (e.g. a dispute opening at the same moment as a
  settlement, or two concurrent settlement attempts on the same
  allocation): `SELECT ... FOR UPDATE` on the contended row inside a
  transaction — exactly one side wins, the other gets a clean,
  correct rejection. This is verified with real concurrent HTTP
  requests over two separate connections in the E2E suite, not just
  asserted in comments.
- **Deferred DB constraints**: cross-row/cross-table invariants
  (ledger balance, snapshot sum consistency, adjustment caps) are
  enforced with `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY
  DEFERRED`, checked at `SET CONSTRAINTS ... IMMEDIATE` right before
  commit — so multi-statement transactions can build up state in
  steps while the final invariant is still guaranteed atomically.

### Migrations, Fresh Install, and Upgrade path

As of this writing there are 87 migrations. Two paths are both
exercised routinely:

- **Fresh Install**: `prisma migrate deploy` against an empty
  database applies all 87 in order.
- **Upgrade path** (63 → 7E's expand/backfill/contract sequence →
  87): migrations up to **63** represent the pre-7E schema. 7E is
  split into an **expand** release (new nullable columns/tables, safe
  to apply against live data), a **backfill** step
  (`src/cli/backfill-financial-snapshots.ts`, computing
  `OrderAllocationFinancialSnapshot` rows for orders that predate the
  table's existence), a **verification gate**
  (`src/cli/verify-financial-snapshots-gate.ts`, which must report
  zero failures before proceeding), and a **contract** release
  (the strict NOT NULL / CHECK constraints that only make sense once
  every row has been backfilled). This exact sequence — including
  running the real backfill/gate scripts through the *current*
  generated Prisma Client against a database sitting mid-upgrade,
  where later-migration columns genuinely don't exist yet — is a
  permanent, always-run integration test
  (`test/upgrade-path-regression.integration-spec.ts`), not a
  one-off manual exercise.

Both Fresh Install and the Upgrade path end in a **Zero Drift**
check: `prisma migrate diff` between the migrated database and the
current `schema.prisma` must produce an empty diff.

## Testing strategy for Phase 1

> This section describes Phase 1's original (minimal) testing scope.
> The suite has grown substantially since — as of Phase 7E, the
> permanent test suite includes hundreds of unit tests
> (`packages/domain` alone covers rounding, settlement eligibility,
> and dispute/replacement state machines), full integration coverage
> per phase (including the upgrade-path regression test described
> above), and E2E suites that exercise real HTTP end-to-end through
> Guards/CSRF/Idempotency for every major flow (checkout → payment →
> fulfillment → dispute → refund → settlement → invoice draft). Run
> `pnpm run test`, `pnpm --filter api run test:integration`, and
> `pnpm --filter api run test:e2e` to see the current scale directly.

- **Unit** — pure logic: Error Envelope mapping, env validation, manual
  maps coordinate validation, storage command construction.
- **Integration/E2E smoke** — `/health` (liveness, no dependency checks)
  and `/ready` (readiness — checks Postgres for real; reports Redis and
  MinIO informationally) against real local Postgres/Redis/MinIO.
- Business-rule test scenarios (concurrency, idempotency, multi-supplier
  allocation, etc.) begin once that logic exists in a later phase.
