import type { BrandingPublic } from "@platform/types";
import { brandName } from "@/lib/branding";

/**
 * Brand name + logo, both sourced from the Branding API.
 *
 * Neither is ever hardcoded. When branding has not been configured, or
 * the API is unreachable, `name` is null and the caller supplies a
 * TRANSLATED fallback — which is why `fallbackName` is a required prop
 * rather than a default string baked in here.
 *
 * The logo uses a plain <img>: the URL is an arbitrary absolute URL from
 * an admin-managed setting, and next/image would require every possible
 * host to be pre-registered in next.config. `alt` is the brand name, so
 * the mark is never announced as an unlabelled image.
 */
export interface BrandMarkProps {
  branding: BrandingPublic;
  locale: string;
  /** Translated placeholder used when no brand name is configured. */
  fallbackName: string;
  variant?: "main" | "small";
}

export function BrandMark({ branding, locale, fallbackName, variant = "main" }: BrandMarkProps) {
  const name = brandName(branding, locale) ?? fallbackName;
  const logoUrl = variant === "small" ? branding.logoSmallUrl : branding.logoMainUrl;

  return (
    <span className="inline-flex items-center gap-2">
      {logoUrl ? <img src={logoUrl} alt={name} className="h-8 w-auto" /> : null}
      <span className="text-base font-semibold text-primary-foreground">{name}</span>
    </span>
  );
}
