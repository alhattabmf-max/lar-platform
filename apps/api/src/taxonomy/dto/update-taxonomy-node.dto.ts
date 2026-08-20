import { IsOptional, IsString, IsUrl, MinLength } from "class-validator";

export class UpdateTaxonomyNodeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nameEn?: string;

  @IsOptional()
  @IsUrl()
  iconUrl?: string;
}
