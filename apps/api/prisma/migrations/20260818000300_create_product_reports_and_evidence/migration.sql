CREATE TYPE "ProductReportReasonCode" AS ENUM ('COUNTERFEIT', 'MISLEADING_INFO', 'SAFETY_CONCERN', 'REGULATORY_CONCERN', 'INTELLECTUAL_PROPERTY', 'INAPPROPRIATE_CONTENT', 'DUPLICATE_OR_SPAM', 'OTHER');
CREATE TYPE "ProductReportStatus" AS ENUM ('OPEN', 'CLARIFICATION_REQUESTED', 'DISMISSED', 'RESOLVED');

CREATE TABLE "product_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "reporter_company_id" UUID NOT NULL,
    "reported_product_approval_snapshot_id" UUID NOT NULL,
    "reason_code" "ProductReportReasonCode" NOT NULL,
    "reason_details" TEXT,
    "status" "ProductReportStatus" NOT NULL DEFAULT 'OPEN',
    "admin_decision_note" TEXT,
    "resolved_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_reports_product_id_idx" ON "product_reports"("product_id");
CREATE INDEX "product_reports_reporter_company_id_idx" ON "product_reports"("reporter_company_id");

CREATE UNIQUE INDEX "product_reports_one_open_per_reporter"
  ON "product_reports"("product_id", "reporter_company_id")
  WHERE "status" = 'OPEN';

ALTER TABLE "product_reports" ADD CONSTRAINT "product_reports_reason_details_required_for_other"
  CHECK ("reason_code" != 'OTHER' OR ("reason_details" IS NOT NULL AND length("reason_details") > 0));
ALTER TABLE "product_reports" ADD CONSTRAINT "product_reports_reason_details_length"
  CHECK ("reason_details" IS NULL OR length("reason_details") <= 2000);

ALTER TABLE "product_reports" ADD CONSTRAINT "product_reports_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_reports" ADD CONSTRAINT "product_reports_reported_product_approval_snapshot_id_fkey"
  FOREIGN KEY ("reported_product_approval_snapshot_id") REFERENCES "product_approval_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "product_report_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "report_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_report_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_report_evidence_report_id_idx" ON "product_report_evidence"("report_id");

ALTER TABLE "product_report_evidence" ADD CONSTRAINT "product_report_evidence_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "product_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
