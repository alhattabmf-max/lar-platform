const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED_ARABIC_INDIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹"; // Persian/Urdu variant, seen in some locales

/**
 * Normalizes Arabic-Indic and Extended Arabic-Indic digits to plain
 * ASCII digits, and strips whitespace (including non-breaking and
 * zero-width spaces) — so "١٥ ١٢٣٤٥٦٧٨٩٠١٢٣" and "150123456789012"
 * validate identically. Never silently drops non-digit characters
 * other than whitespace, so a genuinely malformed input still fails
 * the caller's format check afterward.
 */
export function normalizeDigitsAndWhitespace(input: string): string {
  let result = "";
  for (const ch of input) {
    const arabicIdx = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (arabicIdx !== -1) {
      result += String(arabicIdx);
      continue;
    }
    const extendedIdx = EXTENDED_ARABIC_INDIC_DIGITS.indexOf(ch);
    if (extendedIdx !== -1) {
      result += String(extendedIdx);
      continue;
    }
    if (/\s/.test(ch)) continue;
    result += ch;
  }
  return result.replace(/[\u200B-\u200F\uFEFF]/g, "");
}
