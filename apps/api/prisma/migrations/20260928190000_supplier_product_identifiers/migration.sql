ALTER TABLE "products" ADD COLUMN "supplier_sku" VARCHAR(64), ADD COLUMN "gtin" VARCHAR(14);

-- A supplier's own code is unique inside that supplier's catalogue.
-- PostgreSQL permits many NULL values, so products without a code stay valid.
CREATE UNIQUE INDEX "products_company_id_supplier_sku_key"
  ON "products"("company_id", "supplier_sku");
