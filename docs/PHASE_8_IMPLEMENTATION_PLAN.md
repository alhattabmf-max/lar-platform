# Phase 8 — Implementation Plan (Approved)

Status: **APPROVED — planning only.** No Phase 8 functional code has been written.
Baseline: tag `phases-1-7-final` → commit `2d5698f`.

Phase 8 delivers the web application (`apps/web`) on top of the Phases 1–7 API, plus
the small number of backend reads and two features (promotional banners, in-app
notifications) that the portals require and that do not exist yet.

---

## 1. Starting state (measured, not assumed)

| Fact | Value |
|---|---|
| Tracked files at baseline | 625 |
| Prisma migrations at baseline | 87 |
| API endpoints at baseline | 178 across 51 controllers |
| — of which admin | 94 |
| — of which webhooks (never callable from the browser) | 4 |
| — of which health/readiness (unprefixed, infra-only) | 2 |
| Frontend routes at baseline | 1 (`app/[locale]/page.tsx`) |
| Frontend components / hooks / stylesheets / tests | 0 / 0 / 0 / 0 |
| Tailwind | not installed |
| `@platform/types` contents | `error-envelope.ts` only |

Two facts discovered during the Phase 8A audit materially shaped this plan:

1. **There is no Outbox relay.** `OutboxEvent` rows are written in 13 places and read
   only by tests. Nothing in the repository ever sets `status = PUBLISHED` or
   `published_at`. The outbox is, today, a write-only intent ledger.
2. **Email is mock-only.** `EmailModule` binds `MockEmailProvider`, which logs and
   sends nothing. No real provider exists in the repository.

Consequently the relay is its own batch (**8D0**) and a real email provider is
explicitly out of Phase 8.

---

## 2. Deployment topology (decided)

| Item | Decision |
|---|---|
| Web origin | `app.forsa.sa` |
| API origin | `api.forsa.sa` |
| Registrable domain | `forsa.sa` (shared) — therefore **same-site** |
| Local development | web on `:3001`, API on `:3000` (also same-site; port does not affect SameSite) |
| Session cookie | `HttpOnly` + `SameSite=Lax` + `Secure` in production |
| Browser → API requests | `credentials: "include"` on every request |
| `CORS_ALLOWED_ORIGINS` | the web origin only |
| `SameSite=None` | **prohibited** |
| Configuration | environment-driven; never hardcoded in application code |

The existing CSRF defence (Origin/Referer compared against `CORS_ALLOWED_ORIGINS`,
`GET` exempt) and the existing CORS setup already satisfy this. No code change is
required for topology — environment values only.

---

## 3. Frontend security architecture

- **Never trust a client-side role.** No role in `localStorage`, `sessionStorage`, or
  a client store. The role is read from `GET /me` on the server for each page request.
- **Never read or decode the `HttpOnly` cookie in the frontend.** The web app forwards
  it; it never parses it. No JWT decoding of any kind.
- **`/me` and the server-side session are the single source of truth.**
- **`middleware.ts` stays locale-only.** No API calls and no role logic in middleware —
  that is precisely the fragile per-navigation logic to avoid.
- **Guards live in server layouts,** one per route group:

```text
app/[locale]/
  (public)/layout.tsx      no guard
  (auth)/layout.tsx        redirects to the portal when a valid session exists
  (trader)/layout.tsx      requireRole("TRADER")
  (supplier)/layout.tsx    requireRole("SUPPLIER")
  (admin)/layout.tsx       requireAdmin()      (separate admin cookie)
  unauthorized/page.tsx    single shared 403 page
```

- **Unified error handling.** `mapApiError()` converts the Error Envelope
  (`{ error: { code, message, details }, requestId, timestamp }`) into one type:
  401 → redirect to login, 403 → the shared page, everything else → a translated
  message plus the `requestId` for support.
- **`cache: "no-store"` is mandatory** on every server fetch of session or sensitive
  data (`/me`, orders, documents, settlements, notifications, admin settings).
  Only `/branding`, `/banners`, `/taxonomy/active`, `/regions/active`, and
  `/cities/active` may use a short `revalidate`.

---

## 4. Shared type contracts

`@platform/types` holds **wire contracts only**.

- **No Prisma types.** The package must never import `@prisma/client`; a test asserts
  this against the package's imports and `package.json`.
- **No hand-copied DTOs.** A contract is declared once in
  `packages/types/src/contracts/` and the API uses it as its controller return type,
  so any drift breaks `typecheck` on both sides.
- **Wire enums plus contract tests.** The string union lives in `@platform/types`; a
  test inside `apps/api` imports both the internal enum and the shared union and
  asserts the two sets are exactly equal. The frontend stays decoupled from Prisma
  while drift still fails CI.

Shared enums (9): `AccountType`, `VerificationStatus`, `MasterOrderStatus`,
`OrderAllocationStatus`, `DisputeStatus`, `InvoiceDocumentType`,
`SupplierPayoutOutcome`, `NotificationType`, `BannerPlacement`.

**"No hardcoded strings" means user-visible text only.** Error codes, the
`NOT_A_TAX_INVOICE` constant, enum values, route segments, `data-testid` values, HTTP
headers, and cookie names are technical constants, not UI copy.

---

## 5. Legal constraints

### 5.1 Permitted

Authorised traders and suppliers **may** view `INTERNAL_*_DRAFT` documents for their
own orders, provided every screen and every API response carries the mandatory
`NOT_A_TAX_INVOICE` notice.

Buyer billing override is **not** legally blocked. It is a restricted, audited admin
action guarded by `AdminSessionAuthGuard + CsrfGuard`, recorded in `AuditLog` with a
mandatory `reason`.

### 5.2 Prohibited (6 standing prohibitions)

1. Calling any document a "tax invoice" / "فاتورة ضريبية" as an affirmative claim, in
   any language or label.
