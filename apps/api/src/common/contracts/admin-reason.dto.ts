import { IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";
import { ADMIN_REASON_MAX, ADMIN_REASON_MIN } from "./admin-reason.constants";

/**
 * A required, bounded, trimmed reason.
 *
 * Extend this rather than re-declaring the field: the bounds and the
 * trim behaviour then cannot drift between one administrative action
 * and the next.
 *
 * `whitelist: true, forbidNonWhitelisted: true` is set globally, so a
 * subclass that adds no fields of its own still rejects any extra
 * property in the body.
 */
export class AdminReasonBodyDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(ADMIN_REASON_MIN)
  @MaxLength(ADMIN_REASON_MAX)
  reason!: string;
}
