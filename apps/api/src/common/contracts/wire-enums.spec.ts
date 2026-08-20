import {
  AccountType as PrismaAccountType,
  CompanyVerificationStatus as PrismaCompanyVerificationStatus,
  EmailVerificationStatus as PrismaEmailVerificationStatus,
  UserCompanyRole as PrismaUserCompanyRole,
  UserStatus as PrismaUserStatus,
} from "@prisma/client";
import {
  ACCOUNT_TYPES,
  COMPANY_VERIFICATION_STATUSES,
  EMAIL_VERIFICATION_STATUSES,
  USER_COMPANY_ROLES,
  USER_STATUSES,
} from "@platform/types";

/**
 * Contract tests for docs/PHASE_8_IMPLEMENTATION_PLAN.md §4.
 *
 * @platform/types deliberately re-declares these value sets as string
 * unions instead of importing @prisma/client, so the web app never
 * depends on the database client. That duplication is only safe if drift
 * is impossible — this file is what makes it impossible.
 *
 * It lives in apps/api, which is the only side allowed to see both.
 * Adding a value to a Prisma enum without adding it to the shared union
 * (or vice versa) fails here, in CI, instead of shipping a frontend that
 * silently mishandles the new value.
 */

function prismaValues(enumObject: Record<string, string>): string[] {
  return Object.values(enumObject).sort();
}

describe("shared wire enums match the Prisma enums exactly", () => {
  it.each([
    ["AccountType", prismaValues(PrismaAccountType), [...ACCOUNT_TYPES]],
    [
      "CompanyVerificationStatus",
      prismaValues(PrismaCompanyVerificationStatus),
      [...COMPANY_VERIFICATION_STATUSES],
    ],
    ["UserCompanyRole", prismaValues(PrismaUserCompanyRole), [...USER_COMPANY_ROLES]],
    ["UserStatus", prismaValues(PrismaUserStatus), [...USER_STATUSES]],
    [
      "EmailVerificationStatus",
      prismaValues(PrismaEmailVerificationStatus),
      [...EMAIL_VERIFICATION_STATUSES],
    ],
  ])("%s", (_name, prisma, shared) => {
    // Exact set equality in both directions — not "shared is a subset".
    expect([...shared].sort()).toEqual(prisma);
  });
});
