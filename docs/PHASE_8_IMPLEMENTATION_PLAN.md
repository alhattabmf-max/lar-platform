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

18 types; **13** also emit an email intent.

The count was previously stated as 11. **13 is the figure derived from this matrix
itself** — the rows below marked "yes" in the Email column, counted: `PAYMENT_SUCCEEDED`,
`PAYMENT_FAILED`, `ORDER_CREATED`, `ALLOCATION_SHIPPED`, `MASTER_ORDER_FULFILLED`,
`DISPUTE_OPENED`, `DISPUTE_SUPPLIER_RESPONDED`, `DISPUTE_DECIDED`, `REFUND_INITIATED`,
`REFUND_FAILED`, `REPLACEMENT_REQUIRED`, `REPLACEMENT_FAILED`, `SETTLEMENT_EXECUTED`.

The matrix is authoritative because it names the individual events; the summary
figure was not sourced from anything. `@platform/email` ships exactly these 13
template ids, and a unit test asserts the registry length, so the two cannot drift.

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

- **30 literal event types plus dynamically constructed types, measured at the 8D0
  baseline** (`CHECKOUT_LOCK_CREATED`, `CHECKOUT_LOCK_EXPIRED`,
  `MASTER_ORDER_FULFILLED`, `PRODUCT_SUSPENDED`, `OPPORTUNITY_EXPIRED`,
  `REFUND_ATTEMPT_DEFINITIVE_FAILED`, and the rest) are **invisible to the relay** —
  never read, never locked, never updated.

  An earlier draft of this section said "13 existing event types". The measured
  figure is **30 distinct string literals**, plus **eight call sites that compute the
  type at runtime** (`eventType: action`, `` `PRODUCT_REPORT_${toStatus}` ``), so the
  true set is not statically enumerable at all. Treat 30 as a **baseline measurement,
  not an invariant** — it will drift as services are added.

  The miscount changes nothing about the design, and that is the point of an
  allowlist: `event_type = ANY($1)` is a POSITIVE filter, so it excludes 13, 30 or 300
  identically. **The relay supports `EMAIL_NOTIFICATION_V1` and nothing else.** A
  negative filter would have had to be corrected.
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

### 8B — Web foundation *(delivered)*

| | |
|---|---|
| Backend | `GET /branding` public (**1 endpoint**) |
| Schema | none |
| Frontend | Tailwind + PostCSS + `app/globals.css` design tokens (logical properties); `lib/{api-client,errors,session}.ts`; `components/ui/*`; app shell |
| Shared types | `contracts/`: `ErrorEnvelope` (moved), `Paginated<T>`, `BrandingPublic`, `MeResponse` |
| Tests | unit: credentials, `Idempotency-Key`, Error Envelope mapping, `no-store` on session fetches, RTL/LTR; a test asserting `@platform/types` never imports Prisma |
| Acceptance gate | build + typecheck + lint green; zero hardcoded user-visible strings; logical properties instead of left/right; zero `dangerouslySetInnerHTML` |
| Depends on | — |
| Risks | low — topology is settled |

### 8B.1 — Dynamic brand theme foundation *(delivered)*

| | |
|---|---|
| Backend | **4 admin endpoints**: `GET /admin/branding/theme`, `PUT /admin/branding/theme/draft`, `POST /admin/branding/theme/publish`, `POST /admin/branding/theme/reset`. `GET /branding` widened to carry the ACTIVE theme |
| Schema | **none** — active and draft are `system_settings` rows; the defaults are a code constant (§14.5) |
| Frontend | `lib/theme.ts` (CSS custom properties via a React style object); shell applies the active theme; branding fetch moved to `cache: "no-store"` until 8G revisits caching |
| Shared types | `BrandThemeColors`, `BrandThemePublic`, `BrandThemeDraft`, `BrandThemeAdminView`, `BrandThemeValidationResult`, `DEFAULT_BRAND_THEME`, `FIXED_BRAND_COLORS`, `HEX_COLOR_PATTERN` |
| Tests | hex format and normalisation; WCAG contrast per pair; every default pair passes; unreadable primary/secondary/accent/accent-interactive/focus each rejected at publish; draft never public; publish atomic; reset restores defaults; missing and corrupt settings resolve to defaults; audit on every mutation; no CSS injection |
| Acceptance gate | zero migrations; public response carries the active theme only; publish refused on any format or contrast issue |
| Depends on | 8B |
| Risks | low — no new table, no new UI; the colour picker is deferred to 8F |

### 8C — Auth screens, public marketplace, banners *(delivered)*

