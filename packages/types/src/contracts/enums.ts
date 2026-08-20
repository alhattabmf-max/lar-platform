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
