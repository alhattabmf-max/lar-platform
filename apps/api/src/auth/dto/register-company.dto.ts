import {
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsLatitude,
  IsLongitude,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";

export class RegisterCompanyDto {
  @IsString()
  @MinLength(1)
  crNumber!: string;

  @IsString()
  @MinLength(1)
  legalName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  primaryMobile1!: string;

  @IsString()
  @MinLength(1)
  primaryMobile2!: string;

  @IsUUID()
  cityId!: string;

  @IsString()
  @MinLength(1)
  shortAddress!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID("4", { each: true })
  acceptedPolicyVersionIds!: string[];
}
