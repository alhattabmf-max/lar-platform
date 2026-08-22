import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { MAX_TRADER_PAGE_SIZE } from "@platform/types";

/**
 * Bounded pagination for every trader list.
 *
 * A value above the ceiling is a 400 rather than a silent clamp: a
 * caller asking for 500 should learn it will not get 500, instead of
 * receiving 50 and believing it has seen everything.
 */
export class TraderPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_TRADER_PAGE_SIZE)
  pageSize?: number = 20;
}
