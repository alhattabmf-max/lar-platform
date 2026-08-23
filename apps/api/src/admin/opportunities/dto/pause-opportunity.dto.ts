import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../../common/contracts/admin-reason.constants";

/**
 * Why a live opportunity was paused.
 *
 * The reason is stored as `pauseReason` and shown to the supplier. The
 * minimum was 1; a one-character explanation for halting someone's
 * active listing is not one.
 */
export class PauseOpportunityDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reason!: string;
}