2. Producing a tax PDF.
3. Rendering any QR code on a document (ZATCA or otherwise).
4. Referring to ZATCA, its branding, or implying compliance.
5. Any clearance flow.
6. Any tax reporting flow.

The code basis is `apps/api/src/invoicing/internal-draft-invoice.provider.ts`:
these references are "NOT tax invoice numbers, carry no ZATCA meaning, and are never
submitted for clearance/reporting". The UI mirrors that statement literally.

### 5.3 How this is tested

Three layers, because a naive regex would ban the mandatory warning itself (the
Arabic warning contains the phrase "فاتورة ضريبية").

1. **Positive assertion.** Every document screen renders the `NOT_A_TAX_INVOICE`
   notice; every document API response carries `notice: "NOT_A_TAX_INVOICE"`.
2. **Affirmative-claim ban only** — applied to `apps/web/messages/*.json` and
   components:

```text
فاتورة ضريبية (معتمدة|مصدقة|رسمية|صحيحة)
ZATCA | زاتكا | هيئة الزكاة
tax invoice (certified|approved|compliant|valid)
ZATCA[- ]?compliant | e-invoic(e|ing) compliant
Clearance | Reporting | التصديق الضريبي | الإبلاغ الضريبي
```

   Plus a structural rule: no QR component may be imported anywhere under
   `documents/`.
3. **Layer separation.** The visible warning is translated via `next-intl`; the
   contract value `NOT_A_TAX_INVOICE` is a machine-readable constant that is never
   translated and never rendered raw.

---

## 6. New schema

Three migrations. `87 → 90`.

| # | Migration | Batch |
|---|---|---|
| 88 | `create_promotional_banners` | 8C |
| 89 | `add_outbox_relay_fields` | 8D0 |
| 90 | `create_notifications` (two tables + enum) | 8D |

### 6.1 Promotional banners (migration 88)

```text
PromotionalBanner
  id                    uuid PK
  placement             BannerPlacement    -- PUBLIC_HOME | PUBLIC_OPPORTUNITIES
  titleAr, titleEn      text               -- plain text, never HTML
  bodyAr, bodyEn        text?              -- plain text, never HTML
  imageObjectKey        text?              -- internal, never returned publicly
  imageThumbnailKey     text?
  imageWidth, imageHeight int?
  linkUrl               text?
  sortOrder             int  default 0
  isActive              bool default false
  startsAt, endsAt      timestamptz?
  createdByAdminUserId  uuid
  createdAt, updatedAt  timestamptz
  index (placement, isActive, startsAt, endsAt, sortOrder)
```

Safety rules:

- **No raw HTML.** Fields are plain text rendered as React text nodes.
  `dangerouslySetInnerHTML` is banned repo-wide by lint rule.
- `linkUrl` is validated on write: internal paths (`^/`) are always allowed without
  an allowlist; `https://` is allowed only when the host is in the allowlist.
  Rejected: `javascript:`, `data:`, `vbscript:`, `file:`, `http:`, protocol-relative
  `//`.
- External links render with `rel="noopener noreferrer nofollow"`.
- Public reads return only rows where
  `isActive AND (startsAt IS NULL OR startsAt <= now()) AND (endsAt IS NULL OR endsAt > now())`,
  ordered by `sortOrder`. `imageObjectKey` is never returned; the API returns a
  server-built `imageUrl`.
- **No row deletion — deactivate only.** This preserves the audit trail and avoids
  orphaned objects.
- Every create/update/toggle/reorder/image-upload/image-delete writes an `AuditLog`
  entry.

Image upload reuses the existing, already-hardened pipeline
(`apps/api/src/common/media/image-processing.util.ts`):

| Requirement | Already satisfied by |
|---|---|
| Real MIME detection (not the extension or client header) | `sharp().metadata()` |
| SVG rejected | absent from `FORMAT_TO_CONTENT_TYPE` (`jpeg`, `png`, `webp` only); no sanitizer exists, so SVG is not accepted |
| Pixel ceiling | `maxPixels` check |
| Size ceiling | `MEDIA_SIZE_HARD_CEILING_BYTES` (20 MB), also the Multer limit |
| EXIF/ICC/XMP stripped | `.withMetadata()` is deliberately never called |

Old objects are removed with the existing best-effort delete pattern; a delete
failure is logged and never fails the operation.

Two new settings keys are stored as `SystemSetting` rows via
`SettingsService.getJsonSafe(...)`, so **no migration is needed for them**:
`banner_link_allowlist` and `promotional_banner_policy`.

### 6.2 Notifications (migration 90)

```text
Notification
  id            uuid PK
  companyId     uuid                -- isolation boundary
  type          NotificationType
  entityType    text
  entityId      uuid
  params        jsonb               -- whitelisted scalars only
  dedupeKey     text UNIQUE         -- deduplication
  createdAt     timestamptz
  index (companyId, createdAt)

NotificationRecipient
  id             uuid PK
  notificationId uuid
  userId         uuid
  readAt         timestamptz?       -- per-user read state
  UNIQUE (notificationId, userId)
  index (userId, readAt)
```

Why two tables: read state is a property of the (notification, user) pair. A single
`readAt` on the notification would let one user's read mark it read for everyone.

- `dedupeKey` is derived deterministically as
  `${type}:${entityType}:${entityId}:${discriminator}`. Reprocessing collides with the
  unique constraint and is swallowed as a no-op. **Uniqueness is enforced by the
  database, not by application logic** — the distinction matters under concurrency.
- Isolation: every query is constrained by `companyId = session.companyId` **and**
  `recipient.userId = session.userId`. A non-match returns **404, not 403**, to avoid
  identifier enumeration.
- `params` is whitelisted **on write** (`orderId`, `allocationId`, `disputeId`,
  `amount`, `currency`, `count`). Any other key is rejected. No sanitising on read.
