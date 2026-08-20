import { IsString, MinLength } from "class-validator";

export class AdminConfirmReplacementDeliveryDto {
  @IsString() @MinLength(1)
  reasonNote!: string;
}
