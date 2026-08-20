import { IsString, MinLength } from "class-validator";

export class CreateRegionDto {
  @IsString()
  @MinLength(1)
  nameAr!: string;

  @IsString()
  @MinLength(1)
  nameEn!: string;
}
