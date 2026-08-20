import { IsString, MinLength } from "class-validator";

export class CreateBuyerBillingOverrideDto {
  @IsString()
  @MinLength(1)
  reasonNote!: string;
}
