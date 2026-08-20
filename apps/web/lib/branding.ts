import { cache } from "react";
import { EMPTY_BRANDING_PUBLIC, type BrandingPublic } from "@platform/types";
import { apiClient } from "./api-client";

/**
 * Public branding for the shell, including the ACTIVE brand theme.
 *
 * Deliberately `cache: "no-store"` for now, not a revalidate window.
 *
 * Branding now carries the theme, so a stale cache would mean an admin
 * publishes new brand colours and nothing changes until the window
 * elapses — with no way to tell whether the publish worked. Correct
 * cache invalidation on publish is real infrastructure (tag-based
 * revalidation wired through the API), and building it here would be
 * 8G's work brought forward for no benefit. Until 8G revisits caching
 * as a whole, the shell reads fresh.
 *
 * A failure here must never break the page — the shell falls back to the
 * all-null contract, which carries the DEFAULT theme, and renders a
 * translated placeholder name. A brand logo is not worth a 500.
 */
export const getBranding = cache(async (): Promise<BrandingPublic> => {
  try {
    return await apiClient.get<BrandingPublic>("/branding", { cache: "no-store" });
  } catch {
    return { ...EMPTY_BRANDING_PUBLIC };
  }
});

/**
 * Picks the locale-appropriate brand name, or null when branding has not
 * been configured. Returning null (rather than a hardcoded string) is
 * what forces the caller to render a translated fallback.
 */
export function brandName(branding: BrandingPublic, locale: string): string | null {
  return locale.startsWith("ar") ? branding.nameAr : branding.nameEn;
}

export function brandDescription(branding: BrandingPublic, locale: string): string | null {
  return locale.startsWith("ar") ? branding.shortDescriptionAr : branding.shortDescriptionEn;
}
