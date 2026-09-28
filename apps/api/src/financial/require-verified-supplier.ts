import { AccountType, CompanyVerificationStatus, type Company } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

/**
 * A SUPPLIER ACCOUNT, and separately, an APPROVED one.
 *
 * These were one check. Three things have crossed to the near side of
 * the line since, each for the same reason and each deliberately: the
 * BANK ACCOUNT first, then the BILLING NAME and the TAX NUMBER.
 *
 *   The approval decision REVIEWS them rather than following them. A
 *   supplier assembles its record — company details, the main branch,
 *   the bank account, who its documents are addressed to and whether
 *   it is registered for VAT — and submits the lot for one review.
 *   Requiring approval first made that impossible in both directions:
 *   the administrator was asked to approve a company whose payout and
 *   billing details it could not see, and the supplier was told to
 *   wait for an approval that was waiting for them.
 *
 * WHAT APPROVAL STILL GATES IS UNCHANGED — publishing a listing,
 * taking an order, being paid. Moving these three changed WHEN the
 * data may be entered, never what approval means or what it grants.
 *
 * WHAT IS STILL REFUSED is a buyer, and a company that is not a
 * supplier at all. Money is only ever paid out to a supplier, and a
 * commission document is only ever addressed to one.
 */
/**
 * A supplier account, approved or not.
 *
 * For the data a supplier assembles BEFORE asking to be approved — the
 * bank account it wants to be paid into. It is reviewed as part of that
 * request, so demanding approval first is a circle.
 */
export async function requireSupplierCompany(
  prisma: PrismaService,
  companyId: string
): Promise<Company> {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  if (company.accountType !== AccountType.SUPPLIER) {
    throw new BusinessException(403, ERROR_CODES.FORBIDDEN, "Only supplier accounts have financial readiness data");
  }

  return company;
}

export async function requireVerifiedSupplierCompany(
  prisma: PrismaService,
  companyId: string,
): Promise<Company> {
  const company = await requireSupplierCompany(prisma, companyId);

  if (company.verificationStatus !== CompanyVerificationStatus.VERIFIED) {
    throw new BusinessException(
      403,
      ERROR_CODES.SUPPLIER_NOT_VERIFIED,
      "Your company must be a verified supplier before completing financial readiness"
    );
  }

  return company;
}
