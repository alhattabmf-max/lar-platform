import { Injectable } from "@nestjs/common";
import { BankAccountVerificationStatus } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

export interface FinancialReadiness {
  isReady: boolean;
  hasVerifiedBankAccount: boolean;
  hasTaxProfile: boolean;
  hasInvoicingProfile: boolean;
}

/**
 * FUTURE CONTRACT NOTE (documentation only — nothing below is
 * implemented in Phase 5, and no Settlement/Payout code exists yet):
 *
 * When Settlement/Payout processing is eventually built, each
 * settlement record MUST capture a reference to the SPECIFIC
 * SupplierBankAccount row (its id) that was active at the moment the
 * settlement was created/eligible — a snapshot reference, exactly like
 * ProductApprovalSnapshot's relationship to Product. It must NEVER
 * resolve the payout destination by dereferencing the live, mutable
 * `companies.active_bank_account_id` pointer at payout time, because
 * that pointer can change (a new bank account can be submitted and
 * approved) between when a settlement became eligible and when it is
 * actually paid out. Resolving historically would silently send money
 * to a bank account the supplier only added later — the exact failure
 * mode `payout_hold_until` and the SUPERSEDED/append-only history in
 * this phase exist to prevent.
 */
@Injectable()
export class FinancialReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deliberately does NOT consider `payout_hold_until` — a supplier
   * mid-hold is still "financially ready" (can be listed as eligible
   * to prepare Opportunities in Phase 6). The hold affects
   * payout/settlement eligibility only, once that system exists.
   */
  async check(companyId: string): Promise<FinancialReadiness> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { activeBankAccount: true, taxProfile: true, invoicingProfile: true },
    });

    const hasVerifiedBankAccount =
      company.activeBankAccount?.verificationStatus === BankAccountVerificationStatus.VERIFIED;
    const hasTaxProfile = company.taxProfile !== null;
    const hasInvoicingProfile = company.invoicingProfile !== null;

    return {
      isReady: hasVerifiedBankAccount && hasTaxProfile && hasInvoicingProfile,
      hasVerifiedBankAccount,
      hasTaxProfile,
      hasInvoicingProfile,
    };
  }
}
