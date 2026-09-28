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

/**
 * Maximum characters per field. Bounded because unbounded text is a
 * payload.
 *
 * The three `…Body` fields hold whole pages — About, FAQ, Contact — so
 * they are far longer than a heading, and still bounded. They are plain
 * text like every other field here: line breaks survive because the
 * renderer preserves them, and there is no markup path anywhere in this
 * app for an operator to reach.
 */
export const SITE_CONTENT_LIMITS = {
  heroTitle: 120,
  heroDescription: 400,
  featuredTitle: 120,
  policiesTitle: 120,
  policiesDescription: 400,
  aboutBody: 4000,
  faqBody: 8000,
  contactBody: 2000,
} as const;

export type SiteContentField = keyof typeof SITE_CONTENT_LIMITS;

export const SITE_CONTENT_FIELDS = [
  "heroTitle",
  "heroDescription",
  "featuredTitle",
  "policiesTitle",
  "policiesDescription",
  "aboutBody",
  "faqBody",
  "contactBody",
] as const satisfies readonly SiteContentField[];

/**
 * The fields that are whole PAGES rather than a line of chrome.
 *
 * Each backs one public route. Listed so the admin screen can give them
 * a taller editor, and so a test can assert every page has a field and
 * every such field has a page — the two cannot drift apart silently.
 */
export const SITE_CONTENT_PAGE_FIELDS = {
  about: "aboutBody",
  faq: "faqBody",
  contact: "contactBody",
} as const satisfies Record<string, SiteContentField>;

export type SiteContentPage = keyof typeof SITE_CONTENT_PAGE_FIELDS;

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
export interface SiteContent extends Record<SiteContentField, SiteContentText> {
  // DERIVED from `SITE_CONTENT_FIELDS`, not restated. This shape used to
  // list its fields by hand, so adding one to the list left the type
  // behind and every consumer indexing it stopped compiling for a reason
  // that had nothing to do with the consumer. One list is now the single
  // source: add a field there and it exists here.
  /**
   * Categories for the top bar, in the operator's order.
   *
   * Only nodes that still exist AND are still active appear. A node that
   * was deleted or deactivated is dropped silently — the header must not
   * break because a category was retired, and an item that 404s is worse
   * than an item that is gone.
   */
  headerNav: HeaderNavItem[];

  /**
   * Active questions, in the operator's order.
   *
   * Inactive items never leave the API: a retired question is not
   * something a visitor should be able to find by reading a payload.
   */
  faqItems: PublicFaqItem[];
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
export const FAQ_ITEMS_SETTING_KEY = "faq_items";

/**
 * Frequently asked questions, as ITEMS rather than one block of text.
 *
 * A single field could hold a whole FAQ, but not one an operator can
 * reorder, deactivate, or keep parallel across two languages — and a
 * page of questions is exactly the content that grows one entry at a
 * time. Each item is a question and its answer in both languages.
 *
 * Stored in `system_settings` under one key, like the header nav: no
 * table, no migration, and no endpoint of its own — the generic
 * `PUT /admin/settings/{key}` writes it and the registry validates it.
 *
 * `isActive` rather than deletion, so an operator can retire a question
 * without losing what it said. `sortOrder` is the operator's order, not
 * an alphabetical one nobody chose.
 *
 * Both strings are plain TEXT. There is no markup path for operator
 * content anywhere in this app.
 */
export const FAQ_ITEM_LIMITS = {
  question: 300,
  answer: 3000,
} as const;

/** More than this is a knowledge base, not a FAQ. */
export const FAQ_MAX_ITEMS = 50;

export interface FaqItem {
  /** Stable id, so reordering does not re-key the list. */
  id: string;
  questionAr: string;
  questionEn: string;
  answerAr: string;
  answerEn: string;
  sortOrder: number;
  isActive: boolean;
}

/** The public view: active items only, already ordered. */
export type PublicFaqItem = Omit<FaqItem, "isActive" | "sortOrder">;

export const PUBLIC_FAQ_ITEM_KEYS = [
  "id",
  "questionAr",
  "questionEn",
  "answerAr",
  "answerEn",
] as const satisfies readonly (keyof PublicFaqItem)[];

/** True when the value is a usable FAQ item. */
export function isFaqItem(value: unknown): value is FaqItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;

  const text = (field: unknown, limit: number) =>
    typeof field === "string" && field.trim() !== "" && field.length <= limit;

  return (
    typeof item.id === "string" &&
    item.id.trim() !== "" &&
    text(item.questionAr, FAQ_ITEM_LIMITS.question) &&
    text(item.questionEn, FAQ_ITEM_LIMITS.question) &&
    text(item.answerAr, FAQ_ITEM_LIMITS.answer) &&
    text(item.answerEn, FAQ_ITEM_LIMITS.answer) &&
    typeof item.sortOrder === "number" &&
    Number.isInteger(item.sortOrder) &&
    typeof item.isActive === "boolean"
  );
}

/** True when the value is a usable text pair. */
export function isSiteContentText(value: unknown): value is SiteContentText {
  if (typeof value !== "object" || value === null) return false;
  const { ar, en } = value as { ar?: unknown; en?: unknown };
  return (
    (ar === null || typeof ar === "string") && (en === null || typeof en === "string")
  );
}
