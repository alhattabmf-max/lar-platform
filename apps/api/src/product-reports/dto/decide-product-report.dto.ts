import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../common/contracts/admin-reason.constants";

/**
 * Why a product report was dismissed, resolved, or sent back for
 * clarification.
 *
 * REQUIRED. It was optional, which meant a trader could file a report
 * about a product and have it dismissed with no explanation at all —
 * and "clarification requested" with no note asks them to clarify
 * something unnamed. The note is written onto the report as
 * `adminDecisionNote` and is the only thing the reporter is told.
 *
 * Bounds and trimming are shared with every other administrative
 * reason, so they cannot drift apart.
 */
export class DecideProductReportDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  note!: string;
}
