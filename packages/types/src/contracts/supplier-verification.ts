import type { CompanyVerificationStatus } from "./enums";

/**
 * WHERE A SUPPLIER STANDS, decided in one place.
 *
 * SIX STATES OUT OF TWO FACTS. The company's own status says whether it
 * may trade; the newest request says what is happening with the review.
 * Neither alone could tell a supplier which of six situations they were
 * in — `PENDING_VERIFICATION` meant "just registered", "finished but not
 * sent" and "sent, waiting" all at once, so the portal had nothing to
 * show and the supplier had nothing to do.
 *
 * ONE FUNCTION, THREE READERS: the API decides it, the portal renders
 * it, and the submit endpoint refuses on it. Three answers to one
 * question is how a screen comes to offer a button the server rejects.
 *
 * NOTHING HERE IS STORED. Every value is derived from rows that exist
 * or do not, so the badge, the button and the guard cannot drift apart.
 */

export const SUPPLIER_VERIFICATION_REQUEST_STATUSES = [
  "UNDER_REVIEW",
  "RETURNED_FOR_COMPLETION",
  "APPROVED",
  "REJECTED",
] as const;

export type SupplierVerificationRequestStatus =
  (typeof SUPPLIER_VERIFICATION_REQUEST_STATUSES)[number];

export const SUPPLIER_VERIFICATION_STATES = [
  /** Required data is still missing. */
  "INCOMPLETE",
  /** Everything is there and nothing has been sent yet. */
  "READY_TO_SUBMIT",
  /** Sent. The data under review is locked. */
  "UNDER_REVIEW",
  /** Sent back with a reason. Editable again, and resubmittable. */
  "NEEDS_COMPLETION",
  /** Approved. The supplier may trade. */
  "VERIFIED",
  /** Refused, with a reason. Terminal for the supplier. */
  "REJECTED",
] as const;

export type SupplierVerificationState =
  (typeof SUPPLIER_VERIFICATION_STATES)[number];

/** The newest request a company has, if it has ever submitted one. */
export interface LatestVerificationRequest {
  id: string;
  status: SupplierVerificationRequestStatus;
  submittedAt: string;
  decidedAt: string | null;
  /** Shown to the supplier verbatim. Present on a return and a rejection. */
  decisionReason: string | null;
}

export interface SupplierVerificationView {
  state: SupplierVerificationState;
  /** The admin's words, when there are any to show. */
  reason: string | null;
  /** Whether «إرسال طلب التوثيق» is an action the supplier may take. */
  canSubmit: boolean;
  /**
   * Whether the data under review is closed to edits.
   *
   * TRUE ONLY WHILE A REQUEST IS OPEN. Editing a branch or a bank
   * account halfway through a review would mean an administrator
   * approving a record that has since changed.
   */
  dataLocked: boolean;
  latestRequest: LatestVerificationRequest | null;
}

/**
 * The state, from the company's status and its newest request.
 *
 * THE ORDER OF THESE BRANCHES IS THE DECISION. A supplier who was sent
 * back AND is still missing something sees «يتطلب استكمالًا» with the
 * administrator's reason, not a bare «غير مكتمل» — the reason is the
 * more useful of the two, and losing it would leave them guessing at
 * what a human already told them.
 */
