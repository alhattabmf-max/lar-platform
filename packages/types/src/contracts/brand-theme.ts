/**
 * Dynamic brand theme contracts.
 *
 * Four identity colours are admin-configurable; everything else in the
 * palette is fixed (docs/PHASE_8_IMPLEMENTATION_PLAN.md §14.5). Fixing
 * the neutrals and semantic colours is what keeps the accessibility
 * guarantees provable: only these four have to be re-verified, and only
 * against known-fixed counterparts.
 *
 * Contracts only — no CSS, no style strings, no Prisma types. The values
 * here are plain uppercase hex strings; turning them into CSS custom
 * properties is the web app's job, and validating them is the API's.
 */

export interface BrandThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  accentInteractive: string;
}

/** Exact key set of a theme, for exact-equality assertions. */
export const BRAND_THEME_COLOR_KEYS = [
  "primary",
  "secondary",
  "accent",
  "accentInteractive",
] as const satisfies readonly (keyof BrandThemeColors)[];

export type BrandThemeColorKey = (typeof BRAND_THEME_COLOR_KEYS)[number];

/**
 * The default FORSA theme. Deliberately a code constant rather than a
 * database row: it is the anchor every fallback resolves to, so it must
 * be impossible to corrupt, delete, or silently edit.
 */
export const DEFAULT_BRAND_THEME: BrandThemeColors = {
  primary: "#0B1F33",
  secondary: "#0F766E",
  accent: "#F59E0B",
  accentInteractive: "#B45309",
};

/**
 * Colours that are NOT themeable. Published here because the contrast
 * rules are defined against them, so both sides read the same values.
 */
export const FIXED_BRAND_COLORS = {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  text: "#0F172A",
  textMuted: "#475569",
  border: "#E2E8F0",
  success: "#15803D",
  warning: "#D97706",
  danger: "#DC2626",
  onLight: "#0F172A",
  onDark: "#FFFFFF",
} as const;

/**
 * The ONLY accepted colour syntax: a full six-digit hex.
 *
 * Everything else is refused — CSS custom properties, rgb()/hsl(),
 * colour keywords, alpha channels, url(), and anything script-like.
 * Narrowing the accepted grammar to this one shape is what makes CSS
 * injection structurally impossible rather than filtered.
 */
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Normalises an accepted hex to the canonical uppercase form. */
export function normaliseHexColor(value: string): string {
  return value.toUpperCase();
}

export type BrandThemeIssueRule = "FORMAT" | "CONTRAST";

export interface BrandThemeIssue {
  /** Which themeable colour the issue concerns, or "focus" for the focus ring. */
  key: BrandThemeColorKey | "focus";
  rule: BrandThemeIssueRule;
  /** Stable machine-readable identifier for the i18n layer. */
  code: string;
  /** Measured contrast ratio, rounded to two decimals. Absent for format issues. */
  ratio?: number;
  /** Required minimum for this pair. Absent for format issues. */
  required?: number;
}

export interface BrandThemeValidationResult {
  valid: boolean;
  issues: BrandThemeIssue[];
}

/**
 * What `GET /api/v1/branding` exposes: the ACTIVE theme only.
 *
 * There is deliberately no draft field, no validation detail, no
 * `updatedBy`, and no timestamps — a public caller has no business
 * seeing what an admin is experimenting with.
 */
export interface BrandThemePublic {
  colors: BrandThemeColors;
}

/**
 * Admin-only view of the draft. Carries a timestamp so the 8F screen can
 * show when it was last saved, and its validation result so the screen
 * can show which pairs currently fail.
 */
export interface BrandThemeDraft {
  colors: BrandThemeColors;
  updatedAt: string | null;
  validation: BrandThemeValidationResult;
}

/** Admin-only aggregate returned by the admin theme endpoint. */
export interface BrandThemeAdminView {
  active: BrandThemeColors;
  draft: BrandThemeDraft | null;
  defaults: BrandThemeColors;
  activeValidation: BrandThemeValidationResult;
}
