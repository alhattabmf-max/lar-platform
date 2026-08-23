import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import {
  ADMIN_ACCOUNT_TYPES,
  BANK_ACCOUNT_VERIFICATION_STATUSES,
  COMPANY_VERIFICATION_STATUSES_ADMIN,
  PRODUCT_APPROVAL_STATUSES,
} from "@platform/types";

/**
 * List controls shared by the admin directory reads.
 *
 * `pageSize` caps at 100 everywhere. An admin list is unbounded where a
 * supplier's is not, and an uncapped page size is a way to ask the
 * database for the whole table.
 *
 * Every filter is validated against the SHARED vocabulary rather than a
 * locally declared enum, so the API and the portal cannot drift on what
 * a valid filter is. Anything outside it is a 400 rather than a silent
 * fallback — a caller sending an unknown status has a bug, and quietly
 * returning everything would hide it.
 */
class BaseListQueryDto {
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

export class AdminCompaniesQueryDto extends BaseListQueryDto {
  @IsOptional()
  @IsIn(ADMIN_ACCOUNT_TYPES)
  accountType?: string;

  @IsOptional()
  @IsIn(COMPANY_VERIFICATION_STATUSES_ADMIN)
  verificationStatus?: string;
}

export class AdminProductsQueryDto extends BaseListQueryDto {
  @IsOptional()
  @IsIn(PRODUCT_APPROVAL_STATUSES)
  approvalStatus?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  /**
   * Tri-state on purpose: omitted means "either", which is not the same
   * as false. `archivedAt` is an independent lifecycle flag, so a list
   * that silently excluded archived products would hide them from the
   * one screen that can find them.
   */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  archived?: boolean;
}

export class AdminBankAccountsQueryDto extends BaseListQueryDto {
  @IsOptional()
  @IsIn(BANK_ACCOUNT_VERIFICATION_STATUSES)
  verificationStatus?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;
}
