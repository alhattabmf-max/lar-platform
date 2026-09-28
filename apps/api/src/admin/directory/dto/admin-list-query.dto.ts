import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  ADMIN_ACCOUNT_TYPES,
  BANK_ACCOUNT_VERIFICATION_STATUSES,
  COMPANY_OPERATIONAL_STATUSES,
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

  /**
   * Running or stopped, which both registers have.
   *
   * Separate from `verificationStatus` even though both read the same
   * column: an operator asking "which suppliers are suspended" is
   * asking a different question from "which are rejected", and folding
   * the two into one control would make the second unaskable.
   */
  @IsOptional()
  @IsIn(COMPANY_OPERATIONAL_STATUSES)
  operationalStatus?: string;

  /** Registered on or after this day, inclusive. `YYYY-MM-DD`. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  registeredFrom?: string;

  /** Registered on or before this day, inclusive. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  registeredTo?: string;
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

/**
 * The one parameter a chooser's source takes.
 *
 * NOT `AdminCompaniesQueryDto`. That one carries a page, a page size
 * and four filters, and answers a table; this answers a chooser.
 *
 * THE SEARCH IS THE PAGING. The chooser used to receive the register
 * and filter it in the browser, which is why this took no `q` — and
 * why it answered 5.8 MB. The server narrows now, and returns at most
 * fifty, so there is nothing left to page THROUGH: what is not in the
 * answer is reached by typing more, not by asking for page two.
 */
export class AdminCompanyNamesQueryDto {
  @IsOptional()
  @IsIn(ADMIN_ACCOUNT_TYPES)
  accountType?: string;

  /**
   * WHAT THE OPERATOR HAS TYPED. The chooser asks the server; the
   * server never hands over the register.
   *
   * Measured before this existed: at 70,000 companies the unpaged list
   * answered 5.8 MB in 994 ms, on three separate console pages, with no
   * caching — so opening the products page cost six megabytes to fill a
   * dropdown nobody had touched yet.
   */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  /**
   * How many to return. Bounded at 50 by the service whatever arrives
   * here, so the answer can never scale with the platform.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
