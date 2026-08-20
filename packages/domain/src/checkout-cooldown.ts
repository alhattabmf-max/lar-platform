export interface CooldownResult {
  blocked: boolean;
  cooldownUntil: Date | null;
}

/**
 * Pure — no I/O, no clock reads beyond the `now` passed in. Callers
 * pass ONLY qualifying release events (release_reason IN ('EXPIRED',
 * 'TRADER_ABANDONED')) — OPPORTUNITY_CANCELLED and ADMIN_ABANDONED
 * must already be excluded by the caller's query before this function
 * ever sees them.
 *
 * cooldownUntil is anchored to the NEWEST event among the last
 * `threshold` qualifying events (the one whose occurrence completed
 * the threshold), never the oldest — so the cooldown window does not
 * silently re-extend past cooldownMinutes from that moment unless a
 * genuinely NEW qualifying event occurs afterward.
 */
export function computeCheckoutCooldown(
  releaseTimestamps: Date[],
  threshold: number,
  windowMinutes: number,
  cooldownMinutes: number,
  now: Date
): CooldownResult {
  const sortedDesc = [...releaseTimestamps].sort((a, b) => b.getTime() - a.getTime());
  if (sortedDesc.length < threshold) return { blocked: false, cooldownUntil: null };

  const lastN = sortedDesc.slice(0, threshold);
  const oldestInGroup = lastN[lastN.length - 1];
  const windowMs = windowMinutes * 60_000;
  if (now.getTime() - oldestInGroup.getTime() > windowMs) {
    return { blocked: false, cooldownUntil: null };
  }

  const thresholdReachedAt = lastN[0];
  const cooldownUntil = new Date(thresholdReachedAt.getTime() + cooldownMinutes * 60_000);
  return { blocked: cooldownUntil.getTime() > now.getTime(), cooldownUntil };
}
