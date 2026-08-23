import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { REFUND_OBLIGATION_STATUSES, SUPPLIER_PAYOUT_OUTCOMES } from "@platform/types";

class BaseMoneyQueryDto {
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
}

export class AdminRefundsQueryDto extends BaseMoneyQueryDto {
  @IsOptional()
  @IsIn(REFUND_OBLIGATION_STATUSES)
  status?: string;
}

export class AdminSettlementsQueryDto extends BaseMoneyQueryDto {
  @IsOptional()
  @IsIn(SUPPLIER_PAYOUT_OUTCOMES)
  outcome?: string;

  @IsOptional()
  @IsUUID()
  supplierCompanyId?: string;
}
