import { IsInt, Max, Min } from "class-validator";

export class SetPaymentSettingsDto {
  @IsInt() @Min(1) @Max(180)
  paymentAttemptTimeoutMinutes!: number;
}
