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

  /**
   * A HUNDRED MILLION, matching the service.
   *
   * This read `@Max(10_000_000)` while `OpportunitySettingsService`
   * defaults to 100,000,000 and bounds the same field at 100,000,000 —
   * so the settings form could not save the value already in force, and
   * the whole group was unsavable. The service is what decides; this
   * edge check exists to refuse a malformed request, not to contradict
   * the rule behind it.
   */
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  maxTargetQuantity!: number;

  @IsBoolean()
  showScheduledPubliclyEnabled!: boolean;

  /**
   * How many days one extension adds. Thirty is the ceiling, matching
   * `maxDurationDays`: an extension that can outlast the longest
   * listing anyone may create is not a bound.
   *
   * HOW MANY TIMES a listing may be extended is deliberately absent.
   * `opportunities.extended_at` is one nullable timestamp and cannot
   * count; making the number configurable needs a schema change, not a
   * field here. See `extend()` in `opportunities.service.ts`.
   */
  @IsInt()
  @Min(1)
  @Max(30)
  extensionDays!: number;
}
