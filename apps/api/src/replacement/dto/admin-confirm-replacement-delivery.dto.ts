import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
} from "../../common/contracts/admin-reason.constants";

/**
 * Why an administrator confirmed a replacement delivered on the buyer's
 * behalf.
 *
 * The same override as `AdminConfirmDeliveryDto`, on the replacement
 * rather than the original allocation, and it escaped the same
 * correction: the minimum was 1, which accepts a single character as the
 * record of why the platform closed a replacement for someone else.
 *
 * Bounds and trimming are shared with every other administrative reason
 * so they cannot drift apart.
 */
export class AdminConfirmReplacementDeliveryDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reasonNote!: string;
}