Delivered in eight batches. The scope below is what was **built and measured**,
not what was estimated: the endpoint count came in at 12 rather than the planned
8, because image delivery turned out not to exist anywhere in the API and had to
be built (see "Delta against the estimate").

| | |
|---|---|
| Backend | banners **11** = public 2 (`GET /banners`, `GET /banners/:id/image`) + admin 6 (`GET`, `POST`, `PATCH /:id`, `POST /:id/schedule`, `POST /:id/toggle`, `POST /reorder`) + admin image 3 (`GET`, `POST`, `DELETE /:id/image`); opportunity image **1** (`GET /opportunities/:id/image`). **8C total = 12.** Two settings keys, no migration |
| Schema | **migration 88** `promotional_banners` + enum `BannerPlacement`, one composite index, three CHECK constraints |
| Frontend | `(auth)/*` (login, register, forgot/reset password, verify email), `(public)/*` (landing, marketplace list, opportunity detail, policies viewer), `BannerSlot` in both approved placements, route groups, server guards, `/unauthorized` |
| Shared types | `BannerItem`, `BannerAdminItem`, `BannerPlacement`, `BannerState`, `PublicOpportunityItem`, `PublicOpportunityDetail`, `TraderOpportunityTerms`, `OpportunitySort`, `TaxonomyNodeItem`, `CityItem`, `PublicPolicyVersion`, `PASSWORD_MIN_LENGTH` |
| Acceptance gate | zero raw HTML; an `AuditLog` entry for every banner operation; no commercial field on any public surface |
| Depends on | 8B |
| Risks | banners are a new XSS surface, mitigated by reusing the hardened image pipeline and the link allowlist |

**Delta against the estimate (+4 endpoints).** The plan assumed image bytes could
be served by something that already existed. Nothing did — no route in the API
returned image bytes at all. That produced a shared `ImageDeliveryService` plus
four routes the estimate did not carry: one public banner image, two admin banner
image routes beyond the upload that was counted, and one public opportunity image.

**Also delivered, beyond the original 8C line items:**

- **Sort on both opportunity lists.** A closed `sort` parameter
  (`NEWEST | ENDING_SOON`) on `GET /opportunities/active` and
  `GET /trader/opportunities/active`. No new endpoint. The wire default stays
  `NEWEST` so callers written before the parameter existed are unaffected; the
  marketplace UI sends `ENDING_SOON` explicitly. Every ordering terminates in
  `id`, because `createdAt` and `endAt` are both non-unique and a tie spanning a
  page boundary under LIMIT/OFFSET can serve one row twice and never serve
  another.
- **`GET /opportunities/:id` widened to the declared detail contract** — product
  description, fulfilment region, window open. Descriptive only; it adds no
  commercial term, and notably not `expectedPreparationDays`, which is a supply
  commitment.
- **Three public lookup endpoints projected onto declared contracts** —
  `/cities/active`, `/taxonomy/active`, `/policies/active` previously returned raw
  Prisma rows. `/policies/active` was the blocking one: a `PolicyDocument` has a
  `code` and no title, so the viewer had nothing to label sections with. The
  reshape also stops `isPublished`, `requiresReacceptance`, `policyDocumentId` and
  row timestamps reaching anonymous callers.
- **Registration enumeration oracle closed in the API**, not only the UI: the
  per-field conflict codes were **removed** from the error catalogue rather than
  deprecated, so a code that is absent cannot be returned. One neutral
  `REGISTRATION_CONFLICT` answers every identity conflict.
- **One-time token URL hygiene** — `lib/use-one-time-token.ts` captures the
  recovery/verification token into a ref and strips it from the address bar with
  `history.replaceState` before any request is issued. `router.replace()` is
  deliberately *not* used: it issues an RSC request that would carry the tokened
  URL as its `Referer`.

**Taxonomy filter semantics, verified against the source rather than assumed:**

| Property | Finding |
|---|---|
| `GET /taxonomy/active` shape | Flat array carrying `parentId` — not a tree |
| Filter matching | **Exact match only**, against the frozen approval snapshot's own `taxonomyNodeId`. Descendants are NOT included |
| Product placement | Any active node, including non-leaf — there is no leaf-only rule |
| `isActive` filtering | Per node, **not cascaded** — an active child of a deactivated parent is returned with a `parentId` absent from the list |

Because the API matches exactly, the UI says so in both locales and wires that
statement to the control with `aria-describedby`. Both facts are exported as
`TAXONOMY_FILTER_INCLUDES_DESCENDANTS` and `TAXONOMY_ALLOWS_NON_LEAF_PRODUCTS`
so the copy is driven by the contract instead of by a comment someone must
remember to update.

