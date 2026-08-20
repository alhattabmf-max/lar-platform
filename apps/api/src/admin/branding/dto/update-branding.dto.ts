import { IsOptional, IsString, IsUrl } from "class-validator";

export class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  nameAr?: string;

  @IsOptional()
  @IsString()
  nameEn?: string;

  @IsOptional()
  @IsUrl()
  logoMainUrl?: string;

  @IsOptional()
  @IsUrl()
  logoSmallUrl?: string;

  @IsOptional()
  @IsUrl()
  faviconUrl?: string;

  @IsOptional()
  @IsString()
  shortDescriptionAr?: string;

  @IsOptional()
  @IsString()
  shortDescriptionEn?: string;

  @IsOptional()
  @IsUrl()
  invoiceLogoUrl?: string;

  @IsOptional()
  @IsUrl()
  emailLogoUrl?: string;
}
