# PDPL Readiness — Design Posture

PDPL = the Saudi Personal Data Protection Law (نظام حماية البيانات
الشخصية). This document is the design *posture* Phase 1 establishes;
it is not itself a legal compliance certification, and no legal text
is authored here.

## Status in Phase 1

No business entities exist yet in Phase 1 — only cross-cutting
infrastructure tables (`audit_logs`, `system_settings`,
`branding_settings`, `idempotency_keys`, `outbox_events`). None of
these store personal data about traders, suppliers, or individuals.
There is therefore no personal data to protect yet in Phase 1 — but
the rules below apply to every table introduced from Phase 2 onward.

## Rules for future entities (Phase 2+)

1. Every new table that may hold personal or company-sensitive data
   must be reviewed for data classification (public / sensitive /
   confidential) before it ships.
2. Sensitive fields are never logged in plaintext. Structured logs
   (Pino) must redact or omit them.
3. `audit_logs` exists from Phase 1 specifically so that every
   sensitive change from Phase 2 onward is traceable from day one, not
   retrofitted later.
4. Deletion of personal data (where legally required) is handled as a
   deliberate, audited workflow — never a silent hard delete, and never
   in conflict with the platform's "no hard delete on financial/
   transactional records" rule. Where the two requirements interact,
   the resolution (e.g. anonymization instead of deletion) is a
   decision for the phase that introduces the relevant entity, made
   with legal input.
5. Data residency and cross-border transfer questions are deferred to
   the phase that introduces real infrastructure hosting decisions —
   Phase 1 only ships a local development stack.

This posture will be revisited and expanded as each phase introduces
entities that actually hold personal data.