**Not in 8C — Admin Banner UI is deferred to 8F.** All 9 admin banner endpoints
exist and are unit-tested; nothing in `apps/web` calls them. The only banner UI
delivered is the public read-only `BannerSlot`.

**`requireRoleOrRedirect` is built and unit-tested but not yet consumed.** No
route group in 8C is role-guarded, because 8C shipped no role-restricted screen.
It is consumed in 8D–8F.

**Prior encoding corruption — repaired, not a feature.** Two files
(`apps/api/src/branding/branding.service.spec.ts`,
`apps/web/__tests__/session.test.ts`) were committed in `85a3976` carrying a UTF-8
BOM and mojibake produced by PowerShell `Set-Content`/`Get-Content`. The 8C commit
carries their repair because the corruption was already in `main`'s history and
had to be undone somewhere; it is a **fix to previously committed damage**, not
new work. PowerShell text editing is prohibited for this repository as a result.

### 8D0 — Outbox relay *(delivered)*

Delivered in four batches: 8D0.1 the shared package and boot validator, 8D0.2 the
migration and SQL layer, 8D0.3 the processor/scheduler/worker, 8D0.4 closure.

| | |
|---|---|
| Backend | **zero endpoints** — confirmed by recount, 195 before and after |
| Schema | **migration 89** `20260824000100_8d0_add_outbox_relay_fields` |
| New package | **`@platform/email`** — Nest-agnostic, zero NestJS dependency |
| Config | **`EMAIL_REQUIRED`** (boolean, default `false`) + `assertEmailDeliveryConfigured`, invoked by BOTH bootstraps |
| Worker | `outbox-relay-scheduler.ts`, `create-outbox-relay-worker.ts`, `outbox/{claim,outbox-relay-processor,bounded-pool}.ts`, AR/EN templates |
| Frontend | none |
| Depends on | 8C (sequencing only) |

**`@platform/email` — why a separate package.** `apps/worker` is plain Node +
BullMQ with no NestJS and no dependency path into `apps/api`, but the provider,
its DI token and the mock all lived in `apps/api/src/email/`. A relay in the
worker could not have used them. The provider interface, `MockEmailProvider`,
the closed `EMAIL_NOTIFICATION_V1` schema, both key builders, the 13 templates,
the closed error-class set and the relay timing constants now live in the shared
package; the API keeps a thin adapter that binds the same instance to Nest. It is
deliberately **not** in `@platform/config` — config is not a sending layer — and
deliberately **not** in `@platform/types`, because this is an internal channel
contract between the outbox producer and the relay, not an HTTP or UI wire
contract.

**Relay design as built:**

| Concern | Decision |
|---|---|
| State | `PENDING → PROCESSING → PUBLISHED / PENDING(retry) / FAILED`. The lease *is* `PROCESSING` + `locked_until`; there is no separate leased state |
| Correctness guard | `claim_token`, unique per claim. `locked_by` is observability only — the same worker id can re-claim after a lapse |
| Claim | `FOR UPDATE SKIP LOCKED`, `ORDER BY created_at ASC, id ASC` (a TOTAL order), `LIMIT 20`, `attempts` incremented at claim |
| Crash recovery | The `OR (PROCESSING AND locked_until < now())` branch. No separate reaper |
| Terminalisation | Runs **before** the claim, in the same transaction. Retires supported rows at `attempts >= MAX_ATTEMPTS` that are expired-PROCESSING or PENDING → `FAILED` / `ATTEMPTS_EXHAUSTED`. Without it those rows are permanently stranded, since the claim requires `attempts < MAX_ATTEMPTS` |
| Retry | `min(30s · 2^(n−1), 6h)`, jittered into the upper half, from the **database** clock. `MAX_ATTEMPTS = 8` |
| Dead-letter | `FAILED` + `failed_at` + a closed `error_class`. There is no dead-letter table |
| Dispatch | Fixed pool of 5 over a batch of 20. Never `Promise.all` over the batch; one row failing does not abandon the rest |
| Lease safety | `ceil(20/5) × 20s + 20s margin = 100s < 120s lease`, asserted by an **executable invariant** that fails the build if the constants drift. No lease renewal |
| Timeout | `AbortController` per call, cleared in `finally`, honoured by the provider — a real abort, not a lost race |

