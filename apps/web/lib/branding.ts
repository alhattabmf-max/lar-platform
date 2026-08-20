import { cache } from "react";
import { EMPTY_BRANDING_PUBLIC, type BrandingPublic } from "@platform/types";
import { apiClient } from "./api-client";

/**
 * Public branding for the shell.
 *
 * This is one of the few genuinely cacheable reads in the app: it holds
 * no personal data and changes rarely, so it opts in to a short
 * revalidate window rather than the client's `no-store` default.
 *
 * A failure here must never break the page — the shell falls back to the
 * all-null contract and renders a translated placeholder name. A brand
 * logo is not worth a 500.
 */
const REVALIDATE_SECONDS = 60;

export const getBranding = cache(async (): Promise<BrandingPublic> => {
  try {
    return await apiClient.get<BrandingPublic>("/branding", { revalidate: REVALIDATE_SECONDS });
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
