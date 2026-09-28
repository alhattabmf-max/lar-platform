-- The header logo, stored as bytes we own rather than a pasted URL.
--
-- WHY THE TWO URL COLUMNS GO. `logo_main_ar_url` and `logo_main_en_url`
-- were added a few hours earlier as free-text addresses, before the
-- architectural decision to keep brand assets in their own table with a
-- storage key and a delivery route. Keeping both would leave two places
-- a header logo could come from, which is exactly the ambiguity the
-- decision exists to remove.
--
-- Dropping them loses nothing: they were never populated in any
-- environment except with two temporary verification values, and those
-- were cleared on the founder's instruction before this ran.
--
-- `logo_main_url` is left in place. It predates all of this and is not
-- part of the header path.
--
-- NO BINARY IN THE DATABASE and no permanent public URL: the row holds
-- a storage key plus the metadata the delivery route needs to answer a
-- conditional request. The key is never exposed by any contract.
--
-- EVERY COLUMN IS NOT NULL except `published_at`, which is the one real
-- state: a logo exists and is complete, or its row does not exist. A
-- partially written asset is not representable, so no CHECK constraint
-- is needed to forbid it.

CREATE TYPE "brand_asset_locale" AS ENUM ('ar-SA', 'en-SA');

CREATE TABLE "brand_assets" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "locale"         "brand_asset_locale" NOT NULL,
  "object_key"     TEXT NOT NULL,
  "thumbnail_key"  TEXT NOT NULL,
  "content_type"   TEXT NOT NULL,
  "etag"           TEXT NOT NULL,
  "thumbnail_etag" TEXT NOT NULL,
  "width"          INTEGER NOT NULL,
  "height"         INTEGER NOT NULL,
  "published_at"   TIMESTAMPTZ(3),
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "brand_assets_pkey" PRIMARY KEY ("id")
);

-- One logo per language. Replacing a language's logo updates its row
-- rather than accumulating a second one.
CREATE UNIQUE INDEX "brand_assets_locale_key" ON "brand_assets" ("locale");

-- Transparent logos need PNG or WebP; JPEG cannot carry an alpha
-- channel and would put a white box behind the mark on the white bar.
-- SVG is deliberately absent: it is a script-capable document, and
-- accepting one would need its own sanitisation design.
ALTER TABLE "brand_assets"
  ADD CONSTRAINT "brand_assets_content_type_allowed"
  CHECK ("content_type" IN ('image/png', 'image/webp'));

ALTER TABLE "branding_settings"
  DROP COLUMN "logo_main_ar_url",
  DROP COLUMN "logo_main_en_url";
