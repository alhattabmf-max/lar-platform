import { Module } from "@nestjs/common";
import { AdminCompanyController } from "./admin-company.controller";
import { CompanyDetailService } from "./company-detail.service";
import { CompanyControlService } from "./company-control.service";
import { CompanyDeletionEligibilityService } from "./company-deletion-eligibility.service";
import { CompanyImportService } from "./company-import.service";
import { CompanyWorkbookService } from "./company-workbook.service";
import { AdminSessionModule } from "../admin-auth/admin-session.module";
import { AuthModule } from "../../auth/auth.module";
import { VerificationModule } from "../../verification/verification.module";
import { AdminExportService } from "../exports/admin-export.service";
import { CompanyBranchService } from "./company-branch.service";

/**
 * Administrative control over companies.
 *
 * It imports `AuthModule` for ONE reason: the password-reset link an
 * operator sends is minted by the flow a company user would start
 * themselves. Reaching for the existing service rather than writing a
 * second token path is what keeps expiry, single-use and delivery
 * identical for both.
 */
@Module({
  // VerificationModule: the detail page shows where a supplier's
  // request stands, read from the same place the supplier reads it.
  imports: [AdminSessionModule, AuthModule, VerificationModule],
  controllers: [AdminCompanyController],
  providers: [
    CompanyDetailService,
    CompanyControlService,
    CompanyDeletionEligibilityService,
    CompanyImportService,
    CompanyWorkbookService,
    AdminExportService,
    CompanyBranchService,
  ],
})
export class AdminCompanyModule {}