**Delivery semantics: at-least-once delivery with a stable provider idempotency
key.** Not exactly-once, and no document, comment or commit message may say
otherwise. If the process dies after the provider accepted but before settlement
commits, the row is re-claimed on lease expiry and re-sent with the same
`outbox:${id}` key. A provider honouring idempotency keys collapses it; **a
provider that does not will deliver a duplicate.**

`MAX_ATTEMPTS` bounds *claim/dispatch attempts*; it is not a promise of delivery.
At-least-once does not mean retrying for ever — terminal payload and provider
failures, and exhausting the budget, all end at `FAILED`.

**`PUBLISHED` does not mean an email arrived.** It means the configured provider
accepted the command. With `EMAIL_PROVIDER_MODE=mock` — the only supported mode —
**nothing is sent at all**; acceptance is a log line. `providerMode` therefore
travels on every relay log record, and 8F's stats must carry it plus an explicit
`deliveryIsSimulated` flag, so a dashboard counting `PUBLISHED` can never read as
healthy delivery.

**Structural isolation.** The relay reads and writes `outbox_events` and READS
`users` (three columns) for the recipient. It never touches `notifications` — they
do not exist yet, and it must not depend on migration 90 — and it writes no
`AuditLog`: there is no business actor, and infrastructure events do not belong in
an audit trail.

**No stats endpoint and no manual retry.** `GET /admin/outbox/stats` is **8F**;
manual retry and delete are deferred beyond Phase 8. Between now and 8F the relay
has no operational visibility except logs, and a dead-lettered row has no
supported recovery path in this phase.

**Contract handover to 8D.** The outbox producer in 8D imports
`EMAIL_NOTIFICATION_V1`, `buildCreationIdempotencyKey` and the template ids from
`@platform/email` rather than re-deriving them, so a shape mismatch fails
typecheck instead of surfacing as `PAYLOAD_INVALID` dead-letters at runtime.

**Migration-owned database objects.** `outbox_events_failed_idx` (partial) and
`outbox_events_lease_all_or_none` (CHECK) cannot be represented in
`schema.prisma` — Prisma 5 supports neither. They were kept rather than
downgraded. Consequences: `prisma migrate diff` may report them, and that output
must **not** be a blanket pass/fail gate; CI must separate these two known
objects from any other drift and fail on anything else, and must assert them
positively against `pg_indexes.indexdef` and `pg_get_constraintdef`. A unit test
guards offline that no later migration drops either.

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
| Acceptance gate | zero critical accessibility violations; no horizontal scroll at 360px; CSP without `unsafe-inline`; **the image-origin debt below closed** |
| Depends on | 8B–8F |
| Risks | may surface debt from earlier batches; its duration must not be compressed |

#### Carried debt that 8G must close

**Branding and media URL origins vs. CSP.** Three kinds of image URL now reach
the browser, and none of them is covered by a production CSP yet:

1. `BrandingPublic.logoMainUrl` / `logoSmallUrl` / `faviconUrl` — arbitrary
   absolute URLs entered by an administrator, so their origin is not knowable at
   build time.
2. `GET /api/v1/banners/:id/image` and `GET /api/v1/opportunities/:id/image` —
   served from the **API** origin, which differs from the web origin in every
   deployed environment.
3. Both are rendered with a plain `<img>` rather than `next/image`, because the
   dimensions are unknown at build time and `next/image` would need a
   per-environment `remotePatterns` allowlist.

8G must therefore decide, and encode, a real `img-src` that admits the API origin
and whatever branding origins are permitted — and constrain what an administrator
may enter for a branding URL, since a `img-src` wide enough for any URL an admin
can type is not a policy. Until then there is no CSP restricting where an image
may be loaded from.

**Branding is fetched with `cache: "no-store"`** on every render (8B.1), pending
the caching decision 8G owes.

---

## 11. Totals

| Metric | Value |
|---|---|
| Migrations | **87 → 90** (88 banners, 89 outbox relay, 90 notifications) |
| Migrations on disk now | **89** — 88 banners, 89 `20260824000100_8d0_add_outbox_relay_fields` |
| Endpoints | **178 → 208** (+30; 8D0 adds zero) |
| Endpoints measured now (after 8D0) | **195** |
| Batches | **7** — 8B (+8B.1), 8C, 8D0, 8D, 8E, 8F, 8G |
| Notification types | 18, of which **13** emit `EMAIL_NOTIFICATION_V1` |
| Legacy outbox event types left outside the relay | 13 |
| Shared wire enums | 9 |

New endpoints by group:

