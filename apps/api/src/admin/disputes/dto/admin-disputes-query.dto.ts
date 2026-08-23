import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import { DISPUTE_STATUSES } from "@platform/types";

/**
 * List controls for the admin dispute queue.
 *
 * `status` is validated against the SHARED `DISPUTE_STATUSES`. The four
 * `RESOLVED_*` values are distinct filters and are not collapsed into
 * one: which outcome a case reached — refunded, partially refunded,
 * rejected, replaced — is the whole question an operator filters by.
 *
 * Replaces a bare `@Query("status") status?: string`, which passed any
 * string through to `status: filters.status as never` and let a typo
 * reach Prisma as an unknown enum value.
 */
export class AdminDisputesQueryDto {
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
  @IsIn(DISPUTE_STATUSES)
  status?: string;
}
