import type { CompanyVerificationStatus } from "./enums";

/**
 * WHETHER A COMPANY IS ACTUALLY OPERATING.
 *
 * THIS USED TO BE "not suspended", and that was wrong in the one case
 * it mattered: a supplier that registered a minute ago, has submitted
 * nothing and can do nothing on the platform was labelled «نشطة». The
 * badge said the account was running while the account was waiting to
 * be let in.
 *
 * ACTIVE MEANS VERIFIED, and nothing else. A buyer reaches it at
 * registration, because a buyer is verified there and can trade
 * immediately. A supplier reaches it when — and only when — its
 * verification request is approved, which is the same moment it gains
 * every other ability approval carries. There is no separate
 * "activation" flag to fall out of step with it: one press verifies
 * and activates because they are the same fact.
 *
 * NOT_ACTIVE covers both of the ways a company can be short of that:
 * waiting to be reviewed, and refused. The badge names the difference
 * where it is useful — the verification status is shown beside it —
 * and does not pretend either one is running.
 */
export const COMPANY_OPERATIONAL_STATUSES = [
  "ACTIVE",
  "NOT_ACTIVE",
  "SUSPENDED",
] as const;

export type CompanyOperationalStatus =
  (typeof COMPANY_OPERATIONAL_STATUSES)[number];

export function companyOperationalStatus(
  verificationStatus: CompanyVerificationStatus
): CompanyOperationalStatus {
  if (verificationStatus === "SUSPENDED") return "SUSPENDED";
  if (verificationStatus === "VERIFIED") return "ACTIVE";
  return "NOT_ACTIVE";
}

/**
 * Which verification statuses an operational filter is asking for.
 *
 * THE FILTER AND THE BADGE FROM ONE PLACE. A list that filtered on one
 * definition while every row's badge was drawn from another would show
 * rows the filter says are active and the badge says are not.
 */
export function verificationStatusesFor(
  operational: CompanyOperationalStatus
): CompanyVerificationStatus[] {
  switch (operational) {
    case "ACTIVE":
      return ["VERIFIED"];
    case "SUSPENDED":
      return ["SUSPENDED"];
    case "NOT_ACTIVE":
      return ["PENDING_VERIFICATION", "REJECTED"];
  }
}
