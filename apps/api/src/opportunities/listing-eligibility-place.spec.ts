import {
  BankAccountVerificationStatus,
  CompanyVerificationStatus,
  ProductApprovalStatus,
} from "@prisma/client";
import { evaluateLiveEligibility } from "@platform/opportunity-lifecycle";

/**
 * Whether a listing may be live, as far as WHERE IT SHIPS FROM is
 * concerned.
 *
 * THE RULE THIS FILE EXISTS FOR: switching cities off must not switch
 * the platform off. Every city on this platform was deactivated at one
 * point, and because the location check ran against the branch's city
 * unconditionally, not one supplier could publish anything — the
 * marketplace kept selling what was already live and nothing new could
 * join it. That is the failure these cases pin against ever returning.
 *
 * The region is what blocks now. The city blocks only if the branch
 * names one, because a branch that names none is a complete branch.
 */

const READY = {
  company: {
    verificationStatus: CompanyVerificationStatus.VERIFIED,
    activeBankAccount: {
      verificationStatus: BankAccountVerificationStatus.VERIFIED,
    },
    taxProfile: { id: "tax-1" },
    invoicingProfile: { id: "inv-1" },
  },
  product: {
    approvalStatus: ProductApprovalStatus.APPROVED,
    archivedAt: null,
  },
};

const at = (place: {
  isActive?: boolean;
  region?: { isActive: boolean };
  city?: { isActive: boolean } | null;
}) =>
  evaluateLiveEligibility({
    ...READY,
    fulfillmentLocation: {
      isActive: place.isActive ?? true,
      region: place.region ?? { isActive: true },
      city: place.city === undefined ? { isActive: true } : place.city,
    },
  });

describe("switching cities off does not switch the platform off", () => {
  it("publishes from a branch that names no city at all", () => {
    expect(at({ city: null })).toBeNull();
  });

  /**
   * THE EXACT SHAPE OF THE OUTAGE. Every city inactive, every region
   * active, branches recorded on their regions — the platform keeps
   * working.
   */
  it("publishes from a region-only branch while every city is switched off", () => {
    expect(at({ region: { isActive: true }, city: null })).toBeNull();
  });

  it("still refuses when the branch's own city is named and switched off", () => {
    // A listing that says it ships from a place the platform has
    // withdrawn is telling a buyer something that is no longer true.
    expect(at({ city: { isActive: false } })?.code).toBe(
      "LOCATION_CITY_INACTIVE",
    );
  });

  it("publishes when the named city is active", () => {
    expect(at({ city: { isActive: true } })).toBeNull();
  });
});

describe("the region is what blocks", () => {
  it("refuses a branch in a region the platform has switched off", () => {
    expect(at({ region: { isActive: false } })?.code).toBe(
      "LOCATION_REGION_INACTIVE",
    );
  });

  it("refuses it even when the branch names no city", () => {
    expect(at({ region: { isActive: false }, city: null })?.code).toBe(
      "LOCATION_REGION_INACTIVE",
    );
  });

  /**
   * ORDER MATTERS in a chain that returns the FIRST blocker. The
   * region is the reason a supplier can act on — "this region is
   * closed" — and reporting the city instead would send them to fix
   * something that is not what stopped them.
   */
  it("reports the region, not the city, when both are switched off", () => {
    expect(
      at({ region: { isActive: false }, city: { isActive: false } })?.code,
    ).toBe("LOCATION_REGION_INACTIVE");
  });

  it("reports the branch itself before either", () => {
    expect(
      at({
        isActive: false,
        region: { isActive: false },
        city: { isActive: false },
      })?.code,
    ).toBe("LOCATION_INACTIVE");
  });
});

describe("nothing else about the place was loosened", () => {
  it("still refuses an inactive branch", () => {
    expect(at({ isActive: false })?.code).toBe("LOCATION_INACTIVE");
  });

  it("still refuses an unverified supplier before looking at the place", () => {
    const blocker = evaluateLiveEligibility({
      ...READY,
      company: {
        ...READY.company,
        verificationStatus: CompanyVerificationStatus.PENDING_VERIFICATION,
      },
      fulfillmentLocation: {
        isActive: true,
        region: { isActive: true },
        city: null,
      },
    });
    expect(blocker?.code).toBe("SUPPLIER_NOT_VERIFIED");
  });

  it("still refuses a supplier who is not financially ready", () => {
    const blocker = evaluateLiveEligibility({
      ...READY,
      company: { ...READY.company, activeBankAccount: null },
      fulfillmentLocation: {
        isActive: true,
        region: { isActive: true },
        city: null,
      },
    });
    expect(blocker?.code).toBe("SUPPLIER_NOT_FINANCIALLY_READY");
  });
});
