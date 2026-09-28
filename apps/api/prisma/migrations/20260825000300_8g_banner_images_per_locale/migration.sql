-- Banner artwork per language, and the end of banner text.
--
-- WHY THIS IS SAFE TO RUN AS A DROP. The columns being removed hold
-- nothing anyone needs:
--
--   * There is exactly one banner row in any environment this has run
--     against, and its image columns are all NULL — no artwork exists
--     to migrate into the new table, so there is nothing to backfill
--     and no fallback to arrange.
--
--   * The title and body columns were an old design in which a banner
--     carried marketing copy as separate fields. That copy was never
--     rendered: the public strip has always drawn the image alone, and
--     the stored title was used only as alt text. It is now replaced by
--     a translated constant in the web app, so an operator is no longer
--     asked to write a hidden string.
--
-- THE NEW TABLE HAS NO NULLABLE IMAGE COLUMNS, which is the point of
-- the shape. The old design kept eight nullable columns on the banner
-- and needed a CHECK constraint to stop them drifting apart. Here the
-- existence of a row IS the statement that a complete image exists, so
-- half-written metadata is not representable and needs no constraint to
-- forbid it.
--
-- Both dropped CHECK constraints go with their columns automatically:
-- `promotional_banners_image_columns_all_or_none` and
-- `promotional_banners_image_content_type_allowed`.

CREATE TYPE "banner_image_locale" AS ENUM ('ar-SA', 'en-SA');

CREATE TABLE "banner_images" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "banner_id"      UUID NOT NULL,
  "locale"         "banner_image_locale" NOT NULL,
  "object_key"     TEXT NOT NULL,
  "thumbnail_key"  TEXT NOT NULL,
  "content_type"   TEXT NOT NULL,
  "etag"           TEXT NOT NULL,
  "thumbnail_etag" TEXT NOT NULL,
  "width"          INTEGER NOT NULL,
  "height"         INTEGER NOT NULL,
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "banner_images_pkey" PRIMARY KEY ("id")
);

-- One artwork per language per banner. Replacing a language's image
-- updates its row rather than accumulating a second one.
CREATE UNIQUE INDEX "banner_images_banner_id_locale_key"
  ON "banner_images" ("banner_id", "locale");

-- Artwork has no meaning without its banner.
ALTER TABLE "banner_images"
  ADD CONSTRAINT "banner_images_banner_id_fkey"
  FOREIGN KEY ("banner_id") REFERENCES "promotional_banners" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The content type is held to the same three formats the processor can
-- emit, exactly as the old column was.
ALTER TABLE "banner_images"
  ADD CONSTRAINT "banner_images_content_type_allowed"
  CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp'));

ALTER TABLE "promotional_banners"
  DROP COLUMN "title_ar",
  DROP COLUMN "title_en",
  DROP COLUMN "body_ar",
  DROP COLUMN "body_en",
  DROP COLUMN "image_object_key",
  DROP COLUMN "image_thumbnail_key",
  DROP COLUMN "image_content_type",
  DROP COLUMN "image_etag",
  DROP COLUMN "image_thumbnail_etag",
  DROP COLUMN "image_width",
  DROP COLUMN "image_height",
  DROP COLUMN "image_updated_at";