export function supplierVerificationView(input: {
  companyStatus: CompanyVerificationStatus;
  latestRequest: LatestVerificationRequest | null;
  /** From `requirementsFor` — the same criterion the portal badges. */
  profileComplete: boolean;
}): SupplierVerificationView {
  const { companyStatus, latestRequest, profileComplete } = input;
  const base = { reason: null as string | null, latestRequest };

  // APPROVAL IS THE ONLY THING THAT SETS THIS, and it is the only thing
  // that opens a supplier's commercial work.
  if (companyStatus === "VERIFIED") {
    return { ...base, state: "VERIFIED", canSubmit: false, dataLocked: false };
  }

  // TERMINAL FOR THE SUPPLIER. Re-opening a refused application is an
  // administrator's decision, not a button on the supplier's screen.
  if (companyStatus === "REJECTED") {
    return {
      ...base,
      state: "REJECTED",
      reason: latestRequest?.decisionReason ?? null,
      canSubmit: false,
      dataLocked: false,
    };
  }

  // A SUSPENDED COMPANY never reaches this: suspension deactivates its
  // users, so nobody signs in to be told anything. It is handled here
  // anyway rather than falling through to "ready to submit", which
  // would offer an action that cannot succeed.
  if (companyStatus === "SUSPENDED") {
    return { ...base, state: "INCOMPLETE", canSubmit: false, dataLocked: true };
  }

  if (latestRequest?.status === "UNDER_REVIEW") {
    return {
      ...base,
      state: "UNDER_REVIEW",
      canSubmit: false,
      dataLocked: true,
    };
  }

  if (latestRequest?.status === "RETURNED_FOR_COMPLETION") {
    return {
      ...base,
      state: "NEEDS_COMPLETION",
      reason: latestRequest.decisionReason,
      // Sending it back again is exactly what a return is for — once
      // whatever was missing is there.
      canSubmit: profileComplete,
      dataLocked: false,
    };
  }

  if (profileComplete) {
    return {
      ...base,
      state: "READY_TO_SUBMIT",
      canSubmit: true,
      dataLocked: false,
    };
  }

  return { ...base, state: "INCOMPLETE", canSubmit: false, dataLocked: false };
}

/**
 * WHAT A SUPPLIER CANNOT CHANGE WITHOUT BEING VERIFIED AGAIN.
 *
 * «في كل الحالات، أي تعديل لازم يكون فيه إعادة إرسال توثيق… أفضّل (ب)
 *  لأنه يعطيه يعدّل شغلات ما تحتاج توثيق.»
 *
 * THE LINE IS ONE QUESTION: does a BUYER, an INVOICE or a PAYOUT rely
 * on this value? Everything on this list does; everything a supplier
 * may change freely does not.
 *
 *   BANK_ACCOUNT    where the money goes. The most consequential
 *                   change on the platform, and the reason the whole
 *                   rule exists.
 *   TAX_PROFILE     the VAT number printed on a tax invoice. A wrong
 *                   one makes the document defective in law.
 *   INVOICING_NAME  who the invoice is addressed to.
 *   BRANCH_ADDED    a place goods may now be sold and shipped from,
 *                   which nobody reviewed.
 *   BRANCH_MOVED    the same, for a branch whose region or city
 *                   changed: the region decides listing eligibility.
 *
 * WHAT IS DELIBERATELY ABSENT, and why:
 *
 *   - the telephone numbers, the contacts, a branch's contact name,
 *     its short address and its map link. A wrong telephone costs a
 *     missed call; a wrong IBAN costs the money. A rule that weighed
 *     both the same would not protect the second — it would fill the
 *     review queue with corrections until approving became a reflex,
 *     and the one change that mattered would pass in the noise.
 *   - the EMAIL, which carries its own re-verification: changing it
 *     marks it unverified and sends a fresh confirmation. Putting it
 *     here would be a second lock on a door that already has one.
 *   - the LEGAL NAME and the COMMERCIAL REGISTRATION, which a supplier
 *     cannot change at all — «الاسم النظامي ورقم السجل التجاري
 *     يعدّلهما فريق المنصة». The registration is additionally refused
 *     on a verified company by the server, because it is the number
 *     the verification was issued against.
 *
 * THE SERVER DECIDES, NEVER THE SCREEN. This list is read on the write
 * path itself: a client that posted straight at the endpoint would
 * change its bank account and stay verified if the rule lived in a
 * form.
 */
export const SUPPLIER_REVERIFICATION_TRIGGERS = [
  "BANK_ACCOUNT",
  "TAX_PROFILE",
  "INVOICING_NAME",
  "BRANCH_ADDED",
  "BRANCH_MOVED",
] as const;

export type SupplierReverificationTrigger =
  (typeof SUPPLIER_REVERIFICATION_TRIGGERS)[number];
