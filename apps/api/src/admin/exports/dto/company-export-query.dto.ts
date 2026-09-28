import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";
import {
  ADMIN_ACCOUNT_TYPES,
  COMPANY_OPERATIONAL_STATUSES,
  COMPANY_VERIFICATION_STATUSES_ADMIN,
} from "@platform/types";
import { ExportLabelsDto } from "./export-labels.dto";

/**
 * The companies export's query, as ONE class.
 *
 * WHY NOT TWO `@Query()` PARAMETERS. Nest hands the whole query object
 * to each decorated parameter and validates it against that parameter's
 * class independently — and this application runs `ValidationPipe` with
 * `forbidNonWhitelisted: true`. So a route declaring both the filter DTO
 * and the label DTO would have each of them reject the other's
 * parameters, and every export would 400 before the handler ran. The
 * two are merged here instead, which is also the only place a reader
 * can see the full set of what this route accepts.
 *
 * The filters repeat `AdminCompaniesQueryDto`'s rules rather than
 * extending it, because that class also carries `page` and `pageSize` —
 * paging controls an export has no use for, and accepting them would
 * invite the belief that an export is paginated.
 */
export class CompanyExportQueryDto extends ExportLabelsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  /** Which tab asked. This is what keeps the two registers apart. */
  @IsOptional()
  @IsIn(ADMIN_ACCOUNT_TYPES)
  accountType?: string;

  @IsOptional()
  @IsIn(COMPANY_VERIFICATION_STATUSES_ADMIN)
  verificationStatus?: string;

  @IsOptional()
  @IsIn(COMPANY_OPERATIONAL_STATUSES)
  operationalStatus?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  registeredFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  registeredTo?: string;
}
