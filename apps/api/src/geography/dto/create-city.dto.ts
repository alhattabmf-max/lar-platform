import { IsString, IsUUID, MinLength } from "class-validator";

export class CreateCityDto {
  @IsUUID()
  regionId!: string;

  @IsString()
  @MinLength(1)
  nameAr!: string;

  @IsString()
  @MinLength(1)
  nameEn!: string;
}