| Group | Count | Batch | Status |
|---|---|---|---|
| Public branding | 1 | 8B | delivered |
| Admin brand theme | 4 | 8B.1 | delivered |
| Banners — public 2 + admin 6 + admin image 3 | 11 | 8C | delivered |
| Opportunity image — public | 1 | 8C | delivered |
| Outbox relay | **0** | 8D0 | delivered |
| Notifications | 4 | 8D | planned |
| Trader documents | 1 | 8D | planned |
| Trader disputes + replacements list/detail | 3 | 8D | planned |
| Supplier documents | 1 | 8E | planned |
| Supplier settlements | 2 | 8E | planned |
| Audit log viewer | 1 | 8F | planned |
| Outbox stats | 1 | 8F | planned |
| **Total** | **30** | | |

**How the totals reconcile.** 178 measured before Phase 8, +5 delivered in
8B/8B.1, +12 delivered in 8C, **+0 in 8D0** = **195 measured today**. The
remaining 13 planned endpoints (8 in 8D, 3 in 8E, 2 in 8F) bring the phase to
**208**.

The +30 figure supersedes the earlier +27. Three revisions produced it: 8B.1
added the four admin brand-theme routes; 8C came in at 12 against an estimate of 8
because image delivery had to be built from nothing; and 8D grew from 5 to 8 once
the trader portal's disputes and replacements screens were found to have no read
endpoints at all.

Migrations are unaffected by any of it: 8B.1 stores themes as `system_settings`
rows, 8C's only schema change is migration 88, and 8D0's is migration 89 — so the
planned final total stays **87 → 90**, with 90 (`create_notifications`) arriving
in 8D.

8C added **no new endpoint** for sorting, the widened opportunity detail, or the
reshaped lookup endpoints — those are a query parameter and response projections
on routes that already existed.

There is deliberately **no** `DELETE /admin/banners/:id` — deactivation only, which
preserves the audit trail and avoids orphaned storage objects.

---

## 11.1 Test execution status

Not every written test has been executed. This section records which, so that
"written" is never mistaken for "passing".

### Executed locally and passing — as of the 8D0 delivery commit

| Suite | Command | Result |
|---|---|---|
| `apps/api` unit (Jest, `src/**/*.spec.ts`) | `pnpm --filter api run test` | **719 passing**, 56 suites |
| `apps/web` (Vitest) | `pnpm --filter web run test` | **511 passing**, 18 files |
| **`apps/worker` unit** | `pnpm --filter worker run test` | **196 passing**, 7 suites |
| **`packages/email`** | `pnpm --filter @platform/email test` | **165 passing**, 7 suites |
| `packages/config` | `pnpm --filter @platform/config test` | **31 passing**, 2 suites |
| `packages/types` guard (`node --test`) | `pnpm --filter @platform/types test` | **5 passing** |
| `packages/domain` | `pnpm --filter @platform/domain test` | **66 passing** |
| build scripts | `pnpm run test:scripts` | **22 passing** |
| builds — email, config, api, worker | `pnpm --filter <pkg> build` | all green |
| typecheck (every workspace) | `pnpm -r run typecheck` | `EXIT=0` |
| lint (every workspace) | `pnpm -r run lint` | `EXIT=0` |
| web production build | `pnpm --filter web run build` | `EXIT=0`, 10 locale routes + `/_not-found` |
| Prisma schema validity | `prisma validate` | valid |
| Endpoint recount · migration count | script | **195** · **89** |

These figures are the ones actually printed by those commands on the delivery
run. Where a number here disagrees with an older section of this document, this
table is the later measurement.

### Written but NOT executed

**`apps/api/test/branding-public.e2e-spec.ts` — 13 cases across two suites.**

Covering: 200 with no session; all-null fallback; exact public key set; admin-only
and internal fields never exposed (key-level and value-level); CSRF not required for
the public GET; POST rejected; default theme when unconfigured; active theme once
published; **the draft never reaching the public surface**; default served when only
a draft exists; corrupt stored theme resolving to defaults; theme exposing only the
four colour keys with no admin or validation metadata; the four admin theme routes
requiring an admin session; state-changing admin routes refused without a CSRF
origin; and no trader, supplier, or public route to the theme.

These have **never been run**. The development machine has no PostgreSQL, Redis, or
MinIO — ports 5432, 6379 and 9000 are closed — and the E2E suite requires all three.
They are expected to run for the first time on GitHub Actions, where those services
are provided.

**Their status is therefore unknown, not passing.** Until a CI run is green, no
document, report, or commit message may describe them as verified. The security
properties they assert — chiefly that the theme draft is never publicly readable —
are separately covered by executed unit tests in
`src/branding/brand-theme.service.spec.ts` and
`src/branding/branding.service.spec.ts`, which is why 8B.1 was accepted without
them; that is a mitigation, not a substitute.

