import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { MAX_NOTIFICATION_PAGE_SIZE } from "@platform/types";

/**
 * Bounded pagination.
 *
 * `MAX_NOTIFICATION_PAGE_SIZE` is deliberately lower than the
 * platform-wide ceiling: a notification list is a dropdown and a feed,
 * never a bulk export, and the smaller cap keeps the first page — the
 * one nearly every visit loads — cheap.
 *
 * A value above it is a 400 rather than a silent clamp, so a caller
 * asking for 500 learns that it will not get 500 instead of receiving
 * 50 and believing it saw everything.
 */
export class ListNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_NOTIFICATION_PAGE_SIZE)
  pageSize?: number = 20;
}
