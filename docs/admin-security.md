# Admin Security — Phase 3

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