The same applies to every other pre-existing `*.e2e-spec.ts` and
`*.integration-spec.ts` file in the repository: none of them run on this machine.

### 8C — written but NOT executed

**Status: WRITTEN — NOT EXECUTED — STATUS UNKNOWN.**

| File | Covers |
|---|---|
| `apps/api/test/banners.e2e-spec.ts` | LIVE-window visibility, admin CRUD, schedule, reorder, image upload/serve/delete, link rejection, audit entries |
| `apps/api/test/opportunity-image.e2e-spec.ts` | public image visibility, variants, conditional requests, legacy snapshots with no media |
| `apps/api/test/opportunity-discovery.e2e-spec.ts` (extended in 8C) | sort default, `ENDING_SOON` ordering, pagination with no duplicate or dropped row, filter + sort composition, invalid sort → 400 |

None of these has ever been run. Ports 5432, 6379 and 9000 are closed on this
machine and the E2E suites require PostgreSQL, Redis and MinIO together. They
typecheck and lint; that is the entire extent of what is known about them.

### Migration 88 — created and validated, not applied

**Status: CREATED / VALIDATED — NOT APPLIED LOCALLY.**

`prisma validate` passes and the SQL was reviewed by hand against
`schema.prisma`: the enum, the composite index, and all three CHECK constraints
correspond, the eight image columns in the all-or-none constraint match the eight
declared on the model, and the content-type allowlist
(`image/jpeg`, `image/png`, `image/webp`) matches exactly what
`processImage` emits.

It has **never been executed against a database**. `prisma migrate deploy` has
not run, no shadow-database diff has been taken, and no drift check has been
performed — all three need a live PostgreSQL. Nothing may describe this migration
as applied.

### Behaviour that stays UNVERIFIED until CI / PostgreSQL

These are properties that unit tests **cannot** establish, because they are
enforced by the database rather than by application code. Every one is asserted
only at the level of the query or statement the service emits:

| Property | Why a unit test cannot settle it |
|---|---|
| `pg_advisory_xact_lock` placement serialisation | Real lock contention needs concurrent sessions |
| Database `now()` via `$queryRaw` | A mock returns whatever it is told |
| The three CHECK constraints on `promotional_banners` | Enforced by PostgreSQL, not by Prisma |
| Concurrent-live-banner limits under true concurrency | Requires overlapping transactions |
| Pagination returning no duplicate or dropped row | Requires a real result set and a real `ORDER BY` |

**Status: UNVERIFIED UNTIL CI / POSTGRESQL.**

### 8D0 — written but NOT executed

**Status: WRITTEN — NOT EXECUTED — STATUS UNKNOWN.**

| File | Covers |
|---|---|
| `apps/worker/test/outbox-relay-claim.integration-spec.ts` | attempt-budget transitions, terminalisation, legacy rows untouched, backoff deferral, two clients under `SKIP LOCKED`, stale-token settlement, the CHECK constraint's four cases, lease arithmetic |
| `apps/worker/test/outbox-relay-processor.integration-spec.ts` | end-to-end publish, no resend of a published row, dead-lettering, budget exhaustion, real abort on timeout, log leakage, no `AuditLog` written |

Neither has ever run. Ports 5432, 6379 and 9000 are closed on this machine.

### Migration 89 — created and validated, not applied

**Status: CREATED / VALIDATED — NOT APPLIED LOCALLY.**

`prisma validate` passes and the SQL was reviewed against `schema.prisma`: the
`PROCESSING` enum value, the seven nullable columns, the claim index, the partial
failed index and the CHECK all correspond, and a unit test asserts the mapping
field by field.

It has **never been executed against a database**. In particular it is **not a
wholly metadata-only migration**: the columns are nullable with no default so no
row data is rewritten, but `ADD CONSTRAINT … CHECK` may require PostgreSQL to
scan the table to validate existing rows, holding a lock for the duration. That
scan — not the `ADD COLUMN`s — is what deserves a maintenance window on a large
`outbox_events`.

### 8D0 behaviour that stays UNVERIFIED until CI / PostgreSQL

Every one of these is asserted **only at the level of the SQL or the decision
logic**, never observed:

| Property | Why a local test cannot settle it |
|---|---|
| `FOR UPDATE SKIP LOCKED` splitting a batch between workers | Needs two live sessions |
| Two-worker concurrency generally | Same |
| Crash recovery via lease expiry | Needs a real clock and a real lease |
| The all-or-none CHECK rejecting a partial lease | Enforced by PostgreSQL, not by Prisma |
| The partial index existing with its predicate | Needs `pg_indexes` |
| Migration 89 applying to a fresh and to an upgraded database | Needs a database |
| `prisma migrate diff` drift, minus the two migration-owned objects | Needs a shadow database |

