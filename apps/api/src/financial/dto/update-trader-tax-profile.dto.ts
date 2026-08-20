import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateTraderTaxProfileDto {
  @IsBoolean()
  isVatRegistered!: boolean;

  @IsOptional()
  @IsString()
  vatNumber?: string;

  @IsString()
  @MinLength(1)
  billingLegalName!: string;
}
