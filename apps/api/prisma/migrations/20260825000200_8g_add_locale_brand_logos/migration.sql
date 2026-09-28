-- Per-language main logo.
--
-- ADDITIVE ONLY. Two nullable columns beside the existing
-- `logo_main_url`, which is left exactly as it is and keeps serving as
-- the fallback — so every branding row written before this migration
-- goes on working untouched, with nothing to backfill.
--
-- `IF NOT EXISTS` so re-running the deploy is a no-op rather than an
-- error.
--
-- No dark-mode columns: the platform has no dark theme — `darkMode` is
-- unconfigured in Tailwind, there is not one `dark:` utility in the app,
-- no theme provider, and no stored preference. Columns nothing can read
-- would widen the public contract and offer an operator a field whose
-- image would never appear.
ALTER TABLE "branding_settings"
  ADD COLUMN IF NOT EXISTS "logo_main_ar_url" TEXT,
  ADD COLUMN IF NOT EXISTS "logo_main_en_url" TEXT;
