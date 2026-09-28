import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../common/contracts/admin-reason.constants";

/**
 * Why an administrator recorded a replacement as never delivered.
 *
 * IT TOOK NO REASON AT ALL. The endpoint was a bodyless POST, and yet
 * this is a decision AGAINST the supplier: it closes the replacement
 * they were fulfilling and opens a second decision on the dispute — a
 * full or partial refund. The platform's own rule is that every
 * administrative decision that denies something carries a written
 * reason, and this one escaped it because no screen ever sent it.
 *
 * Bounds and trimming are shared with every other administrative reason
 * so they cannot drift apart.
 */
export class AdminMarkReplacementFailedDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reasonNote!: string;
}
