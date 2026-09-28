-- THE PRODUCT REGISTER READ EVERY ROW TO SHOW TWENTY.
--
-- The same defect as `20260915100100_index_the_company_register`, on
-- the same console, one tab across. `products` carried three indexes —
-- `company_id`, `taxonomy_node_id`, `approval_status` — and the register
-- orders by creation date, which none of them covers.
--
-- MEASURED at 126,000 products, returning twenty rows:
--
--   page 1 (default order)    Parallel Seq Scan + top-N Sort
--
-- ── 1 ── ordering, and the status tab ───────────────────────────────
--
-- Each index ENDS IN THE ORDERING COLUMNS. `approval_status` alone
-- already existed and did not help: it can find a tab's rows and then
-- has to sort them. With the date and the key inside it, the page is
-- read straight off the index in order.
CREATE INDEX IF NOT EXISTS "products_created_at_id_idx"
  ON "products" ("created_at" DESC, "id");

CREATE INDEX IF NOT EXISTS "products_approval_status_created_at_id_idx"
  ON "products" ("approval_status", "created_at" DESC, "id");

-- ── 2 ── one company's catalogue, newest first ──────────────────────
--
-- Both the console's company filter and the supplier's own catalogue
-- read `company_id` ordered by date. `products_company_id_idx` answers
-- the filter and leaves the sort to be done afterwards.
CREATE INDEX IF NOT EXISTS "products_company_id_created_at_id_idx"
  ON "products" ("company_id", "created_at" DESC, "id");

-- ── 3 ── searching by name ──────────────────────────────────────────
--
-- `ILIKE '%term%'` — a fragment anywhere in the name — which no btree
-- can serve, for the reason written out in the company migration: a
-- pattern beginning with a wildcard has no prefix to seek on.
--
-- OVER THE RAW COLUMNS, not over `lower(...)`. That was the mistake
-- corrected in `20260915100200`: `pg_trgm` folds case when it extracts
-- trigrams, and an expression index only ever serves the expression it
-- indexes — which Prisma never writes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "products_name_ar_trgm_idx"
  ON "products" USING GIN ("name_ar" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_name_en_trgm_idx"
  ON "products" USING GIN ("name_en" gin_trgm_ops);

-- The three btree indexes ARE in `schema.prisma`; the two trigram ones
-- cannot be, because Prisma's schema language cannot express
-- `USING GIN (... gin_trgm_ops)`.
