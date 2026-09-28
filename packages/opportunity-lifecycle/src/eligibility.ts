import { BankAccountVerificationStatus, CompanyVerificationStatus, ProductApprovalStatus } from "@prisma/client";
import { OPPORTUNITY_REASON_CODES, OPPORTUNITY_REASON_DETAILS, type OpportunityReasonCode } from "@platform/domain";

export interface Blocker {
  code: OpportunityReasonCode;
  details: string;
}

export interface EligibilityInput {
  company: {
    verificationStatus: CompanyVerificationStatus;
    activeBankAccount: { verificationStatus: BankAccountVerificationStatus } | null;
    taxProfile: unknown;
    invoicingProfile: unknown;
  };
  product: { approvalStatus: ProductApprovalStatus; archivedAt: Date | null };
  fulfillmentLocation: {
    isActive: boolean;
    region: { isActive: boolean };
    /** Null when the branch names no city, which is allowed. */
    city: { isActive: boolean } | null;
  };
}

/**
 * Every check here is deliberately re-verified LIVE at the moment it
 * matters (publish, or the worker's SCHEDULED finalization) — none of
 * it is cached/assumed from an earlier point in time, since any of
 * these facts (supplier verification, product approval, location/region
 * activity, financial readiness) can change after an opportunity was
 * first created or scheduled.
 *
 * THE REGION IS THE LOCATION CHECK. A branch is recorded against a
 * region, and the city beneath it is optional — so a branch with no
 * city passes, and switching every city off no longer stops the
 * platform from publishing anything. A city that IS named still has to
 * be active.
 *
 * Deliberately does NOT check tax rate availability — that check only
 * matters at the moment a NEW Tax Snapshot is being computed
 * (exclusively OpportunitiesService.publish()'s job), never during
 * the worker's SCHEDULED->ACTIVE finalization, where the Tax Snapshot
 * was already computed and frozen at publish time and is guaranteed
 * non-null by the opportunities_tax_snapshot_consistency DB
 * constraint for any row past DRAFT.
 */
export function evaluateLiveEligibility(input: EligibilityInput): Blocker | null {
  if (input.company.verificationStatus !== CompanyVerificationStatus.VERIFIED) {
    return {
      code: OPPORTUNITY_REASON_CODES.SUPPLIER_NOT_VERIFIED,
      details: OPPORTUNITY_REASON_DETAILS.SUPPLIER_NOT_VERIFIED,
    };
  }
  if (input.product.archivedAt) {
    return {
      code: OPPORTUNITY_REASON_CODES.PRODUCT_ARCHIVED,
      details: OPPORTUNITY_REASON_DETAILS.PRODUCT_ARCHIVED,
    };
  }
  if (input.product.approvalStatus === ProductApprovalStatus.SUSPENDED) {
    return {
      code: OPPORTUNITY_REASON_CODES.PRODUCT_SUSPENDED,
      details: OPPORTUNITY_REASON_DETAILS.PRODUCT_SUSPENDED,
    };
  }
  if (input.product.approvalStatus === ProductApprovalStatus.CLOSED) {
    return {
      code: OPPORTUNITY_REASON_CODES.PRODUCT_CLOSED,
      details: OPPORTUNITY_REASON_DETAILS.PRODUCT_CLOSED,
    };
  }
  if (input.product.approvalStatus !== ProductApprovalStatus.APPROVED) {
    return {
      code: OPPORTUNITY_REASON_CODES.PRODUCT_NOT_APPROVED,
      details: OPPORTUNITY_REASON_DETAILS.PRODUCT_NOT_APPROVED,
    };
  }
  if (!input.fulfillmentLocation.isActive) {
    return {
      code: OPPORTUNITY_REASON_CODES.LOCATION_INACTIVE,
      details: OPPORTUNITY_REASON_DETAILS.LOCATION_INACTIVE,
    };
  }
  /**
   * THE REGION IS WHAT BLOCKS. A branch is recorded against a region,
   * and switching a region off is how the platform stops it being used
   * for new business — so a listing shipping from one cannot stay live.
   */
  if (!input.fulfillmentLocation.region.isActive) {
    return {
      code: OPPORTUNITY_REASON_CODES.LOCATION_REGION_INACTIVE,
      details: OPPORTUNITY_REASON_DETAILS.LOCATION_REGION_INACTIVE,
    };
  }
  /**
   * THE CITY BLOCKS ONLY IF THERE IS ONE. A branch may name no city at
   * all, and that is a complete branch — this check used to run
   * unconditionally, which is why switching every city off stopped
   * every supplier on the platform from publishing anything.
   *
   * When a branch DOES name a city, that city still has to be active:
   * a listing that says it ships from a place the platform has
   * withdrawn is telling a buyer something that is no longer true.
   */
  if (input.fulfillmentLocation.city !== null && !input.fulfillmentLocation.city.isActive) {
    return {
      code: OPPORTUNITY_REASON_CODES.LOCATION_CITY_INACTIVE,
      details: OPPORTUNITY_REASON_DETAILS.LOCATION_CITY_INACTIVE,
    };
  }
  const financiallyReady =
    input.company.activeBankAccount?.verificationStatus === BankAccountVerificationStatus.VERIFIED &&
    input.company.taxProfile !== null &&
    input.company.invoicingProfile !== null;
  if (!financiallyReady) {
    return {
      code: OPPORTUNITY_REASON_CODES.SUPPLIER_NOT_FINANCIALLY_READY,
      details: OPPORTUNITY_REASON_DETAILS.SUPPLIER_NOT_FINANCIALLY_READY,
    };
  }
  return null;
}
