import {
  AccountType as PrismaAccountType,
  SaleMode as PrismaSaleMode,
  CompanyVerificationStatus as PrismaCompanyVerificationStatus,
  EmailVerificationStatus as PrismaEmailVerificationStatus,
  UserCompanyRole as PrismaUserCompanyRole,
  UserStatus as PrismaUserStatus,
} from "@prisma/client";
import { SALE_MODES as DOMAIN_SALE_MODES } from "@platform/domain";
import {
  ACCOUNT_TYPES,
  SALE_MODES,
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
    ["SaleMode", prismaValues(PrismaSaleMode), [...SALE_MODES]],
  ])("%s", (_name, prisma, shared) => {
    // Exact set equality in both directions — not "shared is a subset".
    expect([...shared].sort()).toEqual(prisma);
  });

  /**
   * AND THE THIRD COPY TOO.
   *
   * `SaleMode` exists in three places for three reasons: Prisma because
   * it is a column, `@platform/types` because the web app may not
   * depend on the database client, and `@platform/domain` because the
   * availability arithmetic and the per-mode status table are domain
   * rules the API reasons with. Two of the three being equal would let
   * the third drift silently.
   */
  it("the domain copy agrees as well", () => {
    expect([...DOMAIN_SALE_MODES].sort()).toEqual(prismaValues(PrismaSaleMode));
  });
});
