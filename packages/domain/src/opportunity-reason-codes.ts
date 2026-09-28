/**
 * Closed set of machine-readable reasons an Opportunity can land in
 * ACTION_REQUIRED. Never expose a raw exception message to the
 * supplier or in any stored field — only one of these codes, plus a
 * short, safe, pre-written detail string (see REASON_DETAILS below).
 */
export const OPPORTUNITY_REASON_CODES = {
  SUPPLIER_NOT_VERIFIED: "SUPPLIER_NOT_VERIFIED",
  PRODUCT_NOT_APPROVED: "PRODUCT_NOT_APPROVED",
  PRODUCT_ARCHIVED: "PRODUCT_ARCHIVED",
  LOCATION_INACTIVE: "LOCATION_INACTIVE",
  LOCATION_CITY_INACTIVE: "LOCATION_CITY_INACTIVE",
  LOCATION_REGION_INACTIVE: "LOCATION_REGION_INACTIVE",
  SUPPLIER_NOT_FINANCIALLY_READY: "SUPPLIER_NOT_FINANCIALLY_READY",
  TAX_RATE_NOT_CONFIGURED: "TAX_RATE_NOT_CONFIGURED",
  PURCHASE_QUANTITY_NOT_COMPATIBLE: "PURCHASE_QUANTITY_NOT_COMPATIBLE",
  PRODUCT_SUSPENDED: "PRODUCT_SUSPENDED",
  PRODUCT_CLOSED: "PRODUCT_CLOSED",
} as const;

export type OpportunityReasonCode =
  (typeof OPPORTUNITY_REASON_CODES)[keyof typeof OPPORTUNITY_REASON_CODES];

/** Safe, pre-written detail text — never derived from a raw exception message. */
export const OPPORTUNITY_REASON_DETAILS: Record<OpportunityReasonCode, string> = {
  SUPPLIER_NOT_VERIFIED: "Your company is no longer a verified supplier.",
  PRODUCT_NOT_APPROVED: "The linked product is no longer in an approved state.",
  PRODUCT_ARCHIVED: "The linked product has been archived.",
  LOCATION_INACTIVE: "The fulfillment location is no longer active.",
  // KEPT, THOUGH IT IS NO LONGER RAISED for a branch that names no
  // city. Stored on listings blocked before the region became the
  // operational unit, and read back on every one of them — removing
  // the code would leave those rows naming a reason nothing can
  // translate. It is still raised when a branch DOES name a city and
  // that city has been switched off.
  LOCATION_CITY_INACTIVE: "The fulfillment location's city is no longer active.",
  LOCATION_REGION_INACTIVE: "The fulfillment location's region is no longer active.",
  SUPPLIER_NOT_FINANCIALLY_READY: "Your company's financial readiness is no longer complete.",
  TAX_RATE_NOT_CONFIGURED: "Tax configuration required to publish is not currently available.",
  PURCHASE_QUANTITY_NOT_COMPATIBLE: "The target quantity cannot be evenly split into whole shares under the current policy.",
  PRODUCT_SUSPENDED: "This opportunity's product is temporarily suspended pending an administrative review.",
  PRODUCT_CLOSED: "This opportunity's product has been permanently closed.",
};
