import { AccountType, CompanyVerificationStatus, type Company } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

/**
 * Blueprint §7: bank/payout/invoicing/tax data entry happens strictly
 * AFTER a supplier is approved ("بعد اعتماد المورد") — unlike Phase 4
 * products, which deliberately allow a not-yet-verified supplier to
 * prep their catalog early. There is no "draft" concept here.
 */
export async function requireVerifiedSupplierCompany(
  prisma: PrismaService,
  companyId: string
): Promise<Company> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  if (company.accountType !== AccountType.SUPPLIER) {
    throw new BusinessException(403, ERROR_CODES.FORBIDDEN, "Only supplier accounts have financial readiness data");
  }
  if (company.verificationStatus !== CompanyVerificationStatus.VERIFIED) {
    throw new BusinessException(
      403,
      ERROR_CODES.SUPPLIER_NOT_VERIFIED,
      "Your company must be a verified supplier before completing financial readiness"
    );
  }

  return company;
}
