import {
  BRAND_THEME_COLOR_KEYS,
  DEFAULT_BRAND_THEME,
  FIXED_BRAND_COLORS,
  HEX_COLOR_PATTERN,
  normaliseHexColor,
  type BrandThemeColorKey,
  type BrandThemeColors,
  type BrandThemeIssue,
  type BrandThemeValidationResult,
} from "@platform/types";

/**
 * Brand theme validation.
 *
 * Two independent layers, deliberately kept apart because they answer
 * different questions and carry different consequences
 * (docs/PHASE_8_IMPLEMENTATION_PLAN.md §14.5):
 *
 *   FORMAT   — is this even a colour we can store and render safely?
 *              Only `^#[0-9A-Fa-f]{6}$` passes. Narrowing the grammar to
 *              one shape is what makes CSS injection structurally
 *              impossible: there is no syntax left in which to express
 *              `var(--x)`, `rgb(...)`, `url(...)`, a colour keyword, an
 *              alpha channel, or anything script-like. A format failure
 *              is refused on SAVE, because no colour picker can produce
 *              one and storing it would corrupt the row.
 *
 *   CONTRAST — is this combination readable? Measured against the FIXED
 *              palette, which admins cannot change, so the check is
 *              always against a known counterpart. A contrast failure IS
 *              saved to the draft, so the 8F admin screen can show which
 *              pairs fail while an admin experiments — but it blocks
 *              PUBLISH outright.
 */

/** WCAG 2.1 relative luminance. */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG 2.1 contrast ratio between two full hex colours. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const TEXT_MINIMUM = 4.5;
const NON_TEXT_MINIMUM = 3;

interface ContrastRule {
  key: BrandThemeColorKey | "focus";
  code: string;
  against: string;
  required: number;
  /** Which theme colour supplies the value under test. */
  source: BrandThemeColorKey;
}

/**
 * The focus indicator is the primary colour, so it is checked against
 * BOTH surfaces it can appear on — an outline readable on the page
 * background but invisible on a card is still a failure.
 */
const CONTRAST_RULES: ContrastRule[] = [
  {
    key: "primary",
    code: "PRIMARY_ON_WHITE_TEXT",
    against: FIXED_BRAND_COLORS.onDark,
    required: TEXT_MINIMUM,
    source: "primary",
  },
  {
    key: "secondary",
    code: "SECONDARY_ON_WHITE_TEXT",
    against: FIXED_BRAND_COLORS.onDark,
    required: TEXT_MINIMUM,
    source: "secondary",
  },
  {
    key: "accent",
    code: "ACCENT_ON_PRIMARY_TEXT",
    against: FIXED_BRAND_COLORS.text,
    required: TEXT_MINIMUM,
    source: "accent",
  },
  {
    key: "accentInteractive",
    code: "ACCENT_INTERACTIVE_ON_WHITE_TEXT",
    against: FIXED_BRAND_COLORS.onDark,
    required: TEXT_MINIMUM,
    source: "accentInteractive",
  },
  {
    key: "focus",
    code: "FOCUS_ON_BACKGROUND",
    against: FIXED_BRAND_COLORS.background,
    required: NON_TEXT_MINIMUM,
    source: "primary",
  },
  {
    key: "focus",
    code: "FOCUS_ON_SURFACE",
    against: FIXED_BRAND_COLORS.surface,
    required: NON_TEXT_MINIMUM,
    source: "primary",
  },
];

/**
 * Parses arbitrary input into a normalised theme.
 *
 * Returns null when the input is not an object, is missing a key, has an
 * extra key, or holds anything that is not a full six-digit hex. An
 * extra key is rejected rather than ignored: silently dropping it would
 * hide a caller sending something the server does not understand.
 */
export function parseThemeColors(value: unknown): BrandThemeColors | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== BRAND_THEME_COLOR_KEYS.length) return null;

  const parsed: Partial<BrandThemeColors> = {};
  for (const key of BRAND_THEME_COLOR_KEYS) {
    const raw = candidate[key];
    if (typeof raw !== "string" || !HEX_COLOR_PATTERN.test(raw)) return null;
    parsed[key] = normaliseHexColor(raw);
  }

  return parsed as BrandThemeColors;
}

/** Format issues for input that failed to parse, keyed per colour. */
export function formatIssues(value: unknown): BrandThemeIssue[] {
  const candidate =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const issues: BrandThemeIssue[] = [];
  for (const key of BRAND_THEME_COLOR_KEYS) {
    const raw = candidate[key];
    if (typeof raw !== "string" || !HEX_COLOR_PATTERN.test(raw)) {
      issues.push({ key, rule: "FORMAT", code: "INVALID_HEX_COLOR" });
    }
  }
  return issues;
}

/** Contrast-only validation of an already format-valid theme. */
export function validateThemeContrast(colors: BrandThemeColors): BrandThemeValidationResult {
  const issues: BrandThemeIssue[] = [];

  for (const rule of CONTRAST_RULES) {
    const ratio = contrastRatio(colors[rule.source], rule.against);
    if (ratio < rule.required) {
      issues.push({
        key: rule.key,
        rule: "CONTRAST",
        code: rule.code,
        ratio: round2(ratio),
        required: rule.required,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

/** Full validation of untrusted input: format first, then contrast. */
export function validateThemeInput(value: unknown): BrandThemeValidationResult {
  const parsed = parseThemeColors(value);
  if (!parsed) return { valid: false, issues: formatIssues(value) };
  return validateThemeContrast(parsed);
}

/**
 * Reads a stored theme, resolving anything unusable to the defaults.
 *
 * Storage may hold a theme that once passed contrast and no longer does
 * (rules tightened, defaults changed); that is NOT a reason to discard
 * an admin's published choice, so only FORMAT decides usability here.
 */
export function themeFromStoredValue(value: unknown): BrandThemeColors {
  return parseThemeColors(value) ?? { ...DEFAULT_BRAND_THEME };
}
