import type { AccountType } from "./enums";

/**
 * WHAT A COMPANY MUST HAVE BEFORE IT CAN TRADE — defined once.
 *
 * ONE SOURCE, THREE READERS. The API decides whether a company is
 * complete, the portal shows a badge beside «بيانات المنشأة» and a
 * banner on the dashboard, and the supplier's verification request
 * refuses to be sent while anything is missing. Three answers to one
 * question is how a portal comes to say "incomplete" beside a section
 * whose own page says everything is filled in.
 *
 * IT IS A LIST OF NAMES, NOT A BOOLEAN. "Incomplete" on its own tells
 * somebody they cannot proceed without telling them what to do; the
 * missing items are carried by name so the screen can link to each.
 *
 * THE TWO KINDS OF ACCOUNT DIFFER BY TWO ITEMS, and both are about
 * being PAID. A buyer pays; a supplier is paid, so a supplier has to
 * say which account the money goes to and who the commission document
 * is addressed to. Nothing else about the two lists differs, and the
 * difference is stated here rather than in each screen.
 *
 * BILLING IDENTITY IS ASKED FOR BEFORE APPROVAL, not after. It is part
 * of the record an administrator reviews — a company cannot be
 * approved as a supplier while nobody knows who its documents name or
 * whether it charges VAT — and asking for it afterwards made the
 * review incomplete and the supplier wait for an approval that was
 * waiting for them.
 */

export const COMPANY_REQUIREMENTS = [
  "companyDetails",
  "mainBranch",
  "bankAccount",
  "billingIdentity",
] as const;

export type CompanyRequirement = (typeof COMPANY_REQUIREMENTS)[number];

/**
 * What THIS kind of account has to provide.
 *
 * A buyer is never asked for a bank account: nothing is ever paid out
 * to one, so requiring it would be a form standing between a company
 * and a purchase for no reason anybody could give.
 */
export function requirementsFor(
  accountType: AccountType,
): readonly CompanyRequirement[] {
  return accountType === "SUPPLIER"
    ? ([
        "companyDetails",
        "mainBranch",
        "bankAccount",
        "billingIdentity",
      ] as const)
    : (["companyDetails", "mainBranch"] as const);
}

/** What the company actually has, as facts rather than as a verdict. */
export interface CompanyProfileFacts {
  /** Legal name, CR number and a contact number all present. */
  hasCompanyDetails: boolean;
  /** At least one active branch. */
  hasMainBranch: boolean;
  /** At least one bank account on file. Always false for a buyer. */
  hasBankAccount: boolean;
  /**
   * A billing name, and a VAT answer that is complete.
   *
   * ONE FACT FOR BOTH, because they are one card and one decision: a
   * supplier that has named its billing identity but left the VAT
   * question unanswered has not finished, and splitting them would put
   * half an answer in the "done" column. Always false for a buyer.
   */
  hasBillingIdentity: boolean;
}

/**
 * The requirements this company has not met yet, in the approved order.
 *
 * ORDERED, because the banner lists them and a list that reshuffles
 * itself between two loads is a list nobody can act on twice.
 */
export function missingRequirements(
  accountType: AccountType,
  facts: CompanyProfileFacts,
): CompanyRequirement[] {
  const met: Record<CompanyRequirement, boolean> = {
    companyDetails: facts.hasCompanyDetails,
    mainBranch: facts.hasMainBranch,
    bankAccount: facts.hasBankAccount,
    billingIdentity: facts.hasBillingIdentity,
  };

  return requirementsFor(accountType).filter(
    (requirement) => !met[requirement],
  );
}

/**
 * The state of a company's own record, as `GET /me` reports it.
 *
 * `complete` is derived from `missing` rather than stored beside it, so
 * the two cannot disagree — a flag and a list that are written
 * separately drift the first time one of them is forgotten.
 */
export interface CompanyProfileState {
  complete: boolean;
  missing: CompanyRequirement[];
}

export function profileState(
  accountType: AccountType,
  facts: CompanyProfileFacts,
): CompanyProfileState {
  const missing = missingRequirements(accountType, facts);
  return { complete: missing.length === 0, missing };
}
