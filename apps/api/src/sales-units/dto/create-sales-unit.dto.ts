import { IsString, MinLength } from "class-validator";

export class CreateSalesUnitDto {
  @IsString()
  @MinLength(1)
  nameAr!: string;

  @IsString()
  @MinLength(1)
  nameEn!: string;
}
