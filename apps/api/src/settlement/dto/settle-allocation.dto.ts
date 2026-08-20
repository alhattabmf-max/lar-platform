import { IsOptional, IsString, MinLength } from "class-validator";

export class SettleAllocationDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  externalTransferReference?: string;
}
