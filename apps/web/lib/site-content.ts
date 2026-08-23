import { cache } from "react";
import { SITE_CONTENT_FIELDS, type SiteContent, type SiteContentField } from "@platform/types";
import { apiClient } from "./api-client";

/**
 * The operator-editable homepage text and header categories.
 *
 * PUBLIC and CACHEABLE, unlike every admin read: this is the same
 * response an anonymous visitor gets, it contains nothing about anyone,
 * and the front door is the most-requested page on the site. A short
 * revalidate window means an edit appears within a minute rather than
 * on the next deploy, without every visitor causing a settings query.
 *
 * A FAILED READ IS NOT AN ERROR HERE. It resolves to the empty shape —
 * every field null, no categories — and each consumer falls back to its
 * own message catalogue. The front door must render when the settings
 * query is down; refusing to serve a homepage because a piece of
 * optional copy could not be fetched would be a strictly worse outcome
 * than serving the shipped wording.
 *
 * `cache()` deduplicates within a single server request, so the header
 * and the page body share one fetch.
 */

/** Every field null and no categories: what "not customised" looks like. */
export const EMPTY_SITE_CONTENT: SiteContent = {
  heroTitle: { ar: null, en: null },
  heroDescription: { ar: null, en: null },
  featuredTitle: { ar: null, en: null },
  policiesTitle: { ar: null, en: null },
  policiesDescription: { ar: null, en: null },
  headerNav: [],
};

/** How long a cached copy may be served. Short: this is editable content. */
const REVALIDATE_SECONDS = 60;

export const getSiteContent = cache(async (): Promise<SiteContent> => {
  try {
    const content = await apiClient.get<SiteContent>("/public/site-content", {
      revalidate: REVALIDATE_SECONDS,
    });
    return normalise(content);
  } catch {
    // Deliberately swallowed. See above: the homepage renders with the
    // shipped copy rather than not at all.
    return EMPTY_SITE_CONTENT;
  }
});

/**
 * Reduces anything unexpected to the empty shape, field by field.
 *
 * The API validates on write and again on read, so this should never
 * change a well-formed response. It exists because this value crossed a
 * JSON boundary, where the declared type is a claim rather than a
 * guarantee — and the one thing that must not happen is a malformed
 * field reaching a `.ar` access and throwing on the front door.
 */
function normalise(content: SiteContent): SiteContent {
  const result: SiteContent = { ...EMPTY_SITE_CONTENT, headerNav: [] };

  for (const field of SITE_CONTENT_FIELDS) {
    const raw: unknown = (content as unknown as Record<string, unknown>)[field];
    if (typeof raw !== "object" || raw === null) continue;
    const pair = raw as { ar?: unknown; en?: unknown };
    result[field] = {
      ar: typeof pair.ar === "string" && pair.ar.trim() !== "" ? pair.ar : null,
      en: typeof pair.en === "string" && pair.en.trim() !== "" ? pair.en : null,
    };
  }

  if (Array.isArray(content.headerNav)) {
    result.headerNav = content.headerNav.filter(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.taxonomyNodeId === "string" &&
        typeof item.nameAr === "string" &&
        typeof item.nameEn === "string"
    );
  }

  return result;
}

/**
 * The operator's wording for one field, or null to use the default.
 *
 * An empty string counts as NOT SET. "The operator has not customised
 * this" and "the operator set it to nothing" are the same state, and
 * the shipped copy is the right answer to both — a homepage with a
 * blank heading is not a design choice anyone made.
 *
 * Returns a plain string, which every caller renders as a TEXT NODE.
 * There is no markup path for this value anywhere in the app: no HTML,
 * no Markdown, no `dangerouslySetInnerHTML`. That is what makes
 * operator-written content safe to store at all.
 */
export function siteText(
  content: SiteContent,
  field: SiteContentField,
  locale: string
): string | null {
  const pair = content[field];
  const value = locale.startsWith("ar") ? pair.ar : pair.en;
  return value !== null && value.trim() !== "" ? value : null;
}
