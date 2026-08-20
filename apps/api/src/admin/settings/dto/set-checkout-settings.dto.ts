import { IsInt, Max, Min } from "class-validator";

export class SetCheckoutSettingsDto {
  @IsInt() @Min(1) @Max(180)
  lockDurationMinutes!: number;

  @IsInt() @Min(1) @Max(20)
  abuseThresholdCount!: number;

  @IsInt() @Min(1) @Max(1440)
  abuseWindowMinutes!: number;

  @IsInt() @Min(1) @Max(1440)
  cooldownMinutes!: number;
}
