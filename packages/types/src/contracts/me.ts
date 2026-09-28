import type { CompanyProfileState } from "./company-completeness";
import type {
  AccountType,
  CompanyVerificationStatus,
  EmailVerificationStatus,
  UserCompanyRole,
  UserStatus,
} from "./enums";

/**
 * Minimum password length the API enforces.
 *
 * Shared so the client can refuse a too-short password before a round
 * trip, while the server stays the authority. A contract test in
 * apps/api asserts this matches the `@MinLength` on the auth DTOs — a
 * client that validated to a DIFFERENT rule would either reject
 * passwords the server accepts, or promise acceptance and then fail.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Contract for `GET /api/v1/me` — the web app's single source of truth
 * for who the caller is.
 *
 * The role is read from here on the server for every page request. It is
 * never persisted in localStorage, sessionStorage, or any client store,
 * and the session cookie is HttpOnly and never parsed by the frontend
 * (docs/PHASE_8_IMPLEMENTATION_PLAN.md §3).
 */
export interface MeResponse {
  userId: string;
  email: string;
  emailVerificationStatus: EmailVerificationStatus;
  role: UserCompanyRole;
  status: UserStatus;
  company: {
    id: string;
    crNumber: string;
    legalName: string;
    accountType: AccountType;
    verificationStatus: CompanyVerificationStatus;
  };

  /**
   * What the company's own record still needs, BY NAME.
   *
   * A DIRECT READING, NOT A STORED FLAG. Every item is answered by a
   * row that either exists or does not — a branch, a bank account, the
   * company's own details — so this is those facts under one name
   * rather than a second copy of them. A stored flag would be free to
   * drift from the rows it summarises.
   *
   * NAMES, NOT A BOOLEAN, because "incomplete" alone tells somebody
   * they cannot proceed without telling them what to do. The portal
   * lists each missing item with a link to the section that fixes it.
   *
   * NOTHING IS BLOCKED BY IT. A company with an incomplete record
   * still signs in, still reaches its dashboard, still changes language
   * and still signs out; what an incomplete record closes is the
   * commercial work that genuinely cannot be done without the data.
   */
  profile: CompanyProfileState;
}
