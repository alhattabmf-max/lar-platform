import { DEFAULT_BRAND_THEME, type BrandThemePublic } from "./brand-theme";

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
  /**
   * The PUBLISHED header logo for the requesting locale, as a route on
   * this API — never a storage key and never an off-site address.
   *
   * Null when no published set exists, or when this language has no
   * logo in it. There is deliberately NO FALLBACK to the other
   * language: an Arabic reader sees the Arabic mark or a blank
   * placeholder, never English artwork.
   */
  headerLogo: string | null;
  logoSmallUrl: string | null;
  faviconUrl: string | null;
  /**
   * The ACTIVE published theme only. Never the draft, never validation
   * detail, never admin metadata (§14.5).
   */
  theme: BrandThemePublic;
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
  "headerLogo",
  "logoSmallUrl",
  "faviconUrl",
  "theme",
] as const satisfies readonly (keyof BrandingPublic)[];

/**
 * Safe fallback when no branding row has been saved yet: every text and
 * asset field is null, and the theme falls back to the FORSA defaults.
 *
 * The web app renders a translated placeholder name rather than any
 * hardcoded brand string, and the default theme keeps the interface
 * fully usable and accessible even with no branding configured at all.
 */
export const EMPTY_BRANDING_PUBLIC: BrandingPublic = {
  nameAr: null,
  nameEn: null,
  shortDescriptionAr: null,
  shortDescriptionEn: null,
  logoMainUrl: null,
  headerLogo: null,
  logoSmallUrl: null,
  faviconUrl: null,
  theme: { colors: DEFAULT_BRAND_THEME },
};

/**
 * The languages the header logo is drawn for.
 *
 * The same locale codes the rest of the product uses, so nothing
 * translates between an enum name and a locale at any boundary.
 */
export const BRAND_ASSET_LOCALES = ["ar-SA", "en-SA"] as const;
export type BrandAssetLocale = (typeof BRAND_ASSET_LOCALES)[number];

export function isBrandAssetLocale(value: unknown): value is BrandAssetLocale {
  return (
    typeof value === "string" &&
    (BRAND_ASSET_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * What the file types are, stated once.
 *
 * PNG and WebP only. A logo needs an alpha channel — JPEG has none and
 * would put a white box behind the mark. SVG is deliberately absent: it
 * is a script-capable document, and accepting one needs its own
 * sanitisation design rather than a line in an allowlist.
 */
export const BRAND_ASSET_CONTENT_TYPES = ["image/png", "image/webp"] as const;

/**
 * What a header logo may be — ONE statement of it, shared.
 *
 * These numbers appear in four places: the server's refusal, the
 * message the operator reads, the sentence above the file picker, and
 * the tests. Written out separately they drift, and the first symptom
 * is a screen that says "under 512 KB" while the server refuses at a
 * different number.
 *
 * `maxSizeBytes` bounds the UPLOAD, not the stored file. The processor
 * re-encodes and caps every logo at 2000px on its long side, so what a
 * visitor downloads is decided by that, never by how large the source
 * export happened to be. The real cost of a big upload is decoding it,
 * and `maxPixels` is what bounds that — which is why the byte ceiling
 * can be generous enough for an ordinary designer's PNG export with an
 * alpha channel.
 */
export const BRAND_LOGO_LIMITS = {
  maxSizeBytes: 2 * 1024 * 1024,
  maxPixels: 4_000_000,
  minWidth: 64,
  minHeight: 32,
} as const;

/**
 * One language's header logo, as the admin screen sees it.
 *
 * Carries no object key: an operator sees WHETHER a logo exists, its
 * shape, and a preview route — never where the bytes live.
 */
export interface BrandAssetAdminItem {
  locale: BrandAssetLocale;
  width: number;
  height: number;
  contentType: string;
  /** Null while the set has not been published. */
  publishedAt: string | null;
  updatedAt: string;
}

/** The whole set, plus whether it may be published. */
export interface BrandAssetsAdminView {
  assets: BrandAssetAdminItem[];
  /** True when every language has a complete logo. */
  complete: boolean;
  /** True when every language is published. */
  published: boolean;
}

export const BRAND_ASSET_ADMIN_ITEM_KEYS = [
  "locale",
  "width",
  "height",
  "contentType",
  "publishedAt",
  "updatedAt",
] as const satisfies readonly (keyof BrandAssetAdminItem)[];
