/**
 * Public branding contract — served by `GET /api/v1/branding` without a
 * session, and consumed by the web app's shell (header/footer).
 *
 * This is a strict allowlist. `BrandingSettings` in the database also
 * holds `invoiceLogoUrl`, `emailLogoUrl`, `headerFooterConfig`,
 * `updatedBy`, `createdAt` and `updatedAt` — NONE of which may ever
 * appear here. Adding a field to this interface is the only way one can
 * reach the public surface, which is what makes the boundary auditable.
 */
export interface BrandingPublic {
  nameAr: string | null;
  nameEn: string | null;
  shortDescriptionAr: string | null;
  shortDescriptionEn: string | null;
  logoMainUrl: string | null;
  logoSmallUrl: string | null;
  faviconUrl: string | null;
}

/**
 * The exact, ordered set of keys a `BrandingPublic` response carries.
 *
 * Exported so both the API and the web app can assert *exact key
 * equality* rather than "does not contain a forbidden field" — an
 * exact-equality check is the only form that also catches a field added
 * later by accident.
 */
export const BRANDING_PUBLIC_KEYS = [
  "nameAr",
  "nameEn",
  "shortDescriptionAr",
  "shortDescriptionEn",
  "logoMainUrl",
  "logoSmallUrl",
  "faviconUrl",
] as const satisfies readonly (keyof BrandingPublic)[];

/**
 * Safe fallback when no branding row has been saved yet. Every field is
 * null; the web app renders a translated placeholder name rather than
 * any hardcoded brand string.
 */
export const EMPTY_BRANDING_PUBLIC: BrandingPublic = {
  nameAr: null,
  nameEn: null,
  shortDescriptionAr: null,
  shortDescriptionEn: null,
  logoMainUrl: null,
  logoSmallUrl: null,
  faviconUrl: null,
};
