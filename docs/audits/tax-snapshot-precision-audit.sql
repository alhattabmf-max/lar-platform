-- ============================================================================
-- Financial Precision Delta — historical audit (READ ONLY)
--
-- Nothing in this file writes. There is no UPDATE, no INSERT, no DDL and no
-- migration attached to it. It exists so the question "were any already
-- published opportunities affected?" can be answered against real data,
-- which is the only place that answer exists.
--
-- BACKGROUND
--
-- Until the Financial Precision Delta, `computeTaxSnapshot` divided in
-- binary double and rounded with
-- `Math.round((value + Number.EPSILON) * 100) / 100`. `Number.EPSILON` is
-- smaller than one ULP for any value above about 2, so the guard lifted
-- nothing, and the `* 100` step lost the precision: `2.175 * 100` is
-- `217.49999999999997`, so `Math.round` returned 217 and the tax-exclusive
-- amount came out one cent LOW — with the tax amount correspondingly one
-- cent HIGH, because it is derived by subtraction.
--
-- The defect only bites when `unitPriceAmount / (1 + rate/100)` lands
-- exactly on a half-cent. Measured over 500,000 two-decimal prices per
-- rate:
--
--     rate     affected prices
--     0%       0
--     5%       0
--     15%      0          <- the Saudi VAT rate
--     20%      3,038      (0.61%)
--     100%     16,390     (3.28%)
--     others tested (1, 2.5, 7.5, 10, 12.25, 12.5, 13.33, 16.67, 17.5,
--     21, 23, 25, 27.5, 33.33, 50, 66.67, 99.99)   0
--
-- So: if `tax_rate_percent` on every published opportunity has only ever
-- been a rate with no tie cases, no row is affected. That CANNOT be
-- asserted from the code — it is a fact about stored data, and query 1
-- below is what establishes it.
--
-- HOW TO READ THE RESULT
--
--   Query 1 empty  -> no opportunity was ever published at a tie-producing
--                     rate, and no further work is needed.
--   Query 1 rows   -> run query 2, which recomputes the split in exact
--                     numeric and lists only the rows that actually differ.
--
-- A row appearing in query 2 is off by one cent in the SPLIT between
-- supplier revenue and VAT. The two figures still sum to the inclusive
-- price — the subtraction step guaranteed that even when both were wrong —
-- so a reconciliation that only checks the sum will not have flagged it.
--
-- WHAT TO DO ABOUT A NON-EMPTY RESULT IS NOT DECIDED HERE.
-- These are FROZEN snapshot columns: orders were placed against them and
-- settlements reconcile to them. Correcting them is a commercial and
-- accounting decision, not a data cleanup, and it must be made with the
-- finance owner before any write is designed.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Query 0 — which rates have ever actually been used?
-- Cheapest first: if this returns only rates with no tie cases, stop here.
-- ---------------------------------------------------------------------------
SELECT
    tax_rate_percent,
    count(*)                              AS opportunities,
    min(first_activated_at)               AS earliest_publish,
    max(first_activated_at)               AS latest_publish
FROM opportunities
WHERE tax_rate_percent IS NOT NULL
GROUP BY tax_rate_percent
ORDER BY tax_rate_percent;


-- ---------------------------------------------------------------------------
-- Query 1 — rows published at a rate that CAN produce a half-cent tie.
--
-- The condition is computed, not hardcoded to 20% and 100%: a tie exists
-- when the exact tax-exclusive amount has a third decimal digit of exactly
-- 5. Any rate that produces one for some price will show up here.
-- ---------------------------------------------------------------------------
SELECT
    o.id,
    o.company_id,
    o.status,
    o.first_activated_at,
    o.tax_rate_percent,
    o.unit_price_amount,
    o.unit_price_excl_tax_amount           AS stored_excl,
    o.unit_tax_amount                      AS stored_tax
FROM opportunities o
WHERE o.tax_rate_percent IS NOT NULL
  AND o.unit_price_excl_tax_amount IS NOT NULL
  -- The exact quotient, to 3 decimals, ends in a 5: this is a tie.
  AND (
        round(
            o.unit_price_amount / (1 + o.tax_rate_percent / 100.0),
            3
        ) * 1000
      )::bigint % 10 = 5
ORDER BY o.first_activated_at;


-- ---------------------------------------------------------------------------
-- Query 2 — rows whose STORED split differs from the exact one.
--
-- `numeric` in Postgres is exact, so this recomputation is the reference.
-- ROUND_HALF_UP matches `round(numeric, int)`, which rounds half away from
-- zero — the same rule the corrected TypeScript uses.
--
-- Every row returned is a real discrepancy. An empty result means the
-- stored values are already correct even if query 1 found tie cases.
-- ---------------------------------------------------------------------------
WITH recomputed AS (
    SELECT
        o.id,
        o.company_id,
        o.status,
        o.first_activated_at,
        o.tax_rate_percent,
        o.unit_price_amount,
        o.unit_price_excl_tax_amount                       AS stored_excl,
        o.unit_tax_amount                                  AS stored_tax,
        round(o.unit_price_amount / (1 + o.tax_rate_percent / 100.0), 2)
                                                           AS exact_excl,
        o.unit_price_amount
            - round(o.unit_price_amount / (1 + o.tax_rate_percent / 100.0), 2)
                                                           AS exact_tax
    FROM opportunities o
    WHERE o.tax_rate_percent IS NOT NULL
      AND o.unit_price_excl_tax_amount IS NOT NULL
      AND o.unit_tax_amount IS NOT NULL
)
SELECT
    id,
    company_id,
    status,
    first_activated_at,
    tax_rate_percent,
    unit_price_amount,
    stored_excl,
    exact_excl,
    exact_excl - stored_excl        AS excl_difference,
    stored_tax,
    exact_tax,
    exact_tax - stored_tax          AS tax_difference,
    -- Confirms the invariant held even where the split was wrong.
    (stored_excl + stored_tax = unit_price_amount) AS sum_invariant_held
FROM recomputed
WHERE stored_excl <> exact_excl
   OR stored_tax  <> exact_tax
ORDER BY first_activated_at;


-- ---------------------------------------------------------------------------
-- Query 3 — blast radius, if query 2 returned anything.
--
-- Which orders were placed against an affected opportunity. Read only:
-- this scopes the conversation with the finance owner, it does not start
-- a correction.
-- ---------------------------------------------------------------------------
WITH affected AS (
    SELECT o.id
    FROM opportunities o
    WHERE o.tax_rate_percent IS NOT NULL
      AND o.unit_price_excl_tax_amount IS NOT NULL
      AND o.unit_price_excl_tax_amount
          <> round(o.unit_price_amount / (1 + o.tax_rate_percent / 100.0), 2)
)
SELECT
    a.id                          AS opportunity_id,
    count(DISTINCT cs.id)         AS checkout_sessions,
    count(DISTINCT mo.id)         AS master_orders,
    min(mo.paid_at)               AS earliest_order,
    max(mo.paid_at)               AS latest_order
FROM affected a
LEFT JOIN checkout_sessions cs ON cs.opportunity_id = a.id
LEFT JOIN master_orders     mo ON mo.checkout_session_id = cs.id
GROUP BY a.id
ORDER BY a.id;
