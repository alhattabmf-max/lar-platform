ALTER TABLE "opportunities" ADD COLUMN "commission_policy_version_id" UUID;
ALTER TABLE "opportunities" ADD COLUMN "commission_rate_basis_points" INTEGER;
ALTER TABLE "opportunities" ADD COLUMN "package_content_quantity" DECIMAL(10,3);
ALTER TABLE "opportunities" ADD COLUMN "package_content_unit_name_ar" TEXT;
ALTER TABLE "opportunities" ADD COLUMN "package_content_unit_name_en" TEXT;

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_commission_policy_version_id_fkey"
  FOREIGN KEY ("commission_policy_version_id") REFERENCES "commission_policy_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "opportunities_commission_policy_version_id_idx" ON "opportunities"("commission_policy_version_id");

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_commission_rate_range"
  CHECK ("commission_rate_basis_points" IS NULL OR ("commission_rate_basis_points" >= 0 AND "commission_rate_basis_points" <= 10000));

ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_package_content_group"
  CHECK (
    ("package_content_quantity" IS NULL AND "package_content_unit_name_ar" IS NULL AND "package_content_unit_name_en" IS NULL)
    OR
    ("package_content_quantity" IS NOT NULL AND "package_content_unit_name_ar" IS NOT NULL AND "package_content_unit_name_en" IS NOT NULL)
  );
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_package_content_quantity_positive"
  CHECK ("package_content_quantity" IS NULL OR "package_content_quantity" > 0);