- `params` never contains: counterparty settlement detail, IBAN, bank transfer
  reference, dispute evidence content, or counterparty identity data.
- Notification rows are written **inside the business event's transaction**, matching
  the existing `AuditLog` / `OutboxEvent` pattern. Email is dispatched later, only by
  the relay.

Notifications store a `type` plus `params`, never rendered text — the frontend
translates via `next-intl`. This gives bilingual output for free and keeps secrets
out of the table by construction.

### 6.3 Notification event matrix

18 types; 11 also emit an email intent.

| # | Business event | `NotificationType` | Recipients | Email |
|---|---|---|---|---|
| 1 | Payment succeeded | `PAYMENT_SUCCEEDED` | trader | yes |
| 2 | Payment definitively failed | `PAYMENT_FAILED` | trader | yes |
| 3 | Order created | `ORDER_CREATED` | trader + supplier | yes (both) |
| 4 | Preparation started | `ALLOCATION_PREPARATION_STARTED` | trader | no |
| 5 | Ready to ship | `ALLOCATION_READY` | trader | no |
| 6 | Shipped | `ALLOCATION_SHIPPED` | trader | yes |
| 7 | Delivery confirmed | `ALLOCATION_DELIVERED` | trader + supplier | no |
| 8 | Master order fulfilled | `MASTER_ORDER_FULFILLED` | trader + supplier | yes (both) |
| 9 | Dispute opened | `DISPUTE_OPENED` | supplier | yes |
| 10 | Supplier responded | `DISPUTE_SUPPLIER_RESPONDED` | trader | yes |
| 11 | Dispute decided | `DISPUTE_DECIDED` | trader + supplier | yes (both) |
| 12 | Refund initiated | `REFUND_INITIATED` | trader | yes |
| 13 | Refund definitively failed | `REFUND_FAILED` | trader | yes |
| 14 | Replacement obligation created | `REPLACEMENT_REQUIRED` | supplier | yes |
| 15 | Replacement shipped | `REPLACEMENT_SHIPPED` | trader | no |
| 16 | Replacement delivered | `REPLACEMENT_DELIVERED` | trader + supplier | no |
| 17 | Replacement failed | `REPLACEMENT_FAILED` | trader + supplier | yes |
| 18 | Settlement executed | `SETTLEMENT_EXECUTED` | supplier | yes |

Recipient expansion: every active user of the company at creation time gets one
`NotificationRecipient` row.

**No SMS, no WhatsApp, no push.**

---

## 7. New read APIs

### 7.1 Trader documents

`GET /api/v1/trader/orders/:masterOrderId/documents` — `SessionAuthGuard + RequireTraderGuard`

- Isolation: `MasterOrder.traderCompanyId === session.companyId`, otherwise **404**.
  The column is already indexed.
- Returns `INTERNAL_PRODUCT_DRAFT` and `INTERNAL_ADJUSTMENT_DRAFT` only.
- **`INTERNAL_COMMISSION_DRAFT` is withheld from the trader** — commission is between
  FORSA and the supplier; the trader is not a party to it.
- `snapshotData` is **never returned raw**. Derived whitelist only: `amount`,
  `currency`, `issuedAt`, `internalDocumentReference`, `documentType`,
  `notice: "NOT_A_TAX_INVOICE"`.
- No `JournalEntry`, no `LedgerPosting`, no supplier bank data.

### 7.2 Supplier documents

`GET /api/v1/supplier/orders/:masterOrderId/documents` — `RequireSupplierGuard`

- Isolation: `MasterOrder.supplierCompanyId === session.companyId`, otherwise **404**.
- Sees `INTERNAL_PRODUCT_DRAFT`, `INTERNAL_COMMISSION_DRAFT`, and
  `INTERNAL_ADJUSTMENT_DRAFT` for its own sale.
- No trader data beyond what fulfilment requires: no CR number, no contacts, no
  `MasterOrderBuyerBillingOverride`.

### 7.3 Supplier settlements

`GET /api/v1/supplier/settlements` and `GET /api/v1/supplier/settlements/:id` —
`RequireSupplierGuard`

- Reads `SupplierPayout` (an existing table) via
  `orderAllocation → masterOrder.supplierCompanyId`.
- Returns `outcome`, `netAmount`, `executedAt`, `orderAllocationId`, and
  `bankAccount.ibanLast4` only.
- **Withheld:** `externalTransferReference` (internal bank reference),
  `executedByAdminUserId` (staff identity), the raw `supplierBankAccountId`, and any
  ledger data.

### 7.4 Mandatory tests for 7.1–7.3

Per endpoint: **200** for the owner, **404** for another company (404 rather than 403,
so existence is not leaked), **401** without a session, **403** for the wrong role, and
an assertion that the response body contains no `snapshotData`, no
`externalTransferReference`, and no full IBAN — following the existing pattern in
`apps/api/src/financial/bank-accounts.service.spec.ts`.

---

## 8. Admin operations

### 8.1 Audit viewer

`GET /api/v1/admin/audit-logs` — `AdminSessionAuthGuard`

A key blacklist is not sufficient: a sensitive value can appear under a generic key or
nested inside free text. Phase 8 therefore returns **safe metadata only**:

```text
{ id, action, entityType, entityId, actorType, actorId, companyId, requestId, createdAt }
```

- **`beforeData` and `afterData` are never returned.** They are absent from the
  response type, so no code change can leak them by accident.
- **`ipAddress` and `userAgent` are entirely absent from the Phase 8 surface.** There
  is no opt-in flag.
- Per-entity allowlists for detail views are a later phase, out of Phase 8 scope.
- **Reading audit does not write audit** — no infinite audit chain. The existing
  `pino` request log with `requestId` already covers observability.
