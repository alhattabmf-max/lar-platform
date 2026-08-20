import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class CreateLocationDto {
  @IsUUID()
  cityId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(1)
  shortAddress!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsString()
  @MinLength(1)
  contactName!: string;

  @IsString()
  @MinLength(1)
  contactPhone!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
