import { IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class UpdateLocationDto {
  @IsOptional()
  @IsUUID()
  cityId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  shortAddress?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  contactPhone?: string;
}
