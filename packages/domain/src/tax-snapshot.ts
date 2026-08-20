export interface TaxSnapshotInput {
  /** Tax-inclusive unit price, as entered by the supplier. */
  unitPriceInclTax: number;
  ratePercent: number;
  ruleCode: string;
  ruleVersion: string;
}

export interface TaxSnapshot {
  taxRatePercent: number;
  unitPriceExclTaxAmount: number;
  unitTaxAmount: number;
  taxCalculationRuleCode: string;
  taxCalculationRuleVersion: string;
}

/**
 * The single, unified rounding rule for this platform's monetary
 * values: round the tax-EXCLUSIVE base to 2 decimals (ROUND_HALF_UP),
 * then derive the tax amount by SUBTRACTION from the (fixed,
 * supplier-entered) tax-inclusive price — never round both
 * independently, or the two numbers can fail to sum back to the
 * original inclusive price.
 */
export function computeTaxSnapshot(input: TaxSnapshotInput): TaxSnapshot {
  const { unitPriceInclTax, ratePercent, ruleCode, ruleVersion } = input;

  const rawExclTax = unitPriceInclTax / (1 + ratePercent / 100);
  const unitPriceExclTaxAmount = roundHalfUp(rawExclTax, 2);
  const unitTaxAmount = roundHalfUp(unitPriceInclTax - unitPriceExclTaxAmount, 2);

  return {
    taxRatePercent: ratePercent,
    unitPriceExclTaxAmount,
    unitTaxAmount,
    taxCalculationRuleCode: ruleCode,
    taxCalculationRuleVersion: ruleVersion,
  };
}

function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
