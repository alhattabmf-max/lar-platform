export interface ShareTier {
  /** Upper bound in SAR (tax-inclusive total value), inclusive. null means open-ended (last tier only). */
  maxTotalValueInclTax: number | null;
  shareBasisPoints: number;
}

export interface ShareTierPolicy {
  tiers: ShareTier[];
}

export interface TierSelection {
  tierIndex: number;
  tier: ShareTier;
}

/**
 * The exact-Decimal total-value computation happens in the CALLER
 * (Prisma.Decimal multiplication) — by the time totalValueInclTax
 * reaches this pure module it is already a precision-safe number
 * (SAR amounts at 2 decimals are always far within
 * Number.MAX_SAFE_INTEGER), so comparing it against round tier
 * boundaries here never re-introduces the precision loss the Decimal
 * arithmetic was meant to avoid.
 */
export function selectTier(policy: ShareTierPolicy, totalValueInclTax: number): TierSelection {
  for (let i = 0; i < policy.tiers.length; i++) {
    const tier = policy.tiers[i];
    if (tier.maxTotalValueInclTax === null || totalValueInclTax <= tier.maxTotalValueInclTax) {
      return { tierIndex: i, tier };
    }
  }
  throw new Error("selectTier: no tier matched — the policy is malformed (the last tier must be open-ended)");
}

/**
 * Pure integer arithmetic — targetQuantity and shareBasisPoints are
 * both integers, so no Decimal is needed here at all: the product is
 * always safely within Number.MAX_SAFE_INTEGER for any realistic
 * quantity/bps combination this platform allows.
 */
export function computeShareQuantity(targetQuantity: number, shareBasisPoints: number): number | null {
  const raw = targetQuantity * shareBasisPoints;
  if (raw % 10000 !== 0) return null;
  return raw / 10000;
}

export interface CompatibleQuantitySuggestion {
  below: number | null;
  above: number | null;
}

/**
 * O(numberOfTiers): for each tier, compute its quantity range at the
 * given unit price (floor/ceil), derive at most ONE candidate below
 * and ONE candidate above the requested quantity within that range
 * (the nearest multiple of that tier's step), then take the best
 * (nearest) candidate across all tiers in each direction. Every
 * chosen candidate is then FULLY re-evaluated through the real
 * pipeline (recompute total value, re-select tier, re-check exact
 * divisibility) — never assumed valid just because it was derived
 * from one tier's arithmetic, since crossing a value boundary can
 * change which tier actually applies.
 */
export function suggestCompatibleQuantities(
  policy: ShareTierPolicy,
  unitPriceInclTax: number,
  requestedQuantity: number,
  maxQuantityBound: number
): CompatibleQuantitySuggestion {
  let bestBelow: number | null = null;
  let bestAbove: number | null = null;

  for (let i = 0; i < policy.tiers.length; i++) {
    const tier = policy.tiers[i];
    const step = 10000 / tier.shareBasisPoints;

    const lowerBoundValue = i === 0 ? 0 : (policy.tiers[i - 1].maxTotalValueInclTax ?? 0);
    const lowQty = lowerBoundValue > 0 ? Math.floor(lowerBoundValue / unitPriceInclTax) + 1 : 1;
    const highQty =
      tier.maxTotalValueInclTax !== null
        ? Math.floor(tier.maxTotalValueInclTax / unitPriceInclTax)
        : maxQuantityBound;

    if (lowQty > highQty) continue;

    const candBelow = Math.floor(Math.min(requestedQuantity, highQty) / step) * step;
    if (candBelow >= lowQty && candBelow <= highQty && candBelow >= 1) {
      if (bestBelow === null || candBelow > bestBelow) bestBelow = candBelow;
    }

    const candAbove = Math.ceil(Math.max(requestedQuantity, lowQty) / step) * step;
    if (candAbove <= highQty && candAbove >= lowQty) {
      if (bestAbove === null || candAbove < bestAbove) bestAbove = candAbove;
    }
  }

  return {
    below: bestBelow !== null ? revalidateCandidate(policy, unitPriceInclTax, bestBelow) : null,
    above: bestAbove !== null ? revalidateCandidate(policy, unitPriceInclTax, bestAbove) : null,
  };
}

function revalidateCandidate(policy: ShareTierPolicy, unitPriceInclTax: number, candidateQuantity: number): number | null {
  const totalValue = candidateQuantity * unitPriceInclTax;
  const { tier } = selectTier(policy, totalValue);
  return computeShareQuantity(candidateQuantity, tier.shareBasisPoints) !== null ? candidateQuantity : null;
}

/**
 * JS mirror of the DB-level validate_share_tiers() function — used
 * for immediate, friendly validation before ever attempting the
 * INSERT (which the DB CHECK constraint would reject anyway; this
 * gives a specific, actionable error message instead of a raw
 * constraint-violation error).
 */
export function validateShareTiers(tiers: ShareTier[]): string | null {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return "tiers must be a non-empty array";
  }

  let prevBound: number | null = null;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    const isLast = i === tiers.length - 1;

    if (typeof t.shareBasisPoints !== "number" || !Number.isInteger(t.shareBasisPoints) || t.shareBasisPoints <= 0 || t.shareBasisPoints > 10000) {
      return `tier ${i}: shareBasisPoints must be an integer in (0, 10000]`;
    }
    if (10000 % t.shareBasisPoints !== 0) {
      return `tier ${i}: shareBasisPoints must evenly divide 10000`;
    }

    if (t.maxTotalValueInclTax === null) {
      if (!isLast) return `tier ${i}: a null (open-ended) bound is only allowed on the last tier`;
    } else {
      if (isLast) return `tier ${i}: the last tier must be open-ended (maxTotalValueInclTax = null)`;
      if (typeof t.maxTotalValueInclTax !== "number" || t.maxTotalValueInclTax <= 0) {
        return `tier ${i}: maxTotalValueInclTax must be a positive number`;
      }
      if (prevBound !== null && t.maxTotalValueInclTax <= prevBound) {
        return `tier ${i}: bounds must be strictly ascending with no duplicates`;
      }
      prevBound = t.maxTotalValueInclTax;
    }
  }

  return null;
}

/** Matches the Version 1 tiers seeded by the schema migration exactly — reference only, never used to fabricate a row. */
export const DEFAULT_SHARE_TIERS: ShareTier[] = [
  { maxTotalValueInclTax: 50_000, shareBasisPoints: 1000 },
  { maxTotalValueInclTax: 200_000, shareBasisPoints: 500 },
  { maxTotalValueInclTax: null, shareBasisPoints: 250 },
];
