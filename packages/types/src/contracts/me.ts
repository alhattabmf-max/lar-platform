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
}