- Pagination with a **hard cap of 100**, ordered `createdAt desc`.
- Filters: `entityType`, `entityId`, `actorType`, `companyId`, `action`, `from`, `to`,
  `requestId` — all backed by existing indexes.

Tests must be **structural, not cosmetic**:

1. Seed an `AuditLog` row with `afterData = { iban: "SA03…", note: "IBAN SA03…" }`.
2. `GET /admin/audit-logs`.
3. Assert the serialised response does not contain `"SA03"`.
4. Assert each item's key set **exactly equals** the nine-key whitelist — exact
   equality, not "does not contain", so a future field cannot leak automatically.
5. Assert no `ipAddress` and no `userAgent` on any item.
6. Assert `pageSize=500` is clamped to 100.

### 8.2 Outbox monitor

`GET /api/v1/admin/outbox/stats` — `AdminSessionAuthGuard`. Aggregates only.

Per the 8D0 amendments, the response separates relay-supported events from legacy
events (see §9.7). `OutboxEvent.payload` is **never** returned under any
circumstances, and `lastError` is never returned as raw text.

**No retry and no delete.** There is no existing safe outbox endpoint to reuse — the
repository has none — so manual retry is deferred beyond Phase 8.

### 8.3 Integration status

`GET /api/v1/admin/integrations` already exists and is consumed as-is. No backend
change.

---

## 9. 8D0 — Outbox relay

### 9.1 Email decisions (fixed)

| # | Decision |
|---|---|
| 1 | The Outbox relay is its own batch, **8D0**, sequenced before 8D |
| 2 | A real email provider is **out of Phase 8**, pending provider selection, domain approval, and legal content sign-off |
| 3 | `MockEmailProvider` is for development and tests **only** |
| 4 | **Claiming that email is actually delivered in production is prohibited** |
| 5 | **Production launch is blocked** if email is required and `EMAIL_PROVIDER_MODE=mock` |

### 9.2 Delivery semantics

This relay provides **at-least-once delivery with a stable provider idempotency key**.

It is **not** exactly-once, and no document, comment, or commit message may describe it
as such. The residual duplicate window is documented and accepted:

> If the process crashes after the provider has accepted the message but before the
> settlement transaction commits, the event is re-claimed after its lease expires and
> re-sent with the **same** idempotency key `outbox:${outboxEvent.id}`. A provider that
> honours idempotency keys will deduplicate it. **A provider that does not support
> idempotency keys will deliver a duplicate.** Provider idempotency support is
> therefore a selection criterion when the real provider is chosen.

### 9.3 Why the current schema is insufficient

`outbox_events` today has `outbox_events_status_idx` on `status`, and a partial unique
index on `idempotency_key` where not null. It lacks:

| Missing | Why it matters |
|---|---|
| `PROCESSING` status | Without an in-flight state there is no way to distinguish "not started" from "running", so crash recovery is impossible |
| `next_attempt_at` | Without a deferral column a failure is retried immediately on the next pass — no backoff |
| `locked_at` / `locked_until` / `locked_by` / `claim_token` | Without a lease, a crashed worker leaves a row `PROCESSING` forever |
| `error_class` | `last_error` is a free-text column and would risk PII from exception messages |
| `failed_at` | No timestamp for dead-lettering |
| Composite claim index | `status` alone forces a large scan as the table grows |

`last_error` is currently written nowhere in the repository; it stays untouched and
unused.

### 9.4 Migration 89 — `add_outbox_relay_fields`

```sql
ALTER TYPE "OutboxStatus" ADD VALUE 'PROCESSING';

ALTER TABLE "outbox_events"
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "locked_at"       TIMESTAMPTZ(3),
  ADD COLUMN "locked_until"    TIMESTAMPTZ(3),
  ADD COLUMN "locked_by"       TEXT,
  ADD COLUMN "claim_token"     UUID,
  ADD COLUMN "error_class"     TEXT,
  ADD COLUMN "failed_at"       TIMESTAMPTZ(3);

CREATE INDEX "outbox_events_claim_idx"
  ON "outbox_events" ("event_type", "status", "next_attempt_at", "locked_until");

CREATE INDEX "outbox_events_failed_idx"
  ON "outbox_events" ("status", "failed_at") WHERE "status" = 'FAILED';
```

`ALTER TYPE … ADD VALUE` cannot run inside a transaction on PostgreSQL < 12; the
deployment target is `postgres:16-alpine`, which supports it, and Prisma emits the
statement separately.

**No existing row is modified.** No backfill, no `UPDATE`, and no historical event is
marked `PUBLISHED`. The new columns are `NULL` for every pre-existing row.

### 9.5 Preventing historical sends

**Decision: versioned event type only. No watermark.**

```text
RELAY_SUPPORTED_EVENT_TYPES = ["EMAIL_NOTIFICATION_V1"]   // constant, in code
```

The claim query begins with `event_type = ANY($1)`. Therefore:

- The 13 existing event types (`CHECKOUT_LOCK_CREATED`, `CHECKOUT_LOCK_EXPIRED`,
  `MASTER_ORDER_FULFILLED`, `PRODUCT_SUSPENDED`, `OPPORTUNITY_EXPIRED`,
  `TRADER_TAX_PROFILE_UPDATED`, `REFUND_ATTEMPT_DEFINITIVE_FAILED`, and the rest) are
  **invisible to the relay** — never read, never locked, never updated.
- They remain `PENDING` indefinitely. That is correct and intended: they were written
  as an intent ledger, not as email commands.
- **Why not a watermark:** `created_at >= relayEnabledAt` depends on a configurable
  value; one deployment mistake causes a retroactive email flood. A code constant
  cannot be misconfigured in production.
- Adding `EMAIL_NOTIFICATION_V2` later is a deliberate, reviewed code change, not a
  settings change.

