import { IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength } from "class-validator";

export class CreateProductDto {
  @IsUUID()
  taxonomyNodeId!: string;

  @IsOptional()
  @IsUUID()
  salesUnitId?: string;

  @IsString()
  @MinLength(1)
  salesUnitNameAr!: string;

  @IsString()
  @MinLength(1)
  salesUnitNameEn!: string;

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

  @IsString()
  @MinLength(1)
  nameAr!: string;

  @IsString()
  @MinLength(1)
  nameEn!: string;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  descriptionEn?: string;

  @IsNumber()
  @IsPositive()
  weightPerUnit!: number;

  @IsNumber()
  @IsPositive()
  lengthCm!: number;

  @IsNumber()
  @IsPositive()
  widthCm!: number;

  @IsNumber()
  @IsPositive()
  heightCm!: number;
}
