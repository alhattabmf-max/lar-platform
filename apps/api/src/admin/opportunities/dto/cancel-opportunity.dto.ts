import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../../common/contracts/admin-reason.constants";

/**
 * Why an opportunity was cancelled.
 *
 * Cancellation is terminal and releases every active checkout lock, so
 * the record of why must survive as something a person can read.
 */
export class CancelOpportunityDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reason!: string;
}