### 9.6 `EMAIL_NOTIFICATION_V1` payload

```json
{
  "v": 1,
  "notificationId": "uuid",
  "recipientUserId": "uuid",
  "template": "DISPUTE_OPENED",
  "params": { "orderId": "uuid", "amount": "1200.00" }
}
```

- **No email address in the payload.** The relay resolves `users.email` from
  `recipientUserId` at send time. The outbox row therefore carries no PII, and the
  right to erasure works naturally (user deleted → no email).
- No HTML, no rendered text, no counterparty-sensitive amounts. `params` is a
  whitelisted scalar map validated on write.

### 9.7 The eight mandatory amendments

#### A1 — `claimToken` per claim; settlement conditioned on it

Every claim generates a fresh `claim_token` (UUID). Every settlement statement is
conditioned on **all three**:

```sql
WHERE id = $1 AND status = 'PROCESSING' AND claim_token = $2
```

`locked_by` alone is **not** sufficient: the same worker id can re-claim the same row
after a lease expiry, so `locked_by` would still match and a slow, superseded attempt
could overwrite the result of the current one. `claim_token` is unique per claim
attempt, so a superseded settlement matches zero rows. `locked_by` is retained for
observability only, never as a correctness guard.

#### A2 — Hard provider timeout, real abort, honest semantics

- The provider call has a **hard timeout clearly below `LEASE_SECONDS`**:
  `PROVIDER_TIMEOUT_MS = 20_000` against `LEASE_SECONDS = 120`.
- The timeout performs a **real abort** (an `AbortSignal` passed into the provider
  call and honoured by the transport), not merely an unhandled race that leaves the
  request running.
- Documentation, code comments, and commit messages must say
  **"at-least-once delivery + stable provider idempotency key"**. The phrase
  "exactly-once" is prohibited.
- The duplicate window for a provider without idempotency support stays documented
  (see §9.2).

#### A3 — Shared production/mock validator, applied at both boots

The production-versus-mock check lives in **one shared validator** (in
`@platform/config`), and is invoked at process start by **both**:

- `apps/api` — bootstrap
- `apps/worker` — bootstrap

It must not live in `configureApp` alone, because the worker does not call
`configureApp` and would otherwise start happily against a mock provider in
production. The rule: `NODE_ENV=production` **and** `EMAIL_REQUIRED=true` **and**
`EMAIL_PROVIDER_MODE=mock` → **boot fails** with an explicit message. Not a log
warning that can be ignored.

#### A4 — Outbox stats separate relay-supported from legacy

```json
{
  "relaySupported": {
    "eventTypes": ["EMAIL_NOTIFICATION_V1"],
    "pending": 3, "processing": 0, "published24h": 210, "failed": 2,
    "oldestPendingAgeSec": 45
  },
  "legacyUnsupportedPending": 1842
}
```

`oldestPendingAgeSec` is computed **only over relay-supported event types**. Legacy
events are permanently pending by design, and letting them into that gauge would peg
it at the age of the oldest row in the table forever, making the metric useless as an
alerting signal. `legacyUnsupportedPending` is reported as a plain count so the
backlog stays visible without distorting relay health.

#### A5 — Closed versioned payload schema; invalid payload fails immediately

