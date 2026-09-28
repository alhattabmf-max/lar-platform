import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/**
 * Transport-level shape only. Link safety, schedule overlap and the
 * concurrent-live limit are enforced in the services, so the same rules
 * apply however a value arrives — a DTO can only ever be the first
 * filter, never the authority.
 *
 * `whitelist` + `forbidNonWhitelisted` are set globally in
 * configure-app.ts, so any property not declared here is REJECTED
 * rather than silently dropped. That is what makes these DTOs closed.
 */

const TITLE_MAX = 120;
const BODY_MAX = 500;
const LINK_MAX = 2048;

export enum BannerPlacementDto {
  PUBLIC_HOME = "PUBLIC_HOME",
  PUBLIC_OPPORTUNITIES = "PUBLIC_OPPORTUNITIES",
}

export class CreateBannerDto {
  @IsEnum(BannerPlacementDto)
  placement!: BannerPlacementDto;

  // NO TITLE AND NO BODY. A banner is artwork; every word a visitor
  // reads is drawn inside the image, so there is nothing here for an
  // operator to write and nothing to render.

  @IsOptional()
  @IsString()
  @MaxLength(LINK_MAX)
  linkUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

/**
 * `placement` is deliberately ABSENT.
 *
 * It is immutable after creation: changing it would require one
 * operation to hold advisory locks on two placements at once, which
 * deadlocks as soon as two admins move banners in opposite directions.
 * Since banners are never deleted, moving one means deactivating it and
 * creating another. With forbidNonWhitelisted, sending `placement` here
 * is a 400 rather than a silent no-op.
 */
export class UpdateBannerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(TITLE_MAX)
  titleAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(TITLE_MAX)
  titleEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(BODY_MAX)
  bodyAr?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(BODY_MAX)
  bodyEn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(LINK_MAX)
  linkUrl?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class SetBannerScheduleDto {
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export class ToggleBannerDto {
  @IsBoolean()
  isActive!: boolean;
}

export class ReorderBannersDto {
  @IsEnum(BannerPlacementDto)
  placement!: BannerPlacementDto;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID("4", { each: true })
  bannerIds!: string[];
}

export class ListBannersQueryDto {
  @IsEnum(BannerPlacementDto)
  placement!: BannerPlacementDto;
}


