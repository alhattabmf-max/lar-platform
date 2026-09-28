/**
 * Wire enums — the string unions the API and the web app share.
 *
 * These deliberately DUPLICATE the value sets of the Prisma enums rather
 * than importing them: importing `@prisma/client` here would couple the
 * web app to the database client (see docs/PHASE_8_IMPLEMENTATION_PLAN.md
 * §4). The duplication is not left to trust — a contract test inside
 * apps/api imports both the Prisma enum and the union below and asserts
 * the two sets are exactly equal, so drift fails `typecheck`/CI rather
 * than reaching production.
 */

export const ACCOUNT_TYPES = ["TRADER", "SUPPLIER"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const COMPANY_VERIFICATION_STATUSES = [
  "PENDING_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
] as const;
export type CompanyVerificationStatus = (typeof COMPANY_VERIFICATION_STATUSES)[number];

export const USER_COMPANY_ROLES = ["OWNER"] as const;
export type UserCompanyRole = (typeof USER_COMPANY_ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const EMAIL_VERIFICATION_STATUSES = ["PENDING", "VERIFIED", "WAIVED"] as const;
export type EmailVerificationStatus = (typeof EMAIL_VERIFICATION_STATUSES)[number];

/**
 * HOW A LISTING SELLS.
 *
 * `GROUP` is the collective offer: a target quantity to reach, a share
 * every buyer takes, a window it runs for, and fulfilment that waits
 * until the target is reached. `DIRECT` is a fixed-price sale from
 * stock: the buyer names the quantity, and the order goes to
 * preparation the moment the payment succeeds.
 *
 * Re-declared here rather than imported from `@platform/domain` for the
 * same reason as every union in this file — the web app must not depend
 * on a server-side package — and kept honest the same way: a contract
 * test in apps/api asserts this set, the Prisma enum and the domain
 * constant are exactly equal.
 */
export const SALE_MODES = ["GROUP", "DIRECT"] as const;
export type SaleMode = (typeof SALE_MODES)[number];
