/**
 * Administrator-editable site content.
 *
 * The narrowest thing that answers "change the homepage wording and the
 * top-bar categories without a deploy". It is NOT a CMS: there is no
 * content table, no versioning, no draft/publish, and no migration. Two
 * rows in the existing `system_settings` registry hold it, validated and
 * audited by the machinery that already exists for every other setting.
 *
 * TWO RULES MAKE IT SAFE TO STORE OPERATOR-WRITTEN TEXT:
 *
 *   1. Every string is rendered as a TEXT NODE. No HTML, no Markdown, no
 *      `dangerouslySetInnerHTML`. A stored-content surface that renders
 *      markup is a stored XSS waiting for one careless paste.
 *   2. The header carries TAXONOMY NODE IDS, never URLs. An operator
 *      cannot type a destination, so there is nothing to allowlist and
 *      no way to point the navigation off-site.
 *
 * Both settings are optional. A missing or malformed value falls back to
 * the built-in message catalogue, so a bad edit degrades to the shipped
 * copy rather than to an empty page.
 */

/** Maximum characters per field. Bounded because unbounded text is a payload. */
export const SITE_CONTENT_LIMITS = {
  heroTitle: 120,
  heroDescription: 400,
  featuredTitle: 120,
  policiesTitle: 120,
  policiesDescription: 400,
} as const;

export type SiteContentField = keyof typeof SITE_CONTENT_LIMITS;

export const SITE_CONTENT_FIELDS = [
  "heroTitle",
  "heroDescription",
  "featuredTitle",
  "policiesTitle",
  "policiesDescription",
] as const satisfies readonly SiteContentField[];

/** The most categories the header will render, whatever is configured. */
export const HEADER_NAV_MAX_ITEMS = 8;

/** One field, in both languages. Either may be null, meaning "use the default". */
export interface SiteContentText {
  ar: string | null;
  en: string | null;
}

/**
 * One header entry: a taxonomy node, resolved to its names.
 *
 * The stored value is only an id. The names are read from the taxonomy at
 * request time, so renaming a category renames the menu item, and there
 * is no second copy of a name to drift.
 */
export interface HeaderNavItem {
  taxonomyNodeId: string;
  nameAr: string;
  nameEn: string;
}

/**
 * `GET /public/site-content` — anonymous, cacheable.
 *
 * Every text field may be null. A consumer MUST fall back to its own
 * message catalogue for each null rather than rendering an empty string:
 * "the operator has not customised this" and "the operator set it to
 * nothing" are the same state, and the built-in copy is the right answer
 * to both.
 */
export interface SiteContent {
  heroTitle: SiteContentText;
  heroDescription: SiteContentText;
  featuredTitle: SiteContentText;
  policiesTitle: SiteContentText;
  policiesDescription: SiteContentText;
  /**
   * Categories for the top bar, in the operator's order.
   *
   * Only nodes that still exist AND are still active appear. A node that
   * was deleted or deactivated is dropped silently — the header must not
   * break because a category was retired, and an item that 404s is worse
   * than an item that is gone.
   */
  headerNav: HeaderNavItem[];
}

export const SITE_CONTENT_KEYS = [
  "heroTitle",
  "heroDescription",
  "featuredTitle",
  "policiesTitle",
  "policiesDescription",
  "headerNav",
] as const satisfies readonly (keyof SiteContent)[];

/**
 * The registry keys these two settings live under.
 *
 * Shared because BOTH sides need the same literals: the API registers
 * them in its settings registry, and the admin screen writes to
 * `PUT /admin/settings/{key}`. A copy typed into the browser is how the
 * portal ends up writing to a key nothing reads — the write succeeds,
 * the screen reports success, and the site never changes.
 */
export const SITE_CONTENT_SETTING_KEY = "homepage_content";
export const HEADER_NAV_SETTING_KEY = "header_nav";

/** True when the value is a usable text pair. */
export function isSiteContentText(value: unknown): value is SiteContentText {
  if (typeof value !== "object" || value === null) return false;
  const { ar, en } = value as { ar?: unknown; en?: unknown };
  return (
    (ar === null || typeof ar === "string") && (en === null || typeof en === "string")
  );
}
