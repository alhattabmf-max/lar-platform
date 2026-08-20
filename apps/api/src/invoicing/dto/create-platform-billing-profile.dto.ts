import { IsBoolean, IsObject, IsOptional, IsString, MinLength } from "class-validator";

export class CreatePlatformBillingProfileDto {
  @IsString()
  @MinLength(1)
  legalName!: string;

  @IsString()
  @MinLength(1)
  crNumber!: string;

  @IsBoolean()
  isVatRegistered!: boolean;

  @IsOptional()
  @IsString()
  vatNumber?: string;

  @IsObject()
  addressSnapshot!: Record<string, unknown>;
}
