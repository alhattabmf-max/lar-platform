-- -------------------------------------------------------------------
-- invoice_json_decimal(data, key): safely extracts a canonical
-- decimal-string field ("100.00" — no scientific notation, no
-- leading '+', exactly 2 decimal places, non-negative) as a
-- DECIMAL(14,2). Returns NULL for ANY problem — missing key, JSON
-- null, wrong type, or non-canonical format — NEVER raises. This lets
-- CHECK constraints test presence/validity with a plain
-- "IS NOT NULL", which is always TRUE or FALSE, never NULL — closing
-- the exact gap where PostgreSQL treats a NULL CHECK result as
-- satisfied.
-- -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invoice_json_decimal(data JSONB, key TEXT)
RETURNS DECIMAL(14,2) AS $$
DECLARE
  v_text TEXT;
BEGIN
  IF NOT (data ? key) THEN RETURN NULL; END IF;
  v_text := data->>key;
  IF v_text IS NULL THEN RETURN NULL; END IF;
  IF v_text !~ '^[0-9]+\.[0-9]{2}$' THEN RETURN NULL; END IF;
  BEGIN
    RETURN v_text::DECIMAL(14,2);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Drop the old, unsafe CHECKs (their ->>'key' comparisons silently
-- passed on a missing/null key because the CHECK expression evaluated
-- to NULL, which PostgreSQL treats as satisfied).
ALTER TABLE "invoice_documents" DROP CONSTRAINT "invoice_documents_product_amount_matches_snapshot";
ALTER TABLE "invoice_documents" DROP CONSTRAINT "invoice_documents_commission_amount_matches_snapshot";

-- -------------------------------------------------------------------
-- INTERNAL_PRODUCT_DRAFT: every required key must be present, a
-- canonical non-negative 2-decimal string, currency must be exactly
-- 'SAR', shipping must be exactly "0.00" (never posted inside this
-- document), the subtotal+tax equation must hold exactly, and amount
-- must equal totalInclTax exactly. Every conjunct below is boolean
-- (IS NOT NULL / IS NOT DISTINCT FROM), so the overall CHECK can
-- never evaluate to NULL.
-- -------------------------------------------------------------------
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_product_snapshot_valid"
  CHECK (
    "document_type" != 'INTERNAL_PRODUCT_DRAFT'
    OR (
      invoice_json_decimal("snapshot_data", 'subtotalExclTax') IS NOT NULL
      AND invoice_json_decimal("snapshot_data", 'taxAmount') IS NOT NULL
      AND invoice_json_decimal("snapshot_data", 'totalInclTax') IS NOT NULL
      AND invoice_json_decimal("snapshot_data", 'shipping') IS NOT NULL
      AND ("snapshot_data"->>'currency') IS NOT DISTINCT FROM 'SAR'
      AND invoice_json_decimal("snapshot_data", 'shipping') IS NOT DISTINCT FROM 0::DECIMAL(14,2)
      AND (invoice_json_decimal("snapshot_data", 'subtotalExclTax') + invoice_json_decimal("snapshot_data", 'taxAmount'))
          IS NOT DISTINCT FROM invoice_json_decimal("snapshot_data", 'totalInclTax')
      AND "amount" IS NOT DISTINCT FROM invoice_json_decimal("snapshot_data", 'totalInclTax')
    )
  );

-- -------------------------------------------------------------------
-- INTERNAL_COMMISSION_DRAFT: same rigor — commissionExclTax and
-- commissionTax must BOTH be present (the "tax breakdown" cannot be
-- omitted), currency SAR, equation holds, amount matches exactly.
-- -------------------------------------------------------------------
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_commission_snapshot_valid"
  CHECK (
    "document_type" != 'INTERNAL_COMMISSION_DRAFT'
    OR (
      invoice_json_decimal("snapshot_data", 'commissionExclTax') IS NOT NULL
      AND invoice_json_decimal("snapshot_data", 'commissionTax') IS NOT NULL
      AND invoice_json_decimal("snapshot_data", 'totalInclTax') IS NOT NULL
      AND ("snapshot_data"->>'currency') IS NOT DISTINCT FROM 'SAR'
      AND (invoice_json_decimal("snapshot_data", 'commissionExclTax') + invoice_json_decimal("snapshot_data", 'commissionTax'))
          IS NOT DISTINCT FROM invoice_json_decimal("snapshot_data", 'totalInclTax')
      AND "amount" IS NOT DISTINCT FROM invoice_json_decimal("snapshot_data", 'totalInclTax')
    )
  );
