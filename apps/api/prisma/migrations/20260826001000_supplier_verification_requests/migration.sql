-- One request reviews a supplier's whole record.
--
-- WHY A TABLE AND NOT COLUMNS ON `companies`. "One request to review
-- everything as a package" is literally a request: it has an author, a
-- moment, a decision and a reason, and a supplier who is returned and
-- resubmits has a SECOND one. Columns on the company would keep only
-- the latest of each and lose the history the decision trail needs.
--
-- `companies.verification_status` is untouched by this migration and
-- remains the only authority on whether a company may trade.

CREATE TYPE "SupplierVerificationRequestStatus" AS ENUM (
  'UNDER_REVIEW',
  'RETURNED_FOR_COMPLETION',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "supplier_verification_requests" (
  "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id"           UUID NOT NULL,
  "status"               "SupplierVerificationRequestStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
  "submitted_by_user_id" UUID NOT NULL,
  "submitted_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by_admin_id"  UUID,
  "decided_at"           TIMESTAMPTZ(3),
  -- Shown to the SUPPLIER verbatim. Required on a return and on a
  -- rejection; the service enforces that, because a decision the
  -- supplier cannot act on is a dead end.
  "decision_reason"      TEXT,
  "created_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "supplier_verification_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supplier_verification_requests_company_id_idx"
  ON "supplier_verification_requests" ("company_id");

CREATE INDEX "supplier_verification_requests_status_idx"
  ON "supplier_verification_requests" ("status");

ALTER TABLE "supplier_verification_requests"
  ADD CONSTRAINT "supplier_verification_requests_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies" ("id")
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- At most one OPEN request per company, including when two submissions
-- race after both observed that none was open. Prisma's schema
-- language cannot express a WHERE clause on an index, so this is raw —
-- the same shape `supplier_bank_accounts_one_pending_per_company`
-- already uses.
CREATE UNIQUE INDEX "supplier_verification_requests_one_open_per_company"
  ON "supplier_verification_requests" ("company_id")
  WHERE "status" = 'UNDER_REVIEW';