**In particular: duplicate prevention and at-least-once behaviour are NOT
demonstrated.** The stable idempotency key is asserted to be passed and to be
identical across attempts; whether a duplicate is actually collapsed depends on a
real provider honouring it, and no real provider exists. Nothing here may be
described as proven duplicate-free.

**Status: UNVERIFIED UNTIL CI / POSTGRESQL.**

---

## 12. Deferred beyond Phase 8

- **Admin Banner UI → 8F.** The 9 admin banner endpoints are delivered and
  unit-tested in 8C; no screen calls them yet.
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

## 14. Visual identity (approved)

Light mode only. Dark mode is out of Phase 8.

### 14.1 Approved palette

| Role | Token | Hex |
|---|---|---|
| Primary / Navy | `--color-primary` | `#0B1F33` |
| Secondary / Emerald | `--color-secondary` | `#0F766E` |
| Accent / Gold | `--color-accent` | `#F59E0B` |
| Accent interactive | `--color-accent-interactive` | `#B45309` |
| Background | `--color-background` | `#F8FAFC` |
| Surface | `--color-surface` | `#FFFFFF` |
| Primary text | `--color-text` | `#0F172A` |
| Muted text | `--color-text-muted` | `#475569` |
| Border | `--color-border` | `#E2E8F0` |
| Success | `--color-success` | `#15803D` |
| Warning | `--color-warning` | `#D97706` |
| Danger | `--color-danger` | `#DC2626` |

### 14.2 Usage rules

- Navy carries identity, trust, and primary structural elements (header, shell).
- Emerald drives primary actions, success, and growth.
- Gold marks distinction and opportunities, **with dark text only**.
- An orange button with white text uses `#B45309`, never `#F59E0B`.
- Colours are defined once as central design tokens. **Hex values must never be
  repeated inside components** — enforced by a test.
- The brand name and logo are dynamic, from the Branding API. **Branding settings
  cannot change system colours in Phase 8.**
- CSS logical properties throughout. `left` / `right` physical properties are
  prohibited for size and position wherever a logical equivalent exists.
- `dangerouslySetInnerHTML` is prohibited.
- No hardcoded user-visible strings.
- Arabic is the primary experience; `en-SA` and RTL/LTR support are mandatory.
- Modern, clean, professional B2B: medium radii, light shadows, generous spacing.
- Responsive from 360px upward.

### 14.3 Measured WCAG results

Contrast ratios computed from the approved hex values. Text targets AA (4.5:1);
non-text UI targets 3:1.

| Pair | Ratio | Verdict |
|---|---|---|
| Text `#0F172A` on Background `#F8FAFC` | 17.06:1 | AAA |
| Text `#0F172A` on Surface `#FFFFFF` | 17.85:1 | AAA |
| Muted `#475569` on Background `#F8FAFC` | 7.24:1 | AAA |
| Muted `#475569` on Surface `#FFFFFF` | 7.58:1 | AAA |
| White on Navy `#0B1F33` | 16.69:1 | AAA |
| White on Emerald `#0F766E` | 5.47:1 | AA |
| White on Accent interactive `#B45309` | 5.02:1 | AA |
| Dark `#0F172A` on Gold `#F59E0B` | 8.31:1 | AAA |
| White on Success `#15803D` | 5.02:1 | AA |
| White on Danger `#DC2626` | 4.83:1 | AA |
| Navy focus ring on Background `#F8FAFC` | 15.95:1 | passes 3:1 |
| Emerald focus ring on Surface `#FFFFFF` | 5.47:1 | passes 3:1 |

### 14.4 Three measured failures and their resolutions

These were found by measuring the palette, not assumed. Each is resolved by a token
rule, not by changing an approved colour.

**F1 — White on Gold `#F59E0B` = 2.15:1 (fails 4.5:1).**
Resolved by the approved rule itself: gold carries **dark text only**
(`#0F172A` on gold = 8.31:1). No token pairs white with gold, and the button
component has no white-on-accent variant.

**F2 — White on Warning `#D97706` = 3.19:1 (fails 4.5:1).**
`#D97706` is therefore **never a background for white text**. Two tokens:

- `--color-warning` = `#D97706` — borders, icons, and surfaces that carry **dark**
  text (`#0F172A` on `#D97706` = 5.60:1, AA).
