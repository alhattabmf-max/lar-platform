import { IsEnum } from "class-validator";
import { BANNER_IMAGE_LOCALES, type BannerImageLocale } from "@platform/types";

/**
 * Which language's artwork a request is about.
 *
 * REQUIRED, never defaulted. A default would mean a caller that forgot
 * the parameter silently gets one language's picture — and on the
 * public strip that is an Arabic reader shown English artwork, which is
 * the one outcome the whole two-image design exists to prevent. Making
 * it required turns that mistake into a 400 at the edge.
 *
 * Built from the shared constant rather than a second enum declared
 * here, so the accepted values cannot drift from the contract.
 */
const LOCALE_VALUES = Object.fromEntries(
  BANNER_IMAGE_LOCALES.map((locale) => [locale, locale]),
) as Record<BannerImageLocale, BannerImageLocale>;

export class BannerLocaleQueryDto {
  @IsEnum(LOCALE_VALUES)
  locale!: BannerImageLocale;
}
