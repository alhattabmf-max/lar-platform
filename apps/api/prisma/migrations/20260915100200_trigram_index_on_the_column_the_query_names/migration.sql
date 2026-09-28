-- THE TRIGRAM INDEXES WERE BUILT OVER AN EXPRESSION THE QUERY NEVER USES.
--
-- `20260915100100_index_the_company_register` created them over
-- `lower(legal_name)`, reasoning that the search is case-insensitive.
-- That reasoning was wrong twice over.
--
-- FIRST, AN EXPRESSION INDEX ONLY SERVES THE EXPRESSION IT INDEXES.
-- Prisma emits `legal_name ILIKE '%…%'` — it does not write `lower(...)`
-- — so the planner could not match the query to the index and fell back
-- to a sequential scan.
--
-- SECOND, THE LOWERING WAS UNNECESSARY. `pg_trgm` folds case when it
-- extracts trigrams, so a GIN index on the plain column already answers
-- `ILIKE` as well as `LIKE`. The expression bought nothing and cost the
-- index its only caller.
--
-- MEASURED after the first migration, at 70,000 companies, with a term
-- matching FEW rows — which is the chooser's whole purpose:
--
--   rare term, ordered by name    136 ms   SEQ SCAN
--   rare term, ordered by date     99 ms   SEQ SCAN
--
-- A COMMON term looked fine at 0.94 ms, and that is what hid it: with
-- 42,000 matches the planner walked the date index and filled twenty
-- rows almost immediately. The index that was supposed to make search
-- cheap was never used for either case.
DROP INDEX IF EXISTS "companies_legal_name_trgm_idx";
DROP INDEX IF EXISTS "companies_cr_number_trgm_idx";

CREATE INDEX IF NOT EXISTS "companies_legal_name_trgm_idx"
  ON "companies" USING GIN ("legal_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "companies_cr_number_trgm_idx"
  ON "companies" USING GIN ("cr_number" gin_trgm_ops);
