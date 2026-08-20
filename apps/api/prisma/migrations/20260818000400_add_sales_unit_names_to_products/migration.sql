ALTER TABLE "products" ADD COLUMN "sales_unit_name_ar" TEXT;
ALTER TABLE "products" ADD COLUMN "sales_unit_name_en" TEXT;
ALTER TABLE "products" ADD COLUMN "package_content_quantity" DECIMAL(10,3);
ALTER TABLE "products" ADD COLUMN "package_content_unit_name_ar" TEXT;
ALTER TABLE "products" ADD COLUMN "package_content_unit_name_en" TEXT;

ALTER TABLE "products" DROP CONSTRAINT "products_sales_unit_id_fkey";
ALTER TABLE "products" ALTER COLUMN "sales_unit_id" DROP NOT NULL;
ALTER TABLE "products" ADD CONSTRAINT "products_sales_unit_id_fkey"
  FOREIGN KEY ("sales_unit_id") REFERENCES "sales_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "products" ADD CONSTRAINT "products_package_content_group"
  CHECK (
    ("package_content_quantity" IS NULL AND "package_content_unit_name_ar" IS NULL AND "package_content_unit_name_en" IS NULL)
    OR
    ("package_content_quantity" IS NOT NULL AND "package_content_unit_name_ar" IS NOT NULL AND "package_content_unit_name_en" IS NOT NULL)
  );
ALTER TABLE "products" ADD CONSTRAINT "products_package_content_quantity_positive"
  CHECK ("package_content_quantity" IS NULL OR "package_content_quantity" > 0);
