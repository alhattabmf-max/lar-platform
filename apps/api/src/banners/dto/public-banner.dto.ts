import { IsEnum } from "class-validator";

export enum PublicBannerPlacement {
  PUBLIC_HOME = "PUBLIC_HOME",
  PUBLIC_OPPORTUNITIES = "PUBLIC_OPPORTUNITIES",
}

/**
 * `placement` is required rather than optional: a caller must say which
 * surface it is rendering. Defaulting it would let a typo silently
 * return another placement's banners.
 */
export class ListPublicBannersQueryDto {
  @IsEnum(PublicBannerPlacement)
  placement!: PublicBannerPlacement;
}
