import { IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength } from "class-validator";

export class UpdateProductDto {
  @IsOptional()
  @IsUUID()
  taxonomyNodeId?: string;

  @IsOptional()
  @IsUUID()
  salesUnitId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  salesUnitNameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  salesUnitNameEn?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  packageContentQuantity?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  packageContentUnitNameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  packageContentUnitNameEn?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  nameEn?: string;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  descriptionEn?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  weightPerUnit?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  lengthCm?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  widthCm?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  heightCm?: number;
}
