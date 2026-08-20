-- Phase 6 — Opportunities Core
-- regions / cities — fully structured geography reference lists.
-- Admin-managed exactly like taxonomy_nodes/sales_units (Phase 4).

CREATE TABLE "regions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "region_id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cities_region_id_idx" ON "cities"("region_id");

ALTER TABLE "cities" ADD CONSTRAINT "cities_region_id_fkey"
  FOREIGN KEY ("region_id") REFERENCES "regions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sentinel region + city — fixed, well-known ids, INACTIVE from
-- creation. Exist solely to satisfy the upcoming NOT NULL constraint
-- on pre-existing company_locations rows (next migration). Never
-- selectable at registration or in any location create/update call
-- (application-level check on is_active=true); any opportunity whose
-- location resolves to this city is blocked at publish time.
INSERT INTO "regions" (id, name_ar, name_en, is_active, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', 'غير محدد', 'Unknown', false, now());

INSERT INTO "cities" (id, region_id, name_ar, name_en, is_active, updated_at)
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'غير محدد', 'Unknown', false, now());
