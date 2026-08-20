import { IsString, MinLength } from "class-validator";

export class AdminConfirmDeliveryDto {
  @IsString() @MinLength(1)
  reasonNote!: string;
}
