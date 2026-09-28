import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  ADMIN_ORDER_STAGES,
  DASHBOARD_PERIODS,
  FOLLOW_UP_CASE_KINDS,
  FOLLOW_UP_PRIORITIES,
  type DashboardPeriod,
} from "@platform/types";
import { ExportLabelsDto } from "../../exports/dto/export-labels.dto";

/**
 * The window every dashboard read is measured over.
 *
 * ONE PLACE DECIDES THE DEFAULT. Three screens read this parameter, and
 * three copies of `?? "30d"` is three chances for the overview and the
 * orders page to disagree about which thirty days they are showing.
 */
class PeriodQueryDto {
  @IsOptional()
  @IsIn(DASHBOARD_PERIODS)
  period?: string;

  resolvedPeriod(): DashboardPeriod {
    return (this.period as DashboardPeriod) ?? "30d";
  }
}

export class DashboardQueryDto extends PeriodQueryDto {}

class PagedPeriodQueryDto extends PeriodQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class OrdersQueryDto extends PagedPeriodQueryDto {
  /**
   * Which of the four stages to show.
   *
   * Validated against the SHARED vocabulary, so a stage the mapper does
   * not produce is a 400 rather than an empty table an operator would
   * read as "no orders".
   */
  @IsOptional()
  @IsIn(ADMIN_ORDER_STAGES)
  stage?: string;
}

export class FollowUpQueryDto extends PagedPeriodQueryDto {
  @IsOptional()
  @IsIn(FOLLOW_UP_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsIn(FOLLOW_UP_CASE_KINDS)
  kind?: string;

  /**
   * An administrator's id, or the literal `UNASSIGNED`.
   *
   * "Nobody has this" is a question worth asking, and it is not a
   * value any id could carry — so it is spelled out rather than encoded
   * as an empty string, which the query layer would drop.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignee?: string;
}

/**
 * The export's query: the filters AND the headings, in one class.
 *
 * TWO `@Query()` PARAMETERS WOULD 400. Nest hands the whole query to
 * each decorated parameter and validates it against that class alone,
 * and this application runs `forbidNonWhitelisted` — so the filter
 * class would reject `c1` and the label class would reject `priority`.
 */
export class FollowUpExportQueryDto extends ExportLabelsDto {
  @IsOptional()
  @IsIn(DASHBOARD_PERIODS)
  period?: string;

  @IsOptional()
  @IsIn(FOLLOW_UP_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsIn(FOLLOW_UP_CASE_KINDS)
  kind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assignee?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  resolvedPeriod(): DashboardPeriod {
    return (this.period as DashboardPeriod) ?? "30d";
  }
}

export class AssignFollowUpDto {
  /**
   * Null takes the case off whoever had it.
   *
   * Absent and null mean the same thing here, deliberately: "nobody" is
   * a real answer, not a missing one.
   */
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}

export class SetInProgressDto {
  @IsBoolean()
  inProgress!: boolean;
}
