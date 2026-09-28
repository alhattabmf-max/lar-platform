import { IsEnum } from "class-validator";
import { BANNER_IMAGE_LOCALES, type BannerImageLocale } from "@platform/types";

export enum PublicBannerPlacement {
  PUBLIC_HOME = "PUBLIC_HOME",
  PUBLIC_OPPORTUNITIES = "PUBLIC_OPPORTUNITIES",
}

/**
 * `placement` is required rather than optional: a caller must say which
 * surface it is rendering. Defaulting it would let a typo silently
 * return another placement's banners.
 */
const LOCALE_VALUES = Object.fromEntries(
  BANNER_IMAGE_LOCALES.map((locale) => [locale, locale]),
) as Record<BannerImageLocale, BannerImageLocale>;

export class ListPublicBannersQueryDto {
  @IsEnum(PublicBannerPlacement)
  placement!: PublicBannerPlacement;

  /**
   * Which language's artwork to return, and it is REQUIRED.
   *
   * There is no fallback between languages, so a caller that omitted
   * this could only be served a guess. A 400 says so plainly.
   */
  @IsEnum(LOCALE_VALUES)
  locale!: BannerImageLocale;
}
