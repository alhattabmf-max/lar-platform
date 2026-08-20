-- Extends ProductApprovalStatus with SUSPENDED (temporary, report-driven
-- admin hold) and CLOSED (permanent). Kept isolated in its own
-- migration/transaction per Postgres's ADD VALUE restriction — this
-- migration does not use either new value in any DML, so it is safe
-- even on pre-12 semantics.

ALTER TYPE "ProductApprovalStatus" ADD VALUE 'SUSPENDED';
ALTER TYPE "ProductApprovalStatus" ADD VALUE 'CLOSED';
