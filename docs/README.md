# Documentation Index

| Document | What it covers |
|---|---|
| [`architecture.md`](./architecture.md) | Full system architecture across Phases 1–7: Auth, Companies, Products, Opportunities, Checkout, Payment/Ledger, Fulfillment, Disputes, Replacement, Refunds, Settlement, Internal Invoice Drafts. The single best starting point for understanding the system. |
| [`admin-security.md`](./admin-security.md) | Admin authentication, 2FA (TOTP) enrollment/verification, admin session lifecycle. |
| [`error-codes.md`](./error-codes.md) | The Error Envelope contract and the full error code catalogue. |
| [`pdpl-readiness.md`](./pdpl-readiness.md) | PDPL (Saudi Personal Data Protection Law) design posture — what personal data is collected, how it's protected, retention stance. |
| [`PHASE_8_IMPLEMENTATION_PLAN.md`](./PHASE_8_IMPLEMENTATION_PLAN.md) | The approved Phase 8 plan (web application): batches 8B → 8C → 8D0 → 8D → 8E → 8F → 8G, the Outbox relay design, new schema, legal constraints, and deferred items. |
| [`PHASE_5_FINAL_VERIFICATION_REPORT.md`](./PHASE_5_FINAL_VERIFICATION_REPORT.md) | Historical verification record for Phases 1–5, written at that point in the project. Kept for audit trail — later phases (6, 7A–7E) are covered in `architecture.md` and their own session reports, not restated here. |

## Related, outside `docs/`

- [`../README.md`](../README.md) — setup, running locally, quality checks.
- [`../scripts/db/README.md`](../scripts/db/README.md) — database backup/restore scripts.
