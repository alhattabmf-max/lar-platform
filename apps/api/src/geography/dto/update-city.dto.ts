import { IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class UpdateCityDto {
  @IsOptional()
  @IsUUID()
  regionId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nameEn?: string;
}
