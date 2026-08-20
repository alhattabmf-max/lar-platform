import type {
  AccountType,
  CompanyVerificationStatus,
  EmailVerificationStatus,
  UserCompanyRole,
  UserStatus,
} from "./enums";

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
