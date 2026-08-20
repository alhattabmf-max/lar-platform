import { IsOptional, IsString, IsUUID, IsUrl, MinLength } from "class-validator";

export class CreateTaxonomyNodeDto {
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsString()
  @MinLength(1)
  nameAr!: string;

  @IsString()
  @MinLength(1)
  nameEn!: string;

  @IsOptional()
  @IsUrl()
  iconUrl?: string;
}
