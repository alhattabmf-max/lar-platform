-- Row-level CHECK: supplierPayableShareAmount + commissionShareAmount +
-- commissionShareTaxAmount = productAmountInclTax (shipping excluded
-- entirely — supplierPayableShareAmount represents ONLY the
-- supplier's share of the PRODUCT after commission, never shipping).
ALTER TABLE "order_allocation_financial_snapshots" ADD CONSTRAINT "oafs_supplier_payable_equation"
  CHECK ("supplier_payable_share_amount" + "commission_share_amount" + "commission_share_tax_amount" = "product_amount_incl_tax");

-- Widen the deferred sum-consistency trigger to:
--   1. Verify this row's shipping_fee_amount matches the source
--      CheckoutLocationAllocation exactly (per-row, not just summed).
--   2. Once every sibling allocation has a snapshot: verify all FIVE
--      sums against their frozen sources —
--        SUM(product_amount_incl_tax)      = quote_snapshots.products_subtotal_incl_tax_amount
--        SUM(shipping_fee_amount)          = quote_snapshots.total_shipping_fee_amount
--        SUM(commission_share_amount)      = master_orders.commission_amount
--        SUM(commission_share_tax_amount)  = master_orders.commission_tax_amount
--        SUM(supplier_payable_share_amount)= master_orders.supplier_payable_amount - quote_snapshots.total_shipping_fee_amount
--      (the last one corrected: MasterOrder.supplierPayableAmount
--      includes shipping by construction in 7C's formula
--      (totalAmount - commission - commissionTax, where totalAmount
--      includes shipping) — the PRODUCT-only portion is obtained by
--      subtracting the frozen shipping total.)
CREATE OR REPLACE FUNCTION check_financial_snapshot_sums_match_source()
RETURNS TRIGGER AS $$
DECLARE
  v_master_order_id UUID;
  v_checkout_location_allocation_id UUID;
  v_row_shipping_fee DECIMAL(12,2);
  v_source_shipping_fee DECIMAL(12,2);
  v_allocation_count INT;
  v_snapshot_count INT;
  v_commission_sum DECIMAL(14,2);
  v_commission_tax_sum DECIMAL(14,2);
  v_supplier_payable_sum DECIMAL(14,2);
  v_product_sum DECIMAL(14,2);
  v_shipping_sum DECIMAL(12,2);
  v_commission_amount DECIMAL(14,2);
  v_commission_tax_amount DECIMAL(14,2);
  v_supplier_payable_amount DECIMAL(14,2);
  v_checkout_session_id UUID;
  v_quote_products_subtotal_incl_tax DECIMAL(14,2);
  v_quote_total_shipping_fee DECIMAL(12,2);
BEGIN
  SELECT oa."master_order_id", oa."checkout_location_allocation_id"
    INTO v_master_order_id, v_checkout_location_allocation_id
    FROM "order_allocations" oa WHERE oa."id" = NEW."order_allocation_id";

  -- Per-row shipping match against the source CheckoutLocationAllocation.
  SELECT "shipping_fee_amount" INTO v_source_shipping_fee
    FROM "checkout_location_allocations" WHERE "id" = v_checkout_location_allocation_id;
  IF NEW."shipping_fee_amount" != v_source_shipping_fee THEN
    RAISE EXCEPTION 'order_allocation_financial_snapshots: shipping_fee_amount (%) does not match checkout_location_allocations.shipping_fee_amount (%) for order_allocation_id=%', NEW."shipping_fee_amount", v_source_shipping_fee, NEW."order_allocation_id";
  END IF;

  SELECT COUNT(*) INTO v_allocation_count FROM "order_allocations" WHERE "master_order_id" = v_master_order_id;
  SELECT COUNT(*) INTO v_snapshot_count
    FROM "order_allocation_financial_snapshots" oafs
    JOIN "order_allocations" oa ON oa."id" = oafs."order_allocation_id"
    WHERE oa."master_order_id" = v_master_order_id;

  IF v_snapshot_count != v_allocation_count THEN
    RAISE EXCEPTION 'order_allocation_financial_snapshots: master_order_id=% has % allocations but % snapshots — all sibling allocations must receive a snapshot within the same transaction', v_master_order_id, v_allocation_count, v_snapshot_count;
  END IF;

  SELECT
      SUM(oafs."commission_share_amount"), SUM(oafs."commission_share_tax_amount"),
      SUM(oafs."supplier_payable_share_amount"), SUM(oafs."product_amount_incl_tax"),
      SUM(oafs."shipping_fee_amount")
    INTO v_commission_sum, v_commission_tax_sum, v_supplier_payable_sum, v_product_sum, v_shipping_sum
    FROM "order_allocation_financial_snapshots" oafs
    JOIN "order_allocations" oa ON oa."id" = oafs."order_allocation_id"
    WHERE oa."master_order_id" = v_master_order_id;

  SELECT "commission_amount", "commission_tax_amount", "supplier_payable_amount", "checkout_session_id"
    INTO v_commission_amount, v_commission_tax_amount, v_supplier_payable_amount, v_checkout_session_id
    FROM "master_orders" WHERE "id" = v_master_order_id;

  SELECT "products_subtotal_incl_tax_amount", "total_shipping_fee_amount"
    INTO v_quote_products_subtotal_incl_tax, v_quote_total_shipping_fee
    FROM "quote_snapshots" WHERE "checkout_session_id" = v_checkout_session_id;

  IF v_commission_sum != v_commission_amount THEN
    RAISE EXCEPTION 'order_allocation_financial_snapshots: commission sum (%) does not match master_orders.commission_amount (%) for master_order_id=%', v_commission_sum, v_commission_amount, v_master_order_id;
  END IF;
  IF v_commission_tax_sum != v_commission_tax_amount THEN
    RAISE EXCEPTION 'order_allocation_financial_snapshots: commission tax sum (%) does not match master_orders.commission_tax_amount (%) for master_order_id=%', v_commission_tax_sum, v_commission_tax_amount, v_master_order_id;
  END IF;

  IF v_quote_products_subtotal_incl_tax IS NOT NULL AND v_product_sum != v_quote_products_subtotal_incl_tax THEN
    RAISE EXCEPTION 'order_allocation_financial_snapshots: product amount sum (%) does not match quote_snapshots.products_subtotal_incl_tax_amount (%) for master_order_id=%', v_product_sum, v_quote_products_subtotal_incl_tax, v_master_order_id;
  END IF;

  IF v_quote_total_shipping_fee IS NOT NULL THEN
    IF v_shipping_sum != v_quote_total_shipping_fee THEN
      RAISE EXCEPTION 'order_allocation_financial_snapshots: shipping fee sum (%) does not match quote_snapshots.total_shipping_fee_amount (%) for master_order_id=%', v_shipping_sum, v_quote_total_shipping_fee, v_master_order_id;
    END IF;
    IF v_supplier_payable_sum != (v_supplier_payable_amount - v_quote_total_shipping_fee) THEN
      RAISE EXCEPTION 'order_allocation_financial_snapshots: supplier payable sum (%) does not match master_orders.supplier_payable_amount minus shipping (%) for master_order_id=%', v_supplier_payable_sum, (v_supplier_payable_amount - v_quote_total_shipping_fee), v_master_order_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
