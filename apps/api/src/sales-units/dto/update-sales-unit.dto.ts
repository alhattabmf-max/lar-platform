import { IsOptional, IsString, MinLength } from "class-validator";

export class UpdateSalesUnitDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nameEn?: string;
}
