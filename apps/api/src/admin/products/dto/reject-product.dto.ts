import { IsOptional, IsString } from "class-validator";

export class RejectProductDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
