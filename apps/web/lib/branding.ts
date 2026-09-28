import { cache } from "react";
import {
  EMPTY_BRANDING_PUBLIC,
  type BrandingPublic,
  type FooterPublic,
} from "@platform/types";
import { apiClient } from "./api-client";
import { POLICY_ANCHORS } from "./policy-labels";
import { mediaUrl } from "./media-url";

/**
 * HOW LONG THE SHELL MAY SERVE BRANDING IT ALREADY HAS.
 *
 * One minute: long enough that a burst of traffic reads it once instead
 * of once per page, short enough that an operator publishing a logo or
 * a colour does not think the publish failed.
 */
const BRANDING_TTL = 60;

/**
 * Public branding for the shell, including the ACTIVE brand theme.
 *
 * CACHED FOR ONE MINUTE, where it used to read fresh on every page.
 *
 * This is drawn by the shell, so it was a round trip on EVERY page load
 * of the platform — one that returns the same bytes to everybody, for
 * weeks at a time. Branding is reference data in all but name.
 *
 * WHAT THE WINDOW COSTS is stated plainly, because it was the reason
 * this stayed uncached: branding carries the active theme, so an admin
 * who publishes new brand colours may wait up to `BRANDING_TTL` before
 * seeing them. That delay is now BOUNDED and short, where the cost of
 * not caching was paid by every visitor on every page.
 *
 * Tag-based invalidation — the API revalidating this the moment a
 * publish lands — is the correct end state and remains unbuilt. It is
 * the thing to build when a minute is too long, not a larger window.
 *
 * The cache key includes the locale, because the URL does.
 *
 * A failure here must never break the page — the shell falls back to the
 * all-null contract, which carries the DEFAULT theme, and renders a
 * translated placeholder name. A brand logo is not worth a 500.
 */
export const getBranding = cache(
  async (locale: string): Promise<BrandingPublic> => {
    try {
      // The locale decides which header logo comes back, and the server
      // refuses the request without it rather than guessing.
      return await apiClient.get<BrandingPublic>(
        `/branding?locale=${encodeURIComponent(locale)}`,
        { revalidate: BRANDING_TTL },
      );
    } catch {
      return { ...EMPTY_BRANDING_PUBLIC };
    }
  },
);

/**
 * Picks the locale-appropriate brand name, or null when branding has not
 * been configured. Returning null (rather than a hardcoded string) is
 * what forces the caller to render a translated fallback.
 */
export function brandName(
  branding: BrandingPublic,
  locale: string,
): string | null {
  return locale.startsWith("ar") ? branding.nameAr : branding.nameEn;
}

export function brandDescription(
  branding: BrandingPublic,
  locale: string,
): string | null {
  return locale.startsWith("ar")
    ? branding.shortDescriptionAr
    : branding.shortDescriptionEn;
}

/**
 * The header logo as a URL A BROWSER CAN ACTUALLY FETCH, or null.
 *
 * The API returns a PATH on the API origin —
 * `/api/v1/branding/logo?locale=ar-SA` — exactly as it does for every
 * opportunity, product and banner image. The web app is served from a
 * different origin, so a path left relative resolves against the WEB
 * origin instead: the browser asked Next.js for it, Next.js had no such
 * route, and the `<img>` received an HTML 404 page. That is what the
 * broken-image icon in the header was.
 *
 * `mediaUrl` is the one place that turns an API path into an absolute
 * URL, and it is what every other image in this app already goes
 * through. Using it here is not a new mechanism; it is the missing call.
 *
 * THERE IS NO FALLBACK, on purpose. A missing Arabic logo yields null
 * and the header renders its blank placeholder; it never borrows the
 * English mark, and it never prints a name in text.
 */
export function brandLogoUrl(branding: BrandingPublic): string | null {
  const value = branding.headerLogo;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? mediaUrl(trimmed) : null;
}

/**
 * The footer, as an operator configured it.
 *
 * A SEPARATE REQUEST from `getBranding`, because it is a separate
 * contract: `BrandingPublic` is pinned by an exact-key test and the
 * footer answers a different question. `cache()` de-duplicates it
 * within one render, so the extra call costs one round trip per page,
 * not one per component — and with `BRANDING_TTL` it costs none at all
 * on a warm cache.
 *
 * A failure falls back to the shipped default rather than to an empty
 * bar — the footer carries the legal links, and losing them silently is
 * worse than serving the wording the platform ships with.
 */
export const getFooter = cache(
  async (locale: string): Promise<FooterPublic> => {
    try {
      return await apiClient.get<FooterPublic>(
        `/branding/footer?locale=${encodeURIComponent(locale)}`,
        { revalidate: BRANDING_TTL },
      );
    } catch {
      return DEFAULT_FOOTER_PUBLIC;
    }
  },
);

/**
 * What the shell renders when the footer cannot be read: the five links
 * the footer had when they were written into the component, and nothing
 * else. Policy links are included — this fallback cannot know what is
 * published, and the policies page shows its own empty state.
 */
const DEFAULT_FOOTER_PUBLIC: FooterPublic = {
  links: [
    { key: "about", href: "/about", label: null },
    { key: "faq", href: "/faq", label: null },
    { key: "contact", href: "/contact", label: null },
    // DERIVED, never typed. A fragment written here and an id built on
    // the policies page is exactly how the two drift apart, and a
    // broken anchor fails silently — the visitor simply lands at the
    // top of the page.
    {
      key: "terms",
      href: `/policies#${POLICY_ANCHORS.terms_of_service}`,
      label: null,
    },
    {
      key: "privacy",
      href: `/policies#${POLICY_ANCHORS.privacy_policy}`,
      label: null,
    },
  ],
  social: [],
  email: null,
  phone: null,
  address: null,
  copyright: null,
  showDescription: true,
};
