import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { ADMIN_USER_STATUSES } from "@platform/types";

/**
 * List controls shared by every admin list: page, size, search, filter.
 *
 * `pageSize` is capped at 100. An admin list is unbounded where a
 * supplier's is not, and an uncapped page size is a way to ask the
 * database for the whole table.
 *
 * `status` is validated against the SHARED vocabulary rather than a
 * locally declared enum, so the API and the portal cannot drift on what
 * a valid filter is. Anything outside it is a 400, not a silent fallback
 * — a caller sending `status=deleted` has a bug, and quietly returning
 * everything would hide it.
 */
export class AdminUsersQueryDto {
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

  @IsOptional()
  @IsIn(ADMIN_USER_STATUSES)
  status?: string;
}
