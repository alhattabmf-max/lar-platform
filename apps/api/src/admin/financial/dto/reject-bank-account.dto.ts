import { IsOptional, IsString } from "class-validator";

export class RejectBankAccountDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
