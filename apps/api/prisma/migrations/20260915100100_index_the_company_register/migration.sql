-- THE COMPANY REGISTER READ EVERY ROW TO SHOW TWENTY.
--
-- `companies` carried three indexes — the primary key, the registration
-- number, and the active bank account — and the console orders by
-- registration date, filters by account type and verification status,
-- and searches by name. None of those was covered.
--
-- MEASURED at 70,000 companies, each returning twenty rows:
--
--   page 1 (default order)       45 ms   SEQ SCAN + Sort
--   filter by status             36 ms   SEQ SCAN + Sort
--   search by name              122 ms   SEQ SCAN + Sort
--
-- ── 1 ── ordering and the two filters ───────────────────────────────
--
-- Each index ends in the ordering columns, not just the filter column.
-- An index on `account_type` alone can find the tab's rows and then has
-- to sort them; with the date and the key inside it, the page is read
-- straight off the index in order.
CREATE INDEX IF NOT EXISTS "companies_created_at_id_idx"
  ON "companies" ("created_at" DESC, "id");

CREATE INDEX IF NOT EXISTS "companies_account_type_created_at_id_idx"
  ON "companies" ("account_type", "created_at" DESC, "id");

CREATE INDEX IF NOT EXISTS "companies_verification_status_created_at_id_idx"
  ON "companies" ("verification_status", "created_at" DESC, "id");

-- ── 2 ── searching by name ──────────────────────────────────────────
--
-- The search is `ILIKE '%term%'` — a fragment, anywhere in the name —
-- because an operator types the middle of a company's name as readily
-- as its start. NO BTREE INDEX CAN SERVE THAT: a btree orders by prefix,
-- and a pattern that begins with a wildcard has no prefix to seek on.
-- That is why the search stayed a sequential scan while the ordering
-- indexes above would not have helped it at all.
--
-- TRIGRAMS ARE THE MATCHING TOOL FOR IT. `pg_trgm` cuts every name into
-- three-character runs and indexes those, so `%توريد%` becomes a lookup
-- of the trigrams in «توريد» and an intersection of the rows holding
-- them. `gin_trgm_ops` is what teaches GIN to index that way.
--
-- BOTH COLUMNS, because the chooser searches the registration number
-- too: an operator working from a spreadsheet has a CR number and no
-- name.
--
-- CASE FOLDING IS PART OF THE INDEX. The query is case-insensitive, so
-- the index is built over `lower(...)`; indexing the raw column would
-- leave an `ILIKE` unable to use it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "companies_legal_name_trgm_idx"
  ON "companies" USING GIN (lower("legal_name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "companies_cr_number_trgm_idx"
  ON "companies" USING GIN (lower("cr_number") gin_trgm_ops);

-- THE TRIGRAM INDEXES ARE DELIBERATELY ABSENT FROM `schema.prisma`.
-- Prisma's schema language cannot express `USING GIN (... gin_trgm_ops)`
-- or an expression index, so they live here alone — the same way every
-- partial unique index and every trigger in this repository does. The
-- three btree indexes above ARE in the schema, because they can be.
