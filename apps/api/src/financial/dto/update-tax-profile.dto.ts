import { IsBoolean, IsOptional, IsString } from "class-validator";

export class UpdateTaxProfileDto {
  @IsBoolean()
  isVatRegistered!: boolean;

  @IsOptional()
  @IsString()
  vatNumber?: string;
}
