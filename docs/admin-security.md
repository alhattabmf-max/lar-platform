# Admin Security

Phase 3 established the login, 2FA and rate-limiting model. Phase 8F added
the admin portal, and with it the session-status re-check, the projection
boundary, and the account-creation policy recorded at the end of this file.

## `ADMIN_TOTP_ENCRYPTION_KEY`

A 32-byte key (64 hex characters) used with AES-256-GCM to encrypt
every Admin 2FA TOTP secret at rest in `admin_users.two_factor_secret_encrypted`.

**Handling rules — no exceptions:**

- **Never committed.** `.env` is gitignored (verified: `git check-ignore -v .env`
  confirms it, and `git log --all -- .env` is empty — it has never been
  committed). The key exists only in the local `.env` file and is
  regenerated per environment.
- **Production never uses a value from the repository.** Production
  deployments must inject this key via an external secrets manager
  (Blueprint §65: "Secrets Manager"), not a `.env` file shipped with
  the codebase. There is no default/fallback key baked into the code —
  if the variable is missing, `loadEnv()` fails startup outright.
- **Never logged, printed, or included in any report.** The key itself
  is read once per process from `env.ADMIN_TOTP_ENCRYPTION_KEY` and
  used only as an argument to `encryptSecret`/`decryptSecret`
  (`common/security/crypto.util.ts`). It is never interpolated into a
  log line, error message, audit row, or test snapshot. Grep the
  codebase for `ADMIN_TOTP_ENCRYPTION_KEY` to confirm every usage is a
  pass-through, never a print.
- **The plaintext TOTP secret and recovery codes are shown to the
  operator exactly once** (in the `POST /admin/auth/2fa/setup`
  response body), at generation time. Response bodies are not
  captured by the structured HTTP logger (`pino-http` logs request/
  response *metadata* — headers, status, timing — never the JSON
  body), so this one-time value does not end up in logs either way.
- **Key loss is unrecoverable by design.** If `ADMIN_TOTP_ENCRYPTION_KEY`
  is lost or rotated without a migration plan, every existing admin's
  stored TOTP secret becomes permanently undecryptable — those admins
  can no longer generate valid codes and must fall back to a recovery
  code, or have an operator with direct database access reset their
  `two_factor_secret_encrypted` to `NULL` (which puts them back through
  first-time 2FA enrollment on next login). This is the accepted
  trade-off of encrypting the secret instead of storing it in
  plaintext; back up the key with the same rigor as any other
  production secret.

## Rate limiting — dual-key, Redis-backed, atomic

Both `POST /admin/auth/login` and the 2FA endpoints
(`2fa/setup/confirm`, `2fa/verify`) enforce **two independent limits**
per attempt, both backed by the same `RedisThrottlerStorage` (atomic
`INCR`, correct across multiple API instances since Redis is the
shared source of truth — not per-process memory):

- **Login** — by client IP, and separately by a SHA-256 hash of the
  normalized (trimmed, lowercased) email. This stops both "one IP
  spraying many admin emails" and "many IPs targeting one admin email"
  — either alone would miss one of the two attack shapes.
- **2FA verification** — by client IP, and separately by the login
  ticket id itself. The ticket is a 256-bit random, single-purpose,
  already-admin-bound value (see below), so limiting by it is
  equivalent to limiting per login attempt.

No raw password, TOTP code, or recovery code is ever used as (or
embedded in) a Redis key — only the client IP, a hash of the email, or
the opaque ticket id. A successful attempt does not reset or clear
either counter early; counters expire naturally on their configured
TTL regardless of outcome, so a successful login cannot be used to
"refresh" brute-force headroom.

## Login ticket properties (verified)

The two-stage login ticket (`AdminLoginTicketService`) is:

- **Short-lived** — 5 minute Redis TTL, independent of the eventual
  admin session TTL.
- **Single-use on success** — `tickets.consume()` deletes the Redis key
  immediately after a successful 2FA/recovery verification, *before*
  the full session is issued. A replay of the same ticket afterward
  finds nothing (`tickets.get()` returns null) and is rejected.
- **Bound to one admin for its entire lifetime** — `adminUserId` is
  set once, at ticket creation in `login()` (only after password
  verification succeeds), and every subsequent stage reads it back
  from the stored ticket — never from client-supplied input. There is
  no request parameter that lets a caller redirect a ticket to a
  different admin between stages.

## Session issue re-checks account status — Phase 8F

`AdminAuthService.issueSession()` re-reads the admin row and refuses
anything other than `ACTIVE` before a session cookie is minted.

The gap this closed: a login ticket is bound to one admin for its
lifetime, but it carries no *status* — status was checked once, in
`login()`, before the password stage. An administrator disabled in the
window between entering their password and entering their TOTP code
could therefore complete the second stage and receive a live session.
The window is small, and it is exactly the window that matters: an
account is usually disabled because someone wants that person out
*now*.