- `--color-warning-text` = `#B45309` — warning text on a light warning surface
  (`#B45309` on `#FFFBEB` = 4.84:1, AA). `#D97706` as text on `#FFFBEB` is 3.07:1
  and is not used for text.

**F3 — Border `#E2E8F0` on Surface `#FFFFFF` = 1.23:1.**
Acceptable for decorative dividers and card edges, which WCAG 1.4.11 does not
require to meet 3:1. It is **not** acceptable for a form control whose boundary is
the only indicator of the control. A second token is therefore required:

- `--color-border` = `#E2E8F0` — decorative dividers, card edges.
- `--color-border-strong` = `#64748B` — input, select, checkbox, and radio borders
  (4.76:1 against white, passes 3:1). `#94A3B8` was measured at 2.56:1 and rejected.

### 14.5 Dynamic brand theme (approved)

Four identity colours are **admin-configurable globally**. Everything else
is fixed and cannot be changed by branding settings.

| Themeable (admin-controlled) | Default |
|---|---|
| Primary | `#0B1F33` |
| Secondary | `#0F766E` |
| Accent | `#F59E0B` |
| Accent interactive | `#B45309` |

| Fixed (never admin-controlled) | Value |
|---|---|
| Background | `#F8FAFC` |
| Surface | `#FFFFFF` |
| Primary text | `#0F172A` |
| Muted text | `#475569` |
| Border | `#E2E8F0` |
| Success | `#15803D` |
| Warning | `#D97706` |
| Danger | `#DC2626` |

Fixing the semantic and neutral colours is what keeps the accessibility
guarantees in §14.3/§14.4 provable: contrast only has to be re-verified
for the four identity colours against known-fixed counterparts, instead
of re-verifying an unbounded matrix on every change.

**The colour picker UI ships in 8F, not in 8B.1.** 8B.1 delivers the
storage, contracts, validation, admin APIs, public exposure, and runtime
application only.

#### Storage model

Three distinct states, no new table and no migration:

| State | Where |
|---|---|
| Active published theme | `system_settings["brand_theme_active"]` |
| Theme draft | `system_settings["brand_theme_draft"]` |
| Default FORSA theme | a code constant in `@platform/types` |

The default lives in code, not in a row, so it cannot be corrupted,
deleted, or silently edited — it is the anchor every fallback resolves
to.

`SystemSetting` is a key→JSON registry with no version chain; the
`*Version` tables (`CommissionPolicyVersion`, `ShareTierPolicyVersion`,
`PlatformBillingProfileVersion`, …) exist for financial and legal
policies where an immutable chain is required to audit money. A
presentational theme does not carry that requirement. History is instead
non-silent through `AuditLog`, which records before/after for every
draft save, publish, and reset.

#### Validation

Accepted input is a full six-digit hex only, `^#[0-9A-Fa-f]{6}$`,
normalised to uppercase. Rejected: CSS variables, `rgb()`/`hsl()`,
colour names, alpha channels, `url()`, and any raw CSS or script.

Required contrast before publish:

| Pair | Minimum |
|---|---|
| Primary vs white text | 4.5:1 |
| Secondary vs white text | 4.5:1 |
| Accent vs fixed primary text `#0F172A` | 4.5:1 |
| Accent interactive vs white text | 4.5:1 |
| Focus indicator vs background and vs surface | 3:1 |

**Draft versus publish policy.** A malformed hex is rejected on save —
it is structurally invalid, no picker can produce it, and storing it
would corrupt the row. Contrast failures *are* saved, so the 8F admin
screen can show an admin exactly which pairs fail while they experiment.
**Publish is refused outright on any issue, format or contrast.**

---

### 14.6 Derived tokens

Beyond the twelve approved colours, only these derived values are permitted, and
each is defined centrally:

| Token | Value | Purpose |
|---|---|---|
| `--color-border-strong` | `#64748B` | form control borders (F3) |
| `--color-warning-text` | `#B45309` | warning text on light surfaces (F2) |
| `--color-warning-surface` | `#FFFBEB` | warning banner background |
| `--color-focus-ring` | `#0B1F33` | visible focus outline |
| `--color-on-primary` | `#FFFFFF` | text on navy |
| `--color-on-secondary` | `#FFFFFF` | text on emerald |
| `--color-on-accent` | `#0F172A` | text on gold — dark only (F1) |

---

## 15. Approval

- Plan approved on the `phase-8` branch, on top of `phases-1-7-final` (`2d5698f`).
- Implementation of 8B has **not** started and requires separate approval.
