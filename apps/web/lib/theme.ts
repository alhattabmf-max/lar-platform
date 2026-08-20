import type { CSSProperties } from "react";
import {
  BRAND_THEME_COLOR_KEYS,
  DEFAULT_BRAND_THEME,
  HEX_COLOR_PATTERN,
  normaliseHexColor,
  type BrandThemeColors,
} from "@platform/types";

/**
 * Turns the active theme into CSS custom properties.
 *
 * Safety model (docs/PHASE_8_IMPLEMENTATION_PLAN.md §14.5):
 *
 *   - The output is a React style OBJECT, never a CSS string. React sets
 *     custom properties through the CSSOM, so a value can never break
 *     out of its declaration into a new rule, and
 *     `dangerouslySetInnerHTML` is not involved anywhere.
 *   - Every value is re-validated here against the same
 *     `^#[0-9A-Fa-f]{6}$` grammar the API enforces. The API is already
 *     the authority, but a compromised or stale response must not be
 *     able to place arbitrary text into a style declaration — defence in
 *     depth, at the last point before it reaches the DOM.
 *   - Any colour failing that check falls back to its default. A bad
 *     value degrades one colour, never the whole page.
 *   - Only the four themeable identity colours are emitted. The fixed
 *     palette stays in app/globals.css and cannot be overridden.
 */

/** The four themeable identity colours, as CSS custom property names. */
const CSS_VARIABLE_BY_KEY = {
  primary: "--color-primary",
  secondary: "--color-secondary",
  accent: "--color-accent",
  accentInteractive: "--color-accent-interactive",
} as const;

/**
 * The focus ring follows the primary colour, matching the contrast rule
 * the API validates (focus vs background and vs surface).
 */
const FOCUS_RING_VARIABLE = "--color-focus-ring";

function safeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) return fallback;
  return normaliseHexColor(value);
}

/** Sanitises an untrusted theme payload into a usable one. */
export function safeTheme(colors: Partial<BrandThemeColors> | undefined | null): BrandThemeColors {
  const result = {} as BrandThemeColors;
  for (const key of BRAND_THEME_COLOR_KEYS) {
    result[key] = safeColor(colors?.[key], DEFAULT_BRAND_THEME[key]);
  }
  return result;
}

/**
 * Builds the style object applied to the shell wrapper. Descendants
 * resolve `var(--color-primary)` and friends from here, overriding the
 * :root defaults in globals.css without replacing them — the CSS values
 * remain as a fallback if this element is ever absent.
 */
export function themeStyle(colors: Partial<BrandThemeColors> | undefined | null): CSSProperties {
  const safe = safeTheme(colors);

  const style: Record<string, string> = {};
  for (const key of BRAND_THEME_COLOR_KEYS) {
    style[CSS_VARIABLE_BY_KEY[key]] = safe[key];
  }
  style[FOCUS_RING_VARIABLE] = safe.primary;

  return style as CSSProperties;
}
