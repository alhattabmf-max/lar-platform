-- Phase 8C — Promotional banners.
--
-- There is deliberately NO status column: the lifecycle state
-- (DRAFT / SCHEDULED / LIVE / EXPIRED) is DERIVED from is_active plus
-- the schedule window, so a stored status can never drift out of
-- agreement with the schedule that actually governs visibility.
--
-- Rows are never deleted; retiring a banner sets is_active = false.

-- CreateEnum
CREATE TYPE "BannerPlacement" AS ENUM ('PUBLIC_HOME', 'PUBLIC_OPPORTUNITIES');

-- CreateTable
CREATE TABLE "promotional_banners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "placement" "BannerPlacement" NOT NULL,
    "title_ar" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "body_ar" TEXT,
    "body_en" TEXT,
    "image_object_key" TEXT,
    "image_thumbnail_key" TEXT,
    "image_content_type" TEXT,
    "image_etag" TEXT,
    "image_thumbnail_etag" TEXT,
    "image_width" INTEGER,
    "image_height" INTEGER,
    "image_updated_at" TIMESTAMPTZ(3),
    "link_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "created_by_admin_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotional_banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotional_banners_placement_is_active_starts_at_ends_at_s_idx" ON "promotional_banners"("placement", "is_active", "starts_at", "ends_at", "sort_order");

-- The eight image columns are all-null or all-non-null. A half-written
-- image row (a key with no ETag, an ETag with no content type) would
-- make the image route serve a response it cannot validate, so the
-- database refuses to hold that state at all rather than leaving every
-- reader to defend against it.
ALTER TABLE "promotional_banners"
  ADD CONSTRAINT "promotional_banners_image_columns_all_or_none" CHECK (
    (
      "image_object_key"     IS NULL AND
      "image_thumbnail_key"  IS NULL AND
      "image_content_type"   IS NULL AND
      "image_etag"           IS NULL AND
      "image_thumbnail_etag" IS NULL AND
      "image_width"          IS NULL AND
      "image_height"         IS NULL AND
      "image_updated_at"     IS NULL
    ) OR (
      "image_object_key"     IS NOT NULL AND
      "image_thumbnail_key"  IS NOT NULL AND
      "image_content_type"   IS NOT NULL AND
      "image_etag"           IS NOT NULL AND
      "image_thumbnail_etag" IS NOT NULL AND
      "image_width"          IS NOT NULL AND
      "image_height"         IS NOT NULL AND
      "image_updated_at"     IS NOT NULL
    )
  );

-- The window is half-open [starts_at, ends_at) and ends_at is
-- EXCLUSIVE, so an empty or inverted window can never be live and is
-- rejected outright rather than stored as a banner that silently never
-- appears.
ALTER TABLE "promotional_banners"
  ADD CONSTRAINT "promotional_banners_window_ordered" CHECK (
    "starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"
  );

-- Only the two variants the image route can serve.
ALTER TABLE "promotional_banners"
  ADD CONSTRAINT "promotional_banners_image_content_type_allowed" CHECK (
    "image_content_type" IS NULL OR
    "image_content_type" IN ('image/jpeg', 'image/png', 'image/webp')
  );