`EMAIL_NOTIFICATION_V1` payloads are validated against a **closed** schema (unknown
keys rejected, `v` must equal `1`, `template` must be a known template id, `params`
must match that template's whitelisted scalar keys).

An invalid payload is **not retryable** — retrying cannot fix malformed data. It goes
straight to `FAILED` with `error_class = PAYLOAD_INVALID`, `failed_at` set, and
**no raw content is logged** (not the payload, not the offending key values, not the
validation message if it echoes data). Only the outbox event id and `PAYLOAD_INVALID`
are recorded.

#### A6 — Deterministic unique `idempotencyKey` from creation

Email outbox events are created **from the outset** with a deterministic, unique
`idempotencyKey`:

```text
email:v1:${notificationId}:${recipientUserId}
```

This uses the **existing partial unique index**
`outbox_events_idempotency_key_unique` (added by migration
`20260816000500_add_outbox_idempotency_key`), so duplicate creation is rejected by the
database, not by application logic.

A direct race/duplicate test is required: two concurrent transactions attempting to
create the same email outbox event → exactly one row exists, the loser receives the
unique-violation error and treats it as a no-op.

#### A7 — Deterministic claim ordering and safe interval parameterisation

- Claim ordering is `ORDER BY created_at, id` — `created_at` alone is not a total
  order, and ties would make batch composition non-deterministic across workers and
  across test runs.
- The lease interval uses **safe parameterisation**, never string-concatenated SQL:

```sql
locked_until = now() + make_interval(secs => $3)
```

  and never `now() + ($3 || ' seconds')::interval`.

#### A8 — Migration 89 test matrix

| Test | Assertion |
|---|---|
| Fresh install | `prisma migrate deploy` on an empty database applies all 90 migrations and the resulting schema matches |
| Upgrade from the Phases 1–7 baseline | Starting from a database at migration 87 with pre-existing `outbox_events` rows, applying 88–90 succeeds |
| **No historical `OutboxEvent` modified** | Snapshot every pre-existing outbox row (id, event_type, payload, status, attempts, created_at, updated_at) before and after the upgrade; the sets are **identical**, and every new column is `NULL` on those rows |
| Crash recovery | A row left `PROCESSING` with an expired `locked_until` is re-claimed; one left with a live lease is not |
| Zero drift | `prisma migrate diff` between the migrations directory and `schema.prisma` reports no difference, on both the fresh and the upgraded database |

### 9.8 Relay mechanics

Structure follows the existing worker patterns: a BullMQ repeatable job with
`concurrency: 1` per process, and cross-process safety from
`FOR UPDATE SKIP LOCKED` — the same contract documented in
`apps/worker/src/create-sweep-worker.ts` and
`packages/opportunity-lifecycle/src/checkout-lock-expiry-sweep.ts`. No new
Redis-based distributed lock.

```text
apps/worker/src/
  outbox-relay-scheduler.ts       cron "* * * * *"
  create-outbox-relay-worker.ts
  outbox-relay-processor.ts
  outbox/claim.ts
  outbox/templates/               static AR/EN templates
```

**Step 1 — atomic claim (short transaction, no external I/O):**

```sql
WITH batch AS (
  SELECT id FROM outbox_events
  WHERE event_type = ANY($1)
    AND (
      (status = 'PENDING'    AND (next_attempt_at IS NULL OR next_attempt_at <= now()))
      OR
      (status = 'PROCESSING' AND locked_until < now())
    )
  ORDER BY created_at, id
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events o
SET status       = 'PROCESSING',
    locked_at    = now(),
    locked_until = now() + make_interval(secs => $3),
    locked_by    = $4,
    claim_token  = $5,
    attempts     = o.attempts + 1
FROM batch WHERE o.id = batch.id
RETURNING o.id, o.payload, o.attempts;
```

Commit immediately. The `OR (PROCESSING AND locked_until < now())` branch *is* the
crash recovery — no separate reaper.

**Step 2 — dispatch (outside any transaction):** validate the payload against the
closed schema, resolve the recipient, render the template, call the provider with the
hard timeout, the abort signal, and `idempotencyKey = outbox:${id}`.

**Step 3 — settle (short conditional transaction):**

```sql
-- success
UPDATE outbox_events
SET status='PUBLISHED', published_at=now(),
    locked_until=NULL, locked_by=NULL, claim_token=NULL, error_class=NULL
WHERE id=$1 AND status='PROCESSING' AND claim_token=$2;

-- retryable failure
UPDATE outbox_events
SET status='PENDING', next_attempt_at=$3, error_class=$4,
    locked_until=NULL, locked_by=NULL, claim_token=NULL
WHERE id=$1 AND status='PROCESSING' AND claim_token=$2;

-- definitive failure or attempts exhausted
UPDATE outbox_events
SET status='FAILED', failed_at=now(), error_class=$4,
    locked_until=NULL, locked_by=NULL, claim_token=NULL
WHERE id=$1 AND status='PROCESSING' AND claim_token=$2;
```

**Backoff:** `delay = min(base · 2^(attempts − 1), 6h)`, then
`next_attempt_at = now() + delay · (0.5 + random · 0.5)` (jitter).
`MAX_ATTEMPTS = 8`, after which the row is dead-lettered as `FAILED`.

### 9.9 Logging and error classification

**Logged:** `outboxEventId`, `eventType`, `attempt`, `errorClass`, `durationMs`,
`claimedCount`, `workerId`.

**Never logged:** the email address, the payload or any part of it, `params`, the
subject or body, a `notificationId` paired with identity, the provider's exception
text, or a stack trace carrying query parameters.

`error_class` is a **closed set**, never free text:

```text
PROVIDER_TIMEOUT · PROVIDER_RATE_LIMITED · PROVIDER_5XX
PROVIDER_REJECTED_RECIPIENT · TEMPLATE_RENDER_FAILED
RECIPIENT_NOT_FOUND · RECIPIENT_INACTIVE · PAYLOAD_INVALID · UNKNOWN
```

Classification is derived from the exception type and status code. **It is never
derived from `err.message`** — that is exactly the path through which PII leaks.

Retryable: `PROVIDER_TIMEOUT`, `PROVIDER_RATE_LIMITED`, `PROVIDER_5XX`, `UNKNOWN`.
Immediately definitive: `PROVIDER_REJECTED_RECIPIENT`, `RECIPIENT_NOT_FOUND`,
`RECIPIENT_INACTIVE`, `TEMPLATE_RENDER_FAILED`, `PAYLOAD_INVALID`.

**The relay writes no `AuditLog` entries** — there is no business actor, and
infrastructure events do not belong in the audit trail.

### 9.10 Graceful shutdown

The new worker is appended to the existing `workers` / `queues` arrays consumed by
`createShutdownHandler`, which already supports an arbitrary number of worker/queue
pairs. On signal, `worker.close()` waits for the in-flight batch. Any row still
`PROCESSING` is recovered automatically once `locked_until` passes.
`LEASE_SECONDS = 120` is comfortably greater than `PROVIDER_TIMEOUT_MS = 20_000`, so a
hard crash costs a bounded delay, never a lost event.

### 9.11 Templates and locale

| Item | Decision |
|---|---|
| Templates | Static, in-repo, Arabic and English, reviewed as source. Plain text plus simple in-house HTML |
| Untrusted HTML | Prohibited. `params` are injected as escaped text only; no template engine that evaluates embedded expressions |
| Locale | **`User` has no locale preference field** — no `locale`, no `preferredLanguage`. Therefore **`ar-SA` always** in 8D0. Adding `User.preferredLocale` is deferred and is a prerequisite for the real email provider |
| Mock provider | Logs `{ template, recipientUserId, outboxEventId }` only. It must be **tightened**: the current implementation prints `to=` and `subject=`, which is not acceptable |
| Email failure | **Never** rolls back the business operation or the in-app notification. Fully separate path |

### 9.12 8D0 integration tests

| # | Scenario | Assertion |
|---|---|---|
| 1 | Two competing workers | Two separate Prisma clients claim concurrently → `sendEmail` called **once**; the loser matches zero rows |
| 2 | Crash after claim, then recovery | Claim, drop the process; row stays `PROCESSING`; before lease expiry a new worker does **not** pick it up; after expiry it does, with `attempts = 2` |
| 3 | Retryable failure then success | Provider throws once → `PENDING` with a future `next_attempt_at` and a classified `error_class`; the next pass after that time → `PUBLISHED` |
| 4 | Definitive failure to `FAILED` | Repeated failure → after `MAX_ATTEMPTS` → `FAILED` with `failed_at` and `error_class`; never claimed again |
| 5 | Backoff prevents immediate retry | Right after a failure an immediate pass claims **zero** rows; `next_attempt_at > now()` |
| 6 | Shutdown mid-processing | Slow provider plus `shutdown("SIGTERM")` → waits for the batch; logs `Worker shutdown complete`; no row left inconsistent |
| 7 | Unsupported/legacy type never sent | Seed `CHECKOUT_LOCK_EXPIRED`, `MASTER_ORDER_FULFILLED`, `PRODUCT_SUSPENDED` as `PENDING` → after a pass `sendEmail` was **not** called and those rows are untouched with all new columns `NULL` |
| 8 | Re-running does not resend | A `PUBLISHED` row → two passes → zero additional `sendEmail` calls |
| 9 | No leakage in logs | Capture `pino` output for a full pass → contains no email address, no payload value, no subject. Assert **exact key equality** of the log object, not merely "does not contain" |
| 10 | No leakage via the API | `GET /admin/outbox/stats` → no payload, no per-row raw `error_class`, numbers only |
| 11 | Mock only in dev/test | `NODE_ENV=production` + `EMAIL_REQUIRED=true` + `mock` → **boot fails**, asserted for **both** `apps/api` and `apps/worker` |
| 12 | Stable idempotency key | Failure after dispatch → the retry passes the **same** `outbox:${id}` |
| 13 | Structural isolation | The relay touches only `outbox_events` and `users` (read). No `audit_logs`, no `notifications` — mirroring the structural contract in `checkout-lock-expiry-sweep.ts` |
| 14 | `claimToken` guard | A superseded claim's settlement matches zero rows and does not overwrite the current claim's result |
| 15 | Provider timeout aborts | A provider that hangs past `PROVIDER_TIMEOUT_MS` is aborted, classified `PROVIDER_TIMEOUT`, and settles well before `LEASE_SECONDS` elapses |
| 16 | Invalid payload | A malformed `EMAIL_NOTIFICATION_V1` payload → immediate `FAILED` with `PAYLOAD_INVALID`, `attempts` not escalated over multiple passes, and no raw content in logs |
| 17 | Idempotency-key race | Two concurrent creations of the same email outbox event → exactly one row; the loser sees the unique violation and no-ops |
| 18 | Stats separation | With legacy rows present, `relaySupported.oldestPendingAgeSec` reflects only `EMAIL_NOTIFICATION_V1`; `legacyUnsupportedPending` reports the legacy count |

---

## 10. Batches

Sequence: **8B → 8C → 8D0 → 8D → 8E → 8F → 8G**

### 8B — Web foundation

| | |
|---|---|
| Backend | `GET /branding` public (1 endpoint) |
| Schema | none |
| Frontend | Tailwind + PostCSS + `app/globals.css` design tokens (logical properties); `lib/{api-client,errors,session}.ts`; `components/ui/*`; app shell |
| Shared types | `contracts/`: `ErrorEnvelope` (moved), `Paginated<T>`, `BrandingPublic`, `MeResponse` |
| Tests | unit: credentials, `Idempotency-Key`, Error Envelope mapping, `no-store` on session fetches, RTL/LTR; a test asserting `@platform/types` never imports Prisma |
| Acceptance gate | build + typecheck + lint green; zero hardcoded user-visible strings; logical properties instead of left/right; zero `dangerouslySetInnerHTML` |
| Depends on | — |
| Risks | low — topology is settled |

### 8C — Auth screens, public marketplace, banners

| | |
|---|---|
| Backend | banners: 1 public + 5 admin + 2 image = **8**; two settings keys (no migration) |
| Schema | **migration 88** `promotional_banners` + `BannerPlacement` |
| Frontend | `(auth)/*`, `(public)/*`, `BannerSlot`, route groups, server guards, `/unauthorized` |
| Shared types | `BannerItem`, `BannerPlacement`, `LoginRequest`, `OpportunityListItem`, `OpportunityDetail`, `AccountType` |
| Tests | e2e login by CR number; **no OTP**; cross-role 403; `javascript:`/`data:`/`http:` rejected; internal `/path` accepted without allowlist; SVG upload rejected; forged MIME rejected; banner outside its time window not shown; `imageObjectKey` absent from public responses |
| Acceptance gate | zero raw HTML; CSRF passes locally and in production topology; an `AuditLog` entry for every banner operation |
| Depends on | 8B |
| Risks | banners are a new XSS surface, mitigated by reusing the hardened image pipeline and the link allowlist |

### 8D0 — Outbox relay

| | |
|---|---|
| Backend | **zero endpoints**. `EMAIL_NOTIFICATION_V1` constant; tightened `MockEmailProvider`; shared boot validator (§9.7 A3) |
| Schema | **migration 89** `add_outbox_relay_fields` |
| Worker | `outbox-relay-scheduler.ts`, `create-outbox-relay-worker.ts`, `outbox-relay-processor.ts`, `outbox/claim.ts`, AR/EN templates |
| Frontend | none |
| Shared types | `OutboxErrorClass`, `EmailTemplateId`, `OutboxStats` (consumed by 8F) |
| Tests | the 18 integration tests in §9.12, plus the migration matrix in §9.7 A8 |
| Acceptance gate | all tests green; the 13 legacy event types provably untouched; zero leakage in logs; the relay writes no `AuditLog`; no document or commit message uses "exactly-once" |
| Depends on | 8C (sequencing only; no functional dependency) |
| Risks | `ALTER TYPE ADD VALUE` runs outside a transaction — acceptable on PostgreSQL 16. No UI and no endpoints, so the risk surface is narrow |

### 8D — Trader portal

| | |
|---|---|
| Backend | `GET trader/orders/:id/documents` (1); notifications (4) |
| Schema | **migration 90** `notifications` + `notification_recipients` + `NotificationType` |
| Frontend | `(trader)/{dashboard,company,locations,bank-account,tax-profile,opportunities,checkout,payment,orders,orders/[id],disputes,replacements,product-reports,documents,notifications}` |
| Shared types | `OrderSummary`, `DocumentSummary` + `NOT_A_TAX_INVOICE`, `NotificationItem`, `NotificationType`, `CreateCheckoutSessionRequest` |
| Tests | full purchase e2e; repeated `Idempotency-Key` yields the same result; another company's documents → 404; **`COMMISSION_DRAFT` withheld from the trader**; no `snapshotData`; one user's read does not affect a colleague's unread count; relay restart produces no duplicate notification (`dedupeKey` collision); the legal notice is present; affirmative claims are absent |
| Acceptance gate | zero PDF/QR/ZATCA; **it is documented explicitly that no email is delivered while `EMAIL_PROVIDER_MODE=mock`** |
| Depends on | 8D0 |
| Risks | counterparty data leakage is the sharpest risk in this batch |

### 8E — Supplier portal

| | |
|---|---|
| Backend | `GET supplier/orders/:id/documents` (1); `GET supplier/settlements` + `/:id` (2) |
| Schema | none |
| Frontend | `(supplier)/{dashboard,products,products/[id],media,opportunities,orders,orders/[id],fulfillment,disputes,replacements,settlements,documents,notifications,company}` |
| Shared types | `SettlementSummary`, `SupplierPayoutOutcome`, `ProductSummary`, `OrderAllocationStatus` |
| Tests | product → review → ship e2e; another supplier's settlement → 404; `externalTransferReference` and `executedByAdminUserId` absent; no ledger; no full IBAN |
| Acceptance gate | isolation proven per route; exact key equality on the settlement response |
| Depends on | 8C (notifications from 8D) |
| Risks | low |

### 8F — Admin portal

| | |
|---|---|
| Backend | `GET /admin/audit-logs` (1); `GET /admin/outbox/stats` (1). No retry, no delete |
| Schema | none |
| Frontend | `(admin)/{login,2fa,settings/*,operations,products/review,products/reports,bank-accounts,opportunities,geography,taxonomy,sales-units,disputes,refunds,replacements,payouts,orders,invoice-drafts,billing-override,branding,banners,integrations,audit,outbox}` |
| Shared types | `AuditLogEntry` (nine fields), `OutboxStats`, `InvoiceDocumentType` |
| Tests | no cookie before 2FA completes; exact key equality on audit items; `beforeData`/`afterData`/`ipAddress`/`userAgent` absent; a seeded sensitive value does not appear; `pageSize=500` clamps to 100; reading audit writes no `AuditLog`; `payload` absent from outbox stats; stats separate relay-supported from legacy; billing override writes an `AuditLog` with `reason` |
| Acceptance gate | zero full IBAN anywhere; zero raw payload; zero request metadata |
| Depends on | 8C |
| Risks | 29 settings screens make this the largest UI batch |

### 8G — Hardening

| | |
|---|---|
| Backend | production CSP and `CORS_ALLOWED_ORIGINS` tightening. No endpoints |
| Schema | none |
| Frontend | responsive audit; accessibility (landmarks, focus management, skip link, contrast); empty/error/loading states |
| Shared types | contracts frozen |
| Tests | axe on every route; Playwright for critical paths in both `ar-SA` and `en-SA`; **a new standalone CI step, `Web tests`**, following the `Build scripts safety tests` pattern |
| Acceptance gate | zero critical accessibility violations; no horizontal scroll at 360px; CSP without `unsafe-inline` |
| Depends on | 8B–8F |
| Risks | may surface debt from earlier batches; its duration must not be compressed |

---

## 11. Totals

| Metric | Value |
|---|---|
| Migrations | **87 → 90** (88 banners, 89 outbox relay, 90 notifications) |
| Endpoints | **178 → 197** (+19; 8D0 adds zero) |
| Batches | **7** — 8B, 8C, 8D0, 8D, 8E, 8F, 8G |
| Notification types | 18, of which 11 emit `EMAIL_NOTIFICATION_V1` |
| Legacy outbox event types left outside the relay | 13 |
| Shared wire enums | 9 |

New endpoints by group: branding 1; banners public 1 + admin 5 + image 2; notifications
4; documents 2; settlements 2; audit 1; outbox stats 1 = **19**.

There is deliberately **no** `DELETE /admin/banners/:id` — deactivation only, which
preserves the audit trail and avoids orphaned storage objects.

---

## 12. Deferred beyond Phase 8

- **Real email provider.** See §13.
- `User.preferredLocale` — a prerequisite for the real provider.
- Manual outbox retry and delete. No safe endpoint exists today, so none is reused.
- Processing the 13 legacy outbox event types.
- Per-entity allowlists for audit detail views.
- Signed uploads (the storage service exposes `upload`/`read`/`delete` only).
- SMS, WhatsApp, push notifications.
- OpenAPI generation.
- Any PDF, QR code, or ZATCA integration.

---

## 13. Production launch blocker

Production launch is **blocked** while email is required and
`EMAIL_PROVIDER_MODE=mock`.

This is enforced as a boot-time failure, not a log warning, from a shared validator
invoked by **both** `apps/api` and `apps/worker` (§9.7 A3).

Claiming that email is actually delivered in production is prohibited in
documentation, UI copy, commit messages, and code comments while the mock provider is
in use.

---

## 14. Approval

- Plan approved on the `phase-8` branch, on top of `phases-1-7-final` (`2d5698f`).
- Implementation of 8B has **not** started and requires separate approval.
