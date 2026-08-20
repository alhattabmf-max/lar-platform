-- Discovered via live E2E testing: opportunities_share_quantity_exact_division
-- (added in 20260817000300) unconditionally required
-- target_quantity * share_basis_points % 10000 = 0 for any row with a
-- non-null share_basis_points. But ACTION_REQUIRED rows are
-- DELIBERATELY allowed to have target_quantity drift away from what
-- the frozen share_basis_points/share_quantity were computed from —
-- a plain PATCH while ACTION_REQUIRED never touches the stale
-- snapshot (see opportunities.service.ts: only publish()/republish
-- recomputes it). The two designs conflicted; this migration
-- resolves it by exempting ACTION_REQUIRED specifically from this one
-- check, exactly like DRAFT/CANCELLED are already exempted from the
-- broader snapshot-consistency check.
--
-- This is a strictly MORE PERMISSIVE constraint than the one it
-- replaces (adds one extra allowed case), so it can never reject any
-- row that already satisfied the old constraint — no backfill or
-- data migration is needed here.

ALTER TABLE "opportunities" DROP CONSTRAINT "opportunities_share_quantity_exact_division";

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_share_quantity_exact_division" CHECK (
  "share_basis_points" IS NULL
  OR "status" = 'ACTION_REQUIRED'
  OR ("target_quantity" * "share_basis_points") % 10000 = 0
);
