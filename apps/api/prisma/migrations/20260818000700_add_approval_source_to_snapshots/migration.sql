CREATE TYPE "ApprovalSource" AS ENUM ('ADMIN', 'AUTO');

ALTER TABLE "product_approval_snapshots" ADD COLUMN "approval_source" "ApprovalSource";
ALTER TABLE "product_approval_snapshots" ALTER COLUMN "approved_by_admin_id" DROP NOT NULL;
