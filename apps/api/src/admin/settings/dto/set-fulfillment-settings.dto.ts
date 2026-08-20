import { IsNumber, Max, Min } from "class-validator";

export class SetFulfillmentSettingsDto {
  @IsNumber() @Min(100) @Max(1000)
  lateThresholdPercent!: number;

  @IsNumber() @Min(100) @Max(1000)
  criticalThresholdPercent!: number;
}
