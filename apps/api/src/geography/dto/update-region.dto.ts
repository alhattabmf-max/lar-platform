import { IsOptional, IsString, MinLength } from "class-validator";

export class UpdateRegionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nameEn?: string;
}
