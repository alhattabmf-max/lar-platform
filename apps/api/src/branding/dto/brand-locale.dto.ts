import { IsEnum } from "class-validator";
import { BRAND_ASSET_LOCALES, type BrandAssetLocale } from "@platform/types";

/**
 * Which language's identity a request is about.
 *
 * REQUIRED, never defaulted. There is no fallback between the two
 * logos, so a caller that omitted this could only be served a guess —
 * and on the header that means an Arabic reader shown English artwork.
 * Making it required turns that mistake into a 400 at the edge.
 *
 * Built from the shared constant rather than a second enum declared
 * here, so the accepted values cannot drift from the contract.
 */
const LOCALE_VALUES = Object.fromEntries(
  BRAND_ASSET_LOCALES.map((locale) => [locale, locale]),
) as Record<BrandAssetLocale, BrandAssetLocale>;

export class BrandLocaleQueryDto {
  @IsEnum(LOCALE_VALUES)
  locale!: BrandAssetLocale;
}
