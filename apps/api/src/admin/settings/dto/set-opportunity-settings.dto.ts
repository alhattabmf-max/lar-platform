import { IsBoolean, IsInt, Max, Min } from "class-validator";

export class SetOpportunitySettingsDto {
  @IsInt()
  @Min(1)
  @Max(720)
  minDurationHours!: number;

  @IsInt()
  @Min(1)
  @Max(90)
  maxDurationDays!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  minTargetQuantity!: number;

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  maxTargetQuantity!: number;

  @IsBoolean()
  showScheduledPubliclyEnabled!: boolean;
}
