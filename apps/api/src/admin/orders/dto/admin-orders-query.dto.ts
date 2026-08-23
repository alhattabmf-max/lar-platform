import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { MASTER_ORDER_STATUSES } from "@platform/types";

/**
 * List controls for the admin orders queue.
 *
 * `status` is validated against the SHARED `MASTER_ORDER_STATUSES`
 * rather than a locally declared list, so the API and the portal cannot
 * drift on what a valid filter is. There are exactly two values — an
 * order is IN_FULFILLMENT or FULFILLED; there is no cancelled or
 * pending master order, because a `MasterOrder` row is created by the
 * payment that paid for it.
 *
 * `pageSize` caps at 100. The orders table grows without bound and an
 * uncapped page size is a way to ask the database for all of it.
 */
export class AdminOrdersQueryDto {
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
  @IsIn(MASTER_ORDER_STATUSES)
  status?: string;

  @IsOptional()
  @IsUUID()
  traderCompanyId?: string;

  @IsOptional()
  @IsUUID()
  supplierCompanyId?: string;
}
