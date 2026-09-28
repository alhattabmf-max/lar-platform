import { SETTINGS_KEYS } from "../../settings/settings-keys.constants";
import {
  BANNER_POLICY_SETTING_KEY,
  FAQ_ITEMS_SETTING_KEY,
  FAQ_MAX_ITEMS,
  HEADER_NAV_MAX_ITEMS,
  SITE_CONTENT_FIELDS,
  SITE_CONTENT_LIMITS,
  isBannerImageShape,
  isFaqItem,
  isSiteContentText,
} from "@platform/types";

export type SettingValueType = "boolean" | "enum" | "json";

export interface SettingDefinition {
  key: string;
  type: SettingValueType;
  description: string;
  adminWritable: boolean;
  /**
   * Documents which SettingsService read contract applies to this key —
   * "throw-on-malformed" (getBoolean/getString: a corrupted value fails
   * loudly) vs "safe-default-on-failure" (getJsonSafe: never disables
   * protection). Informational here; the actual behavior lives in
   * whichever service reads the key.
   */
  failSafeBehavior: "throw-on-malformed" | "safe-default-on-failure";
  allowedValues?: readonly string[];
  validate: (value: unknown) => boolean;
}

/**
 * Registry of settings reachable through the GENERIC admin settings
 * endpoint (GET/PUT /admin/settings/:key). This is deliberately a
 * short, explicit allow-list — NOT a passthrough to the
 * system_settings table. A key absent from this map can never be
 * written (or read) through the generic endpoint, full stop.
 *
 * Rate limits, 2FA rate limit, and session duration are NOT registered
 * here on purpose: they are security-bounded settings with their own
 * min/max validation and belong exclusively to
 * SecuritySettingsService + its dedicated /admin/settings/security/*
 * endpoints. Registering them here too would create a second,
 * unvalidated way to write the same value — exactly what this
 * registry exists to prevent.
 */

/**
 * Homepage text: a bilingual pair per field, each within its own bound.
 *
 * Unknown keys are REJECTED rather than ignored. A settings value is
 * arbitrary JSON, and quietly accepting extra keys is how a settings row
 * becomes a place to stash something that was never reviewed.
 *
 * Length is enforced here as well as at read time. Validating on write
 * gives the operator an error they can act on; validating on read means
 * a bad value degrades safely even if it arrived another way.
 */
function validateHomepageContent(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const allowed = new Set<string>(SITE_CONTENT_FIELDS);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!allowed.has(key)) return false;
  }

  for (const field of SITE_CONTENT_FIELDS) {
    const entry = (value as Record<string, unknown>)[field];
    if (entry === undefined) continue;
    if (!isSiteContentText(entry)) return false;

    const limit = SITE_CONTENT_LIMITS[field];
    const { ar, en } = entry;
    if (typeof ar === "string" && ar.length > limit) return false;
    if (typeof en === "string" && en.length > limit) return false;
  }

  return true;
}

/**
 * Header navigation: an ordered array of taxonomy node IDS.
 *
 * IDS ONLY — never a URL, never a label. An operator cannot type a
 * destination, so there is nothing to allowlist and no way to point the
 * navigation off-site. Whether each id still exists and is active is
 * resolved at read time, because a category can be retired after it was
 * chosen.
 *
 * Shape is checked here; existence is not. A validator that queried the
 * database would make writing a setting depend on the taxonomy being
 * reachable, and the read path already drops anything unusable.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateHeaderNav(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length > HEADER_NAV_MAX_ITEMS) return false;

  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !UUID_PATTERN.test(entry)) return false;
    // The same category twice in a menu is a mistake, not an intention.
    if (seen.has(entry)) return false;
    seen.add(entry);
  }
  return true;
}

/**
 * The FAQ list: every entry well-formed, bounded, and no two sharing an
 * id.
 *
 * Validated here rather than trusted, for the same reason every other
 * JSON setting is — this arrives as a request body, and "the admin
 * screen would never send that" is not a guarantee.
 */
function validateFaqItems(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length > FAQ_MAX_ITEMS) return false;

  const seen = new Set<string>();
  for (const entry of value) {
    if (!isFaqItem(entry)) return false;
    // Two items sharing an id makes reordering ambiguous and editing
    // destructive: the screen would update whichever came first.
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
  }
  return true;
}

export const SETTINGS_REGISTRY: Record<string, SettingDefinition> = {
  [SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED]: {
    key: SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED,
    type: "boolean",
    description:
      "Gates whether new registrations require email verification before login (Phase 2). Missing key defaults to false (getBoolean fallback); a malformed stored value throws rather than silently disabling verification.",
    adminWritable: true,
    failSafeBehavior: "throw-on-malformed",
    validate: (value) => typeof value === "boolean",
  },
  [SETTINGS_KEYS.COMPANY_VERIFICATION_MODE]: {
    key: SETTINGS_KEYS.COMPANY_VERIFICATION_MODE,
    type: "enum",
    description:
      "MANUAL (default) requires admin approve/reject of supplier companies; AUTOMATIC calls the Verification Provider on registration.",
    adminWritable: true,
    failSafeBehavior: "throw-on-malformed",
    allowedValues: ["MANUAL", "AUTOMATIC"],
    validate: (value) => value === "MANUAL" || value === "AUTOMATIC",
  },
  [SETTINGS_KEYS.HOMEPAGE_CONTENT]: {
    key: SETTINGS_KEYS.HOMEPAGE_CONTENT,
    type: "json",
    description:
      "Homepage copy, per field, in Arabic and English. Every field is optional and a missing or malformed one falls back to the shipped message catalogue. Rendered as text nodes only — never HTML or Markdown.",
    adminWritable: true,
    failSafeBehavior: "safe-default-on-failure",
    validate: validateHomepageContent,
  },
  [BANNER_POLICY_SETTING_KEY]: {
    key: BANNER_POLICY_SETTING_KEY,
    type: "json",
    description:
      "Promotional banner policy: upload size and pixel ceilings, accepted content types, how many banners may be live at once per placement, and the image SHAPE — minimum dimensions and the accepted aspect-ratio band. The admin screen reads the shape from here so the browser pre-check and the server decision cannot disagree; the server always re-validates.",
    adminWritable: true,
    failSafeBehavior: "safe-default-on-failure",
    validate: (value) => {
      if (typeof value !== "object" || value === null) return false;
      const v = value as Record<string, unknown>;
      // A missing shape block is tolerated: rows written before the
      // shape existed carry none and fall back to the shipped default.
      return v.imageShape === undefined || isBannerImageShape(v.imageShape);
    },
  },
  [FAQ_ITEMS_SETTING_KEY]: {
    key: FAQ_ITEMS_SETTING_KEY,
    type: "json",
    description:
      "Frequently asked questions as ordered items, each a question and answer in Arabic and English with an active flag. Rendered as text nodes only — never HTML or Markdown. A malformed value falls back to no questions rather than breaking the page.",
    adminWritable: true,
    failSafeBehavior: "safe-default-on-failure",
    validate: validateFaqItems,
  },
  [SETTINGS_KEYS.HEADER_NAV]: {
    key: SETTINGS_KEYS.HEADER_NAV,
    type: "json",
    description:
      "Ordered taxonomy node ids shown in the public header. Ids only, never URLs. A node that is later deleted or deactivated is dropped from the header rather than breaking it.",
    adminWritable: true,
    failSafeBehavior: "safe-default-on-failure",
    validate: validateHeaderNav,
  },
};

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTINGS_REGISTRY[key];
}
