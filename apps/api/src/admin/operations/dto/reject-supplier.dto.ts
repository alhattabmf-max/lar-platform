import { IsOptional, IsString } from "class-validator";

export class RejectSupplierDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