The check is placed at `issueSession()` rather than in each caller
because both stage-2 paths — `verify2fa()` for a returning
administrator and `confirm2faSetup()` for a first enrolment — go
through it. A per-path check is one that a third path added later can
omit.

`AdminSessionAuthGuard` performs the equivalent check on every
subsequent request, and `GET /admin/auth/me` re-reads the row rather
than trusting the session blob, so a disabled account also stops
rendering the portal on its next navigation.

## What an administrator can and cannot see — Phase 8F

An administrator sees everything they need to operate the platform, and
that is deliberately not the same as everything the database holds.
Nothing below is a policy an endpoint checks; each is a column that is
never selected, which is stronger than a column that is selected and
then dropped.

Absent from every admin response:

| Material | Where it lives |
|---|---|
| Password hashes | `AdminUser.passwordHash`, `User.passwordHash` |
| TOTP secrets | `AdminUser.twoFactorSecretEncrypted` |
| Recovery codes | `AdminRecoveryCode.codeHash` — a COUNT is exposed, never a code |
| IBAN ciphertext and blind index | `SupplierBankAccount` — only `ibanLast4` travels |
| Object storage keys | product media, dispute evidence, product-report evidence, banner images |
| Raw outbox payloads | `OutboxEvent.payload` — it carries the recipient address |
| Audit before/after copies | `AuditLog.beforeData` / `afterData` |
| Request forensics | `AuditLog.ipAddress` / `userAgent` |
| Session identifiers | the Redis admin session store |
| Frozen invoice computations | `InvoiceDocument.snapshotData` |
| Refund attempt idempotency keys | `RefundAttempt.idempotencyKey` |

One field is admin-only and appears nowhere else: a supplier payout's
`externalTransferReference`. The operator performed the transfer and
needs the bank's reference to reconcile it; the supplier's own
settlement view does not carry the field.

Asserted in `apps/api/src/common/contracts/admin-contracts.spec.ts` and
`apps/web/__tests__/admin-portal.test.tsx`. The forbidden-field lists
live in `apps/api/src/common/contracts/admin-forbidden-fields.ts` and
are deliberately server-side only: shipping a catalogue of the
platform's most sensitive column names to the browser would hand anyone
who opens devtools an inventory of exactly what to look for.

## Administrator accounts are created out of band — Phase 8F

There is no HTTP route that creates an administrator, and the portal
says so rather than leaving the absence to look like an unfinished
screen. Accounts are created with the bootstrap command on the server,
by someone with shell access.

The reason is narrow: a self-service creation endpoint would make one
compromised admin session enough to mint a second, permanent one that
survives the first being disabled.

Two lifecycle rules follow, both enforced server-side:

- **An administrator cannot disable themselves.** Locking yourself out
  of the console is not a recoverable mistake.
- **The last ACTIVE administrator cannot be disabled.** The count is
  taken *inside* the transaction that performs the disable, so two
  concurrent requests cannot each observe two active administrators and
  both proceed.

## Money on the dispute refund path — Phase 8F

Every amount in an administrator's dispute decision is a canonical
two-place decimal STRING from the request body to the database write.
There is no `Number`, no `parseFloat` and no `toNumber` anywhere on the
path, and a test reads both source files to prove it rather than
trusting review.

What that replaced: the controller called
`Number(dto.productRefundAmountInclTax)` on a value the DTO had already
validated as an exact decimal, putting an IEEE-754 double in the middle
of the decision that determines how much money leaves the platform.

The four properties that now hold:

| Property | How |
|---|---|
| The digits stored are the digits that arrived | `new Prisma.Decimal(originalString)` |
| A refund cannot exceed its frozen bound | `Decimal.lessThanOrEqualTo`, never `a > b` on numbers |
| The journal entry balances for EVERY input | the supplier debit is derived by subtraction, so the two reversals cancel |
| Rounding happens once, with a stated mode | `Decimal.toFixed(2, ROUND_HALF_UP)` on the product, never on the ratio |

Refused before any arithmetic: more than two decimal places, fewer than
two, scientific notation in either case, `NaN`, `Infinity`, a negative,
surrounding whitespace, a thousands separator, a non-string, and any
value too large for the column. The last one matters because
`new Decimal("1e3")` succeeds and `new Decimal("NaN")` produces a value
that propagates silently through every later operation instead of
throwing.

**Column precisions, stated because they are easy to get wrong.**
`DisputeDecision.productRefundAmountInclTax`, `.shippingRefundAmount`
and `RefundObligation.amount` are `Decimal(14,2)` — twelve integer
digits. `OrderAllocationFinancialSnapshot.shippingFeeAmount` is
`Decimal(12,2)` — ten. `numeric(p,s)` allows `p - s` digits before the
point, and exceeding it is `numeric field overflow`: a 500 raised by the
driver after the request has already been accepted. `IsDecimalString`
now bounds magnitude as well as shape, so that surfaces as a 400 naming
the field.

Asserted in `packages/domain/src/dispute-refund-exact.spec.ts` (61
tests) and `apps/api/src/disputes/dispute-money.spec.ts` (33 tests).
