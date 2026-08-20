/**
 * Minimal class-name joiner.
 *
 * Deliberately hand-written rather than pulling in `clsx` +
 * `tailwind-merge`: the components in 8B compose classes from fixed
 * variant maps, so there are no conflicting utilities to de-duplicate,
 * and two dependencies for eight lines is not a trade worth making
 * (docs/PHASE_8_IMPLEMENTATION_PLAN.md §14.2 — no large UI dependency
 * without justification).
 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
