import type { AuditVisibleData } from "./audit-fields";
import type { MoneyString } from "./money";
import type { ReplacementObligationStatus } from "./order";
import type { SupplierVerificationView } from "./supplier-verification";
import type { AdminCompanyBankAccount } from "./admin-company-bank";
import type { ProductApprovalStatus, ProductMediaView } from "./product";

/**
 * Admin-facing contracts.
 *
 * BEING AN ADMIN DOES NOT ENTITLE YOU TO A SECRET. Every shape here is
 * closed, and the things it omits are omitted deliberately:
 *
 *   - no password hash, session id, login ticket, TOTP secret or
 *     recovery-code hash;
 *   - no IBAN beyond its last four characters, and never the ciphertext
 *     or the blind-index fingerprint;
 *   - no storage object key — images are addressed by delivery route;
 *   - no outbox payload, recipient address or subject;
 *   - no ledger posting or journal entry;
 *   - no raw `beforeData`/`afterData` and no `ipAddress`/`userAgent` on
 *     an audit entry, which is where request metadata and copied PII
 *     would leak. What an entry DOES carry of the values that changed is
 *     a closed allow-list of field names — see `AuditLogEntry` and
 *     `contracts/audit-fields.ts`.
 *
 * These are not filtered at render time. Each has a matching `select` on
 * the server that never reads the column, because not selecting is
 * stronger than not mapping.
 */

// ------------------------------------------------------------- session

export const ADMIN_USER_STATUSES = ["ACTIVE", "SUSPENDED", "DISABLED"] as const;
export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];

/**
 * `GET /admin/auth/me` — who the caller is.
 *
 * The admin portal's whole server-side guard rests on this. It is the
 * minimum that answers "is this a signed-in admin, and what may they
 * see" — an id, an email to greet them by, the status the guard checks,
 * and whether 2FA is enrolled so the portal can say so.
 *
 * `twoFactorEnabled` is a BOOLEAN derived from `twoFactorEnabledAt`. The
 * timestamp itself is not here and the secret certainly is not.
 */
export interface AdminMe {
  id: string;
  email: string;
  status: AdminUserStatus;
  twoFactorEnabled: boolean;
}

export const ADMIN_ME_KEYS = [
  "id",
  "email",
  "status",
  "twoFactorEnabled",
] as const satisfies readonly (keyof AdminMe)[];

/**
 * One administrator, as another administrator sees them.
 *
 * `recoveryCodesRemaining` is a COUNT of unconsumed codes — never the
 * codes, never their hashes. It exists because "this person has one code
 * left" is the moment to regenerate, and a count is the only safe way to
 * say it.
 */
export interface AdminUserItem {
  id: string;
  email: string;
  status: AdminUserStatus;
  twoFactorEnabled: boolean;
  recoveryCodesRemaining: number;
  createdAt: string;
  updatedAt: string;
}

export const ADMIN_USER_ITEM_KEYS = [
  "id",
  "email",
  "status",
  "twoFactorEnabled",
  "recoveryCodesRemaining",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof AdminUserItem)[];

/**
 * Freshly generated recovery codes, returned EXACTLY ONCE.
 *
 * The plaintext is never persisted — only SHA-256 hashes are stored — so
 * this response is the only time they exist anywhere readable. A UI must
 * say so plainly and must not offer to fetch them again, because nothing
 * can.
 */
export interface AdminRecoveryCodesIssued {
  codes: string[];
  /** How many were issued, so a UI can assert it rendered all of them. */
  count: number;
}

// --------------------------------------------------------- audit logs

export const AUDIT_ACTOR_TYPES = ["SYSTEM", "USER", "ADMIN"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/**
 * One audit entry — the nine safe fields, plus a NARROW view of what
 * changed.
 *
 * `beforeData` and `afterData` are still absent as such. They are
 * arbitrary JSON copies of rows, which means they carry whatever the row
 * carried: a billing name, an email, a masked IBAN, an admin's internal
 * note. Serving them whole was never the answer.
 *
 * WHAT IS HERE INSTEAD is `before` and `after`, each reduced to a CLOSED
 * ALLOW-LIST OF FIELD NAMES — status, activation, changing commercial
 * values, a category's parent and order — with scalars only and every
 * value bounded. `contracts/audit-fields.ts` holds the list, the rules
 * and, as important, the record of what was deliberately left off it.
 * A field nobody approved has no route here even in principle, because
 * the projection is driven by the list rather than by the payload.
 *
 * The screen could previously say a company's status changed but not
 * what it changed FROM, which meant reading the trail properly required
 * database access. This closes that without opening the payload.
 *
 * `ipAddress` and `userAgent` remain absent, unchanged: they are
 * request metadata about a person, retained for forensics, not for
 * routine reading. Reaching them is a database question with its own
 * authorisation, not a page in a portal.
 *
 * `reason` IS here. It is written deliberately by an administrator to
 * explain a decision, which is the opposite of incidental capture.
 */
export interface AuditLogEntry {
  id: string;
  actorType: AuditActorType;
  /** Null for SYSTEM actions, which have no actor. */
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  requestId: string;
  createdAt: string;
  /**
   * The allow-listed fields as they were, and as they became.
   *
   * Null when the entry carried no payload, or when nothing on the
   * allow-list was in it — which is the common case, and is a "no
   * detail" state rather than an error.
   */
  before: AuditVisibleData | null;
  after: AuditVisibleData | null;
}

export const AUDIT_LOG_ENTRY_KEYS = [
  "id",
  "actorType",
  "actorId",
  "action",
  "entityType",
  "entityId",
  "reason",
  "requestId",
  "createdAt",
  "before",
  "after",
] as const satisfies readonly (keyof AuditLogEntry)[];

// -------------------------------------------------------- outbox stats

export const OUTBOX_STATUSES = ["PENDING", "PROCESSING", "PUBLISHED", "FAILED"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/**
 * Relay health, as counts.
 *
 * NO PAYLOAD, no recipient address, no subject, no `lastError`. An
 * outbox payload carries the email address the message was addressed to;
 * a stats screen has no business holding one.
 *
 * `providerMode` is REQUIRED, not optional, and every consumer must show
 * it. While it is `mock` nothing is delivered anywhere, and a dashboard
 * of green counts that does not say so is a lie told in numbers.
 *
 * `PUBLISHED` means THE PROVIDER ACCEPTED THE REQUEST. It does not mean
 * anything arrived. The relay is at-least-once delivery with a stable
 * provider idempotency key — not exactly-once — and no count here can
 * report a delivery.
 */
export interface OutboxStats {
  /** e.g. "mock" or the configured provider's name. Always present. */
  providerMode: string;
  counts: Record<OutboxStatus, number>;
  /** Rows deferred for backoff and not yet eligible. */
  deferred: number;
  /** Rows currently leased by a worker. */
  leased: number;
  /** ISO 8601 of the most recent successful publish, or null. */
  lastPublishedAt: string | null;
  /**
   * ISO 8601 of the oldest PENDING row THE RELAY WILL PICK UP — the real
   * mail-backlog signal, scoped to the event types it actually handles.
   */
  oldestPendingAt: string | null;
  /**
   * ISO 8601 of the oldest PENDING row of ANY type, or null.
   *
   * Reported separately because `counts.PENDING` is unfiltered: without
   * it, a console showing twenty-one pending rows beside "no backlog"
   * appears to contradict itself, when in fact the two sentences were
   * measuring different sets. This one is the number that matches the
   * count; `oldestPendingAt` is the one that means mail is stalled.
   */
  oldestPendingAnyAt: string | null;
  total: number;
}

export const OUTBOX_STATS_KEYS = [
  "providerMode",
  "counts",
  "deferred",
  "leased",
  "lastPublishedAt",
  "oldestPendingAt",
  "total",
] as const satisfies readonly (keyof OutboxStats)[];

// ------------------------------------------------------------ companies

export const ADMIN_ACCOUNT_TYPES = ["TRADER", "SUPPLIER"] as const;

/**
 * Whether a company can operate, as distinct from whether it is
 * verified.
 *
 * DERIVED, NOT STORED. `companies` has one status column, and
 * `SUSPENDED` is the value in it that means "stopped" — every other
 * value means the company is running, verified or not. So a buyer, which
 * is never verified, still has an operational state, and this is the
 * vocabulary that names it without pretending a second column exists.
 */
// COMPANY_OPERATIONAL_STATUSES and CompanyOperationalStatus moved to
// ./company-operational-status, beside the function that derives
// them. "Not suspended" was not the same thing as "running", and
// keeping the list here — away from any rule about what it meant —
// is how the two drifted apart.

export const COMPANY_VERIFICATION_STATUSES_ADMIN = [
  "PENDING_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
] as const;

/**
 * One company in the admin directory.
 *
 * Carries the company's own identity and its counts — never a user's
 * password state, never a session, never a bank detail. The bank review
 * screens are their own surface with their own masking.
 */

/**
 * One company, as the control panel's detail screen reads it.
 *
 * NOTHING SENSITIVE IS IN THIS SHAPE, because nothing sensitive is
 * selected on the way here: no password hash, no token, no IBAN, no
 * storage key. `hasPassword` is the single fact derived from a hash —
 * whether an invited person has claimed their account — and it is a
 * boolean precisely so the hash itself never crosses.
 *
 * The heavy relations arrive as COUNTS. An operator on this screen asks
 * whether a company has fourteen orders; reading them belongs to the
 * screen that owns orders, with its own filters.
 */
export interface AdminCompanyUser {
  /**
   * The two numbers registration records.
   *
   * Present so the edit form can be FILLED with what is stored rather
   * than starting blank — a form that opens empty invites an operator
   * to retype a number that was already right.
   */
  primaryMobile1: string;
  primaryMobile2: string;
  id: string;
  email: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  emailVerificationStatus: string;
  /** False for an invited account nobody has claimed yet. */
  hasPassword: boolean;
  /** True when the COMPANY's suspension is what moved this user. */
  suspendedByCompany: boolean;
  createdAt: string;
}

export interface AdminCompanyContact {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  isActive: boolean;
}

/**
 * A way to reach the company, gathered from everywhere it is recorded.
 *
 * ONE FIELD ON SCREEN, several sources behind it. The owner's two
 * registration mobiles and every company contact's number are all
 * "how to reach this company", and showing them as separate cards asked
 * a reader to work out which one to ring. `source` is kept so the edit
 * form knows which record a change belongs to.
 */
export interface AdminCompanyPhone {
  value: string;
  source: "OWNER_PRIMARY" | "OWNER_SECONDARY" | "CONTACT";
  /** The contact row this came from, when it came from one. */
  contactId: string | null;
  /** The contact's name, so a list of numbers is not anonymous. */
  label: string | null;
}

export interface AdminCompanyLocation {
  id: string;
  name: string;
  shortAddress: string;
  /** WHERE THE BRANCH IS. Never null: every branch has a region. */
  regionId: string;
  /** The region's own name, already in the reader's language. */
  regionName: string;
  /** The optional refinement. Null when the branch names no city. */
  cityId: string | null;
  contactName: string;
  contactPhone: string;
  isDefault: boolean;
  /**
   * The city's own name, already in the reader's language. Null when
   * the branch names no city — never an empty string, which reads as a
   * name nobody entered.
   */
  cityName: string | null;
  /**
   * Where it is, as a link a browser can open.
   *
   * BUILT FROM THE STORED COORDINATES rather than kept as a pasted
   * URL: the platform already records latitude and longitude for every
   * branch, and a second column holding somebody's shortened link would
   * be a second answer to the same question — one that rots when the
   * shortener does.
   */
  mapUrl: string;
}

export interface AdminCompanyCounts {
  products: number;
  opportunities: number;
  ordersAsTrader: number;
  ordersAsSupplier: number;
  bankAccounts: number;
  productReports: number;
  checkoutSessions: number;
  policyAcceptances: number;
  /** Disputes raised on this company's orders, as the buyer. */
  disputes: number;
}

/**
 * The two money figures the activity strip shows.
 *
 * SUMS OF STORED COLUMNS, NOT RECALCULATIONS. `purchases` adds up
 * `master_orders.total_amount` where the company is the buyer, and
 * `supplierPayable` adds up `master_orders.supplier_payable_amount`
 * where it is the seller. Both columns are written once by the payment
 * flow that owns them; nothing here re-derives commission, tax, or any
 * other money rule.
 *
 * Carried as STRINGS, in minor-unit-safe decimal form, because a
 * 14,2 decimal does not survive a round trip through a JavaScript
 * number.
 */
export interface AdminCompanyTotals {
  purchases: string;
  supplierPayable: string;
}

export interface AdminCompanyActivity {
  id: string;
  action: string;
  actorType: string;
  /** Present only where the action required one. */
  reason: string | null;
  createdAt: string;

  /**
   * What the edit changed, when the action was one.
   *
   * REDACTED AT THE SOURCE: the service selects only the fields an
   * administrator may edit, so no password hash, token, two-factor
   * secret or storage key can reach this shape — there is no filter
   * here that could be forgotten.
   */
  before: Record<string, string> | null;
  after: Record<string, string> | null;
}

export interface AdminCompanyDetail {
  /** Every number recorded for this company, in one ordered list. */
  phones: AdminCompanyPhone[];
  /** The owner's address — the one the console writes to. */
  ownerEmail: string | null;
  id: string;
  crNumber: string;
  legalName: string;
  accountType: "TRADER" | "SUPPLIER";
  verificationStatus: (typeof COMPANY_VERIFICATION_STATUSES_ADMIN)[number];
  createdAt: string;
  updatedAt: string;
  users: AdminCompanyUser[];
  contacts: AdminCompanyContact[];
  locations: AdminCompanyLocation[];
  counts: AdminCompanyCounts;
  totals: AdminCompanyTotals;
  recentActivity: AdminCompanyActivity[];
  /**
   * Where this supplier's verification stands. Null for a buyer,
   * which is never verified.
   *
   * THE SAME VIEW THE SUPPLIER SEES, from the same function — so an
   * administrator and the company reading their own screen cannot be
   * shown two different accounts of the same request.
   */
  verification: SupplierVerificationView | null;
  /**
   * THE PAYOUT ACCOUNT, WHERE THE DECISION IS TAKEN.
   *
   * «الحسابات البنكية… المفروض إنها في بيانات المورّد» — the
   * console could approve a supplier's verification without ever
   * seeing the account that approval makes the payout account.
   * The evidence and the decision were on two different screens.
   *
   * `active` is the one money goes to today; `pending` is one
   * submitted and not yet approved. Both may be null, and both
   * may stand at once — a verified supplier that has asked to
   * change where it is paid.
   *
   * FOUR CHARACTERS OF THE IBAN, AND NOT ONE MORE. The number is
   * stored encrypted; neither its ciphertext nor its blind-index
   * fingerprint is selected by any query behind this shape, and
   * no HTTP path in the platform decrypts it. What an operator
   * checks against the evidence is the holder, the bank and the
   * last four — which is exactly what this carries.
   *
   * READ ONLY. Nothing financial is editable from the console:
   * an administrator who could rewrite an IBAN could redirect a
   * supplier's money, which is the most consequential write on
   * the platform and belongs to nobody but the supplier.
   */
  bankAccounts: {
    active: AdminCompanyBankAccount | null;
    pending: AdminCompanyBankAccount | null;
  };
}

/**
 * Which fields an administrator may change through the ordinary edit.
 *
 * ONE. `crNumber` is the identity a company signs in with and the thing
 * that was verified about it, so changing it is its own route with its
 * own proof. `accountType` is immutable by the schema's own rule, and
 * the verification status has approve, reject, suspend and reactivate.
 * Nothing financial or banking-related is editable here at all.
 */
/**
 * What the ordinary edit may change.
 *
 * THE REGISTRATION IS HERE BY DECISION. It was previously a separate
 * act behind a second factor; the console's owner moved it into the
 * ordinary edit without one, because in practice a registration is
 * corrected for the same reason a name is — it was typed wrong at
 * registration — and a code on that correction was stopping routine
 * work rather than preventing anything.
 *
 * WHAT STILL HOLDS: it must be unique, the change is written to the
 * audit trail with its before and after, and a company that is already
 * VERIFIED cannot have it rewritten silently — the server refuses,
 * because the number is what the verification was issued against.
 */
export const ADMIN_COMPANY_EDITABLE_FIELDS = [
  "legalName",
  "crNumber",
  "ownerEmail",
  "primaryMobile1",
  "primaryMobile2",
] as const;

/**
 * What an uploaded spreadsheet would do, before it does anything.
 *
 * REASONS ARE NAMES, not sentences: the screen translates each into the
 * operator's language, and a server-written phrase would arrive in one
 * language only.
 */
export interface CompanyImportRowError {
  /** The row number IN THE FILE, so it can be found and corrected. */
  rowNumber: number;
  reason: string;
  /** The cells as they were read, for the downloadable error report. */
  values: string[];
}

export interface CompanyImportPreview {
  /** Names the staged file for the commit that may follow. */
  importId: string;
  fileName: string;
  total: number;
  valid: number;
  rejected: number;
  duplicates: number;
  errors: CompanyImportRowError[];
}

export interface CompanyImportResult {
  created: number;
  skipped: number;
  /** How many invitations actually went out. */
  invited: number;
  errors: CompanyImportRowError[];
}

/**
 * Why a company cannot be removed, in a closed vocabulary.
 *
 * NAMES, NOT SENTENCES. The screen translates each of these into the
 * reader's language; a server-written phrase would arrive in one
 * language and could name a table.
 */
/**
 * WHAT KEEPS A COMPANY ON THE PLATFORM.
 *
 * THE FIRST SIX ARE UNFINISHED BUSINESS — work running, money moving,
 * a question still open. They are the rule.
 *
 * THE LAST TWO ARE NOT POLICY. An order points at the bank account and
 * the checkout session it came from, a payment attempt points at the
 * policy acceptance in force when it was taken, and a report points at
 * the product it names — every one ON DELETE RESTRICT. A company that
 * has traded cannot be removed without taking a financial record with
 * it. They are named so an operator reads a sentence instead of a
 * foreign key violation.
 *
 * WHAT IS DELIBERATELY ABSENT: a bank account, a branch, a tax or
 * invoicing profile, an accepted policy, an abandoned checkout, and a
 * product or opportunity carrying no obligation. None of those is a
 * reason to keep a company that owes nothing and is owed nothing, and
 * refusing on them made the removal useless in the one case it was
 * for — a company that registered and never traded.
 */
export const COMPANY_DELETION_BLOCKER_KINDS = [
  "ACTIVE_OR_FUNDED_PRODUCTS",
  "LIVE_ORDERS",
  "OPEN_DISPUTES",
  "AMOUNTS_DUE_OR_HELD",
  "INCOMPLETE_REFUNDS",
  "INCOMPLETE_SETTLEMENTS",
  "FINANCIAL_RECORDS",
  "PRODUCT_REPORTS",
] as const;

export type CompanyDeletionBlockerKind =
  (typeof COMPANY_DELETION_BLOCKER_KINDS)[number];

export interface CompanyDeletionBlocker {
  kind: CompanyDeletionBlockerKind;
  /** How many records of this kind hold the company here. */
  count: number;
}

export interface CompanyDeletionEligibility {
  allowed: boolean;
  /** Empty exactly when `allowed` is true. */
  blockers: CompanyDeletionBlocker[];
}

export interface AdminCompanyItem {
  id: string;
  legalName: string;
  crNumber: string;
  accountType: "TRADER" | "SUPPLIER";
  verificationStatus: (typeof COMPANY_VERIFICATION_STATUSES_ADMIN)[number];
  /** The owner's email — the address an operator would contact. */
  ownerEmail: string | null;
  userCount: number;
  createdAt: string;

  /**
   * The counts each tab's table shows, and only those.
   *
   * NULL MEANS NOT ASKED FOR, never zero. A buyer's row carries an
   * order count and a supplier's carries products and opportunities,
   * because those are the columns each table has; computing all three
   * for every row would be three aggregates a screen never renders.
   * A reader must distinguish "no orders" from "orders were not
   * counted", which is why these are nullable rather than defaulted.
   */
  orderCount: number | null;
  productCount: number | null;
  opportunityCount: number | null;
}

export const ADMIN_COMPANY_ITEM_KEYS = [
  "id",
  "legalName",
  "crNumber",
  "accountType",
  "verificationStatus",
  "ownerEmail",
  "userCount",
  "createdAt",
  "orderCount",
  "productCount",
  "opportunityCount",
] as const satisfies readonly (keyof AdminCompanyItem)[];

/**
 * How many companies of each kind exist, for the two tab headings.
 *
 * Counted with the SEARCH AND FILTERS APPLIED but without the account
 * type, so the numbers on the tabs describe what switching to that tab
 * would actually show.
 */
export interface AdminCompanyTabCounts {
  traders: number;
  suppliers: number;
}

// ------------------------------------------------------------- refunds

export const REFUND_OBLIGATION_STATUSES = [
  "PENDING_EXECUTION",
  "SENT",
  "COMPLETED",
  "FAILED",
] as const;

export type RefundObligationStatus = (typeof REFUND_OBLIGATION_STATUSES)[number];

export const REFUND_OBLIGATION_SOURCES = [
  "PAYMENT_EXCEPTION",
  "DISPUTE",
  /**
   * THE OFFER DID NOT REACH ITS TARGET.
   *
   * «في حالة لم يكتمل الهدف يتم الاسترداد تلقائي.»
   *
   * ITS OWN SOURCE, NOT PAYMENT_EXCEPTION: nothing went wrong with the
   * payment. The money was taken correctly and is being returned because
   * a condition the buyer bought under did not happen — and an operator
   * reading the refunds list has to be able to tell those two apart.
   */
  "OPPORTUNITY_UNFUNDED",
] as const;
export type RefundObligationSource = (typeof REFUND_OBLIGATION_SOURCES)[number];

/**
 * One refund obligation.
 *
 * Shaped from the real row, which is narrower than it first appears: a
 * refund hangs off a PAYMENT ATTEMPT, not an order, and reaches an order
 * only through the attempt's checkout session. `masterOrderId` is
 * resolved through that chain so an operator can navigate, and is null
 * when the chain does not reach one.
 *
 * There is no `completedAt` column — the row records `createdAt` and a
 * status, and when it finished is an attempt-level fact. Inventing the
 * field would mean inventing the timestamp.
 *
 * Money as decimal strings. No provider reference, no card detail, no
 * gateway response.
 */
export interface AdminRefundItem {
  id: string;
  paymentAttemptId: string;
  /** Reached through the payment attempt's checkout session; null if unresolved. */
  masterOrderId: string | null;
  source: RefundObligationSource;
  reasonCode: string;
  status: RefundObligationStatus;
  amount: MoneyString;
  currency: string;
  attemptCount: number;
  createdAt: string;
}

export const ADMIN_REFUND_ITEM_KEYS = [
  "id",
  "paymentAttemptId",
  "masterOrderId",
  "source",
  "reasonCode",
  "status",
  "amount",
  "currency",
  "attemptCount",
  "createdAt",
] as const satisfies readonly (keyof AdminRefundItem)[];

// --------------------------------------------------------- settlements

/**
 * One payout, as the operator who executed it sees it.
 *
 * `externalTransferReference` IS here and is the one field this contract
 * carries that the supplier's own settlement view deliberately does not.
 * The operator performed the transfer and needs the bank's reference to
 * reconcile it. It must never travel to a supplier surface.
 *
 * `executedByAdminUserId` is absent even here: who pressed the button is
 * an audit question, answered by the audit log with its own actor field,
 * not by decorating every payout row with a colleague's id.
 *
 * No bank account id, no IBAN, no ledger posting, no journal entry.
 */
export interface AdminSettlementItem {
  id: string;
  orderAllocationId: string;
  masterOrderId: string;
  supplierCompanyId: string;
  supplierLegalName: string;
  outcome: "EXECUTED" | "ZERO_BALANCE";
  netAmount: MoneyString;
  currency: string;
  /** The bank's reference for the transfer. ADMIN-ONLY. */
  externalTransferReference: string | null;
  executedAt: string;
}

export const ADMIN_SETTLEMENT_ITEM_KEYS = [
  "id",
  "orderAllocationId",
  "masterOrderId",
  "supplierCompanyId",
  "supplierLegalName",
  "outcome",
  "netAmount",
  "currency",
  "externalTransferReference",
  "executedAt",
] as const satisfies readonly (keyof AdminSettlementItem)[];

// -------------------------------------------------------- bank accounts

export const BANK_ACCOUNT_VERIFICATION_STATUSES = [
  "PENDING_VERIFICATION",
  "VERIFIED",
  "REJECTED",
  "SUPERSEDED",
] as const;

export type BankAccountVerificationStatus =
  (typeof BANK_ACCOUNT_VERIFICATION_STATUSES)[number];

/**
 * One submitted bank account.
 *
 * `ibanLast4` and nothing more. The stored IBAN is encrypted, and its
 * ciphertext and blind-index fingerprint are not selected by any query
 * behind this shape. `BankDataCryptoService.decrypt` is reachable from
 * no HTTP path at all — an operator approving an account checks the
 * holder name, the bank and the last four, which is what the submission
 * evidence shows.
 */
export interface AdminBankAccountItem {
  id: string;
  companyId: string;
  companyLegalName: string;
  accountHolderName: string;
  bankName: string;
  ibanLast4: string;
  verificationStatus: BankAccountVerificationStatus;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export const ADMIN_BANK_ACCOUNT_ITEM_KEYS = [
  "id",
  "companyId",
  "companyLegalName",
  "accountHolderName",
  "bankName",
  "ibanLast4",
  "verificationStatus",
  "rejectionReason",
  "verifiedAt",
  "createdAt",
] as const satisfies readonly (keyof AdminBankAccountItem)[];

// ------------------------------------------------------------ products

export interface AdminProductItem {
  id: string;
  companyId: string;
  companyLegalName: string;
  nameAr: string;
  nameEn: string;
  approvalStatus: string;
  rejectionReason: string | null;
  archivedAt: string | null;
  mediaCount: number;
  createdAt: string;
  updatedAt: string;
}

export const ADMIN_PRODUCT_ITEM_KEYS = [
  "id",
  "companyId",
  "companyLegalName",
  "nameAr",
  "nameEn",
  "approvalStatus",
  "rejectionReason",
  "archivedAt",
  "mediaCount",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof AdminProductItem)[];

// ------------------------------------------------------------- orders

/**
 * One order, as an operator sees it.
 *
 * Both money fields are `MoneyString`. They come from `Decimal(14,2)`
 * columns, and until this contract existed the admin read handed the
 * Prisma `Decimal` straight to `JSON.stringify`, which calls
 * `toString()` — so a stored `100.00` arrived as `"100"`. That parses,
 * prints and compares differently from every other amount in the
 * system, and it is the shape a reconciliation against a bank statement
 * would trip over. `toFixed(2)` is the only producer.
 *
 * `supplierPayableAmount` is on this shape and on no trader-facing one:
 * what the platform owes the supplier is not the buyer's business.
 *
 * There is no `currency` field: `MasterOrder` has no currency column.
 * An order exists only after a payment in the platform's single
 * currency, and inventing the field here would state as fact something
 * the row does not record.
 *
 * `paidAt` is not nullable — a `MasterOrder` is created by the payment
 * that paid for it, so the column is `DateTime`, not `DateTime?`.
 *
 * `supplierCompanyLegalName` comes from the order's OWN
 * `supplierLegalNameSnapshot`, frozen at purchase. If the supplier
 * later renames itself, this screen keeps showing the name the order
 * was actually placed with — which is the name on the invoice.
 */
export interface AdminOrderItem {
  id: string;
  status: string;
  totalAmount: MoneyString;
  supplierPayableAmount: MoneyString;
  opportunityId: string;
  traderCompanyId: string;
  traderCompanyLegalName: string;
  supplierCompanyId: string;
  supplierCompanyLegalName: string;
  allocationCount: number;
  paidAt: string;
  createdAt: string;
}

export const ADMIN_ORDER_ITEM_KEYS = [
  "id",
  "status",
  "totalAmount",
  "supplierPayableAmount",
  "opportunityId",
  "traderCompanyId",
  "traderCompanyLegalName",
  "supplierCompanyId",
  "supplierCompanyLegalName",
  "allocationCount",
  "paidAt",
  "createdAt",
] as const satisfies readonly (keyof AdminOrderItem)[];

/** One shipment within an order. */
export interface AdminOrderAllocationItem {
  id: string;
  status: string;
  expectedPreparationDays: number | null;
  preparationDueAt: string | null;
  checkoutLocationAllocationId: string;
}

export const ADMIN_ORDER_ALLOCATION_ITEM_KEYS = [
  "id",
  "status",
  "expectedPreparationDays",
  "preparationDueAt",
  "checkoutLocationAllocationId",
] as const satisfies readonly (keyof AdminOrderAllocationItem)[];

export interface AdminOrderDetail extends AdminOrderItem {
  allocations: AdminOrderAllocationItem[];
}

// ------------------------------------------------------------ disputes

/**
 * One dispute in the operator's queue.
 *
 * `description` is the buyer's own words and is deliberately absent from
 * the LIST: a queue is scanned, and free text written by a counterparty
 * does not belong in a scannable column. It appears on the detail, where
 * the operator has opened one case on purpose.
 */
export interface AdminDisputeItem {
  id: string;
  orderAllocationId: string;
  masterOrderId: string;
  reasonCode: string;
  status: string;
  supplierResponseDueAt: string;
  openedAt: string;
}

export const ADMIN_DISPUTE_ITEM_KEYS = [
  "id",
  "orderAllocationId",
  "masterOrderId",
  "reasonCode",
  "status",
  "supplierResponseDueAt",
  "openedAt",
] as const satisfies readonly (keyof AdminDisputeItem)[];

/**
 * A piece of evidence, as metadata only.
 *
 * `storageObjectKey` is NOT here. A storage key is a direct address in
 * the object store; handing one to any client — administrator included —
 * turns a bucket path into a credential. Evidence is served through its
 * own authorised endpoint, so the id is all a screen needs.
 */
export interface AdminDisputeEvidenceItem {
  id: string;
  uploadedAt: string;
}

export const ADMIN_DISPUTE_EVIDENCE_ITEM_KEYS = [
  "id",
  "uploadedAt",
] as const satisfies readonly (keyof AdminDisputeEvidenceItem)[];

export interface AdminDisputeResponseView {
  responseType: string;
  description: string;
  respondedAt: string;
}

export const ADMIN_DISPUTE_RESPONSE_KEYS = [
  "responseType",
  "description",
  "respondedAt",
] as const satisfies readonly (keyof AdminDisputeResponseView)[];

/**
 * One decision already taken on a dispute.
 *
 * The two refund figures are `MoneyString | null` — null means the
 * decision awarded nothing under that head, which is not the same as
 * zero and is not rendered as `0.00`.
 */
export interface AdminDisputeDecisionItem {
  id: string;
  sequenceNumber: number;
  decisionType: string;
  productRefundAmountInclTax: MoneyString | null;
  shippingRefundAmount: MoneyString | null;
  reasonNote: string;
  decidedAt: string;
  refundObligationId: string | null;
  replacementObligationId: string | null;
  /**
   * Where that replacement stands.
   *
   * THE ID ALONE WAS NOT ENOUGH. The admin screen offers two actions on
   * a replacement — confirm it delivered, and record it as failed — and
   * the service accepts each from a different set of states: delivery
   * only from SHIPPED, failure from any of the four before DELIVERED.
   * With only an id the screen has to draw both and let the server
   * refuse one, which is the doomed button this platform refuses to
   * draw.
   */
  replacementObligationStatus: ReplacementObligationStatus | null;
}

export const ADMIN_DISPUTE_DECISION_ITEM_KEYS = [
  "id",
  "sequenceNumber",
  "decisionType",
  "productRefundAmountInclTax",
  "shippingRefundAmount",
  "reasonNote",
  "decidedAt",
  "refundObligationId",
  "replacementObligationId",
  "replacementObligationStatus",
] as const satisfies readonly (keyof AdminDisputeDecisionItem)[];

/**
 * `decidedByAdminUserId` is deliberately absent from every shape above.
 * Who decided a case is recorded, and it is read from the audit log — a
 * surface that already answers "who did what" for the whole platform —
 * rather than mirrored onto a case file where it becomes a second copy
 * that can disagree with the first.
 */
export interface AdminDisputeDetail extends AdminDisputeItem {
  description: string;
  /**
   * The currency the decision amounts are in, read through the order's
   * payment attempt.
   *
   * On the contract rather than assumed by the screen. A hardcoded
   * "SAR" in the browser would be a claim about money that the row
   * itself does not make, and it would keep printing that symbol on the
   * day a second currency exists.
   */
  currency: string;
  evidence: AdminDisputeEvidenceItem[];
  supplierResponse: AdminDisputeResponseView | null;
  decisions: AdminDisputeDecisionItem[];
}

// ------------------------------------------------------- refund detail

/**
 * One attempt to move money back to a buyer.
 *
 * `idempotencyKey` is NOT here. It is the token that decides whether a
 * replayed refund executes once or twice; publishing it to a browser
 * would let anyone holding it collide with, or replay, a real settlement
 * instruction. `providerReference` IS here — it is the provider's own
 * handle for the transfer and is what an operator quotes when
 * reconciling.
 */
export interface AdminRefundAttemptItem {
  id: string;
  providerCode: string;
  status: string;
  providerReference: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export const ADMIN_REFUND_ATTEMPT_ITEM_KEYS = [
  "id",
  "providerCode",
  "status",
  "providerReference",
  "failureReason",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof AdminRefundAttemptItem)[];

export interface AdminRefundDetail extends AdminRefundItem {
  productRefundAmountInclTax: MoneyString | null;
  shippingRefundAmount: MoneyString | null;
  disputeDecisionId: string | null;
  attempts: AdminRefundAttemptItem[];
}

// -------------------------------------------------- supplier approvals

/** One supplier waiting for verification. */
export interface AdminPendingSupplierItem {
  id: string;
  legalName: string;
  crNumber: string;
  verificationStatus: string;
  createdAt: string;
}

/**
 * A COMPANY AS A CHOICE, and nothing more.
 *
 * «أضف خيار اختيار اسم المنشأة في بطاقة البحث… وخيار اختيار اسم
 *  المورّد في صفحة المنتجات.»
 *
 * TWO FIELDS, BECAUSE A CHOOSER NEEDS TWO. The register's own row
 * shape carries a dozen — the registration, the state, the counts,
 * the totals — and a list built to fill a dropdown must not be the
 * cheapest way to read all of that for every company at once.
 *
 * UNPAGED, DELIBERATELY. A chooser that stops at page one is a
 * chooser that silently cannot find half the platform, and a
 * reader has no way to tell which half. Two columns per company
 * is what makes the whole list affordable.
 */
export interface AdminCompanyName {
  id: string;
  legalName: string;
}

export const ADMIN_COMPANY_NAME_KEYS = [
  "id",
  "legalName",
] as const satisfies readonly (keyof AdminCompanyName)[];

export const ADMIN_PENDING_SUPPLIER_ITEM_KEYS = [
  "id",
  "legalName",
  "crNumber",
  "verificationStatus",
  "createdAt",
] as const satisfies readonly (keyof AdminPendingSupplierItem)[];

/**
 * One product waiting for review.
 *
 * `mediaCount` and `hasMainImage` replace the media rows themselves. The
 * rows carry `objectKey` and `thumbnailObjectKey`, and the review queue
 * needs to know whether images exist — not where they are stored. The
 * images themselves are viewed through the product's own authorised
 * media endpoint.
 */
export interface AdminPendingProductItem {
  id: string;
  companyId: string;
  companyLegalName: string;
  nameAr: string;
  nameEn: string;
  taxonomyNodeId: string;
  mediaCount: number;
  hasMainImage: boolean;
  createdAt: string;
  updatedAt: string;
}

export const ADMIN_PENDING_PRODUCT_ITEM_KEYS = [
  "id",
  "companyId",
  "companyLegalName",
  "nameAr",
  "nameEn",
  "taxonomyNodeId",
  "mediaCount",
  "hasMainImage",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof AdminPendingProductItem)[];

// ----------------------------------------------------------- invoicing

/**
 * One invoice document on an order.
 *
 * `snapshotData` is NOT here. It is the full frozen computation behind
 * the document — line items, policy versions, party details — and it is
 * retained so the figure can be re-derived years later, not so it can be
 * shipped to a screen that shows a total. `amount` is the document's own
 * figure as a `MoneyString`.
 */
export interface AdminInvoiceDocumentItem {
  id: string;
  documentType: string;
  masterOrderId: string;
  relatedInvoiceDocumentId: string | null;
  amount: MoneyString;
  currency: string;
  internalDocumentReference: string;
  issuedAt: string;
  createdAt: string;
}

export const ADMIN_INVOICE_DOCUMENT_ITEM_KEYS = [
  "id",
  "documentType",
  "masterOrderId",
  "relatedInvoiceDocumentId",
  "amount",
  "currency",
  "internalDocumentReference",
  "issuedAt",
  "createdAt",
] as const satisfies readonly (keyof AdminInvoiceDocumentItem)[];

/** The platform's own billing identity, current version. */
export interface AdminPlatformBillingProfile {
  id: string;
  version: number;
  legalName: string;
  crNumber: string;
  isVatRegistered: boolean;
  vatNumber: string | null;
  /**
   * The seller address that goes on a commission document.
   *
   * It WAS an opaque `Record<string, unknown>`, matching an `@IsObject()`
   * on the DTO that accepted any object at all — including `{}`, which
   * would have put an empty seller address on a tax-adjacent document.
   * The column is still `Json` and nothing about the storage changed;
   * what changed is that the shape is now declared and enforced.
   */
  addressSnapshot: PlatformBillingAddress;
  createdAt: string;
}

/**
 * The seller address on a commission document.
 *
 * NOT A FREE-TEXT CITY. Cities are reference data with their own table
 * and their own admin screen, and every other address on this platform —
 * `CompanyLocation` — carries a `cityId` UUID and never a typed city
 * name. Letting an operator type one would put a name on a document with
 * nothing to check it against.
 *
 * AND THE NAME IS SNAPSHOT BESIDE IT. A billing profile version is
 * immutable and documents are computed against it, so a city renamed
 * next year must not silently rewrite a document issued this year. That
 * is the same reason `MasterOrder` carries `supplierLegalNameSnapshot`
 * beside the supplier id: the id says WHICH city, the snapshot says what
 * it was CALLED.
 *
 * `shortAddress` HAS NO FORMAT RULE, and none is invented here. This
 * platform validates it in exactly two places — `CreateLocationDto` and
 * the admin branch DTO — as a non-empty string of at most 200
 * characters. Anything stricter would be a rule the codebase has never
 * agreed to.
 */
export interface PlatformBillingAddress {
  /** References `cities.id`. */
  cityId: string;
  /** What that city was called when this version was written. */
  cityNameAr: string;
  cityNameEn: string;
  /** «العنوان الوطني المختصر». 1–200 characters, no imposed shape. */
  shortAddress: string;
}

export const PLATFORM_BILLING_ADDRESS_KEYS = [
  "cityId",
  "cityNameAr",
  "cityNameEn",
  "shortAddress",
] as const satisfies readonly (keyof PlatformBillingAddress)[];

/** The bound this platform already applies to a short address. */
export const SHORT_ADDRESS_MAX = 200;

export const ADMIN_PLATFORM_BILLING_PROFILE_KEYS = [
  "id",
  "version",
  "legalName",
  "crNumber",
  "isVatRegistered",
  "vatNumber",
  "addressSnapshot",
  "createdAt",
] as const satisfies readonly (keyof AdminPlatformBillingProfile)[];

// ----------------------------------------------------------- reference

/**
 * Reference data, as the admin catalogue screens read it.
 *
 * These tables hold no secrets, so closing them is not about
 * concealment — it is about the contract. A screen built against
 * `findMany()` silently gains every column added later, and a column
 * added for an internal reason then has to be un-shipped. Naming the
 * fields makes that addition a deliberate act.
 */
export interface AdminTaxonomyNodeItem {
  id: string;
  parentId: string | null;
  nameAr: string;
  nameEn: string;
  iconUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  /**
   * Where it sits, counted from one.
   *
   * DERIVED ON THE SERVER, not walked in the browser. The screen
   * needs it to decide which parents may still take a child, and a
   * second walk over the same rows would be a second answer to the
   * question the create endpoint already refuses on.
   */
  depth: number;
  /** How many categories sit directly under it. */
  childCount: number;
  /** How many products are classified under it. */
  productCount: number;
}

export const ADMIN_TAXONOMY_NODE_ITEM_KEYS = [
  "id",
  "depth",
  "childCount",
  "productCount",
  "parentId",
  "nameAr",
  "nameEn",
  "iconUrl",
  "sortOrder",
  "isActive",
  "createdAt",
] as const satisfies readonly (keyof AdminTaxonomyNodeItem)[];

export interface AdminSalesUnitItem {
  id: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export const ADMIN_SALES_UNIT_ITEM_KEYS = [
  "id",
  "nameAr",
  "nameEn",
  "sortOrder",
  "isActive",
  "createdAt",
] as const satisfies readonly (keyof AdminSalesUnitItem)[];

export interface AdminRegionItem {
  id: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  createdAt: string;
}

export const ADMIN_REGION_ITEM_KEYS = [
  "id",
  "nameAr",
  "nameEn",
  "isActive",
  "createdAt",
] as const satisfies readonly (keyof AdminRegionItem)[];

export interface AdminCityItem {
  id: string;
  regionId: string;
  regionNameAr: string;
  regionNameEn: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export const ADMIN_CITY_ITEM_KEYS = [
  "id",
  "regionId",
  "regionNameAr",
  "regionNameEn",
  "nameAr",
  "nameEn",
  "sortOrder",
  "isActive",
  "createdAt",
] as const satisfies readonly (keyof AdminCityItem)[];

// ------------------------------------------------------------ branding

/**
 * Site branding, as the admin screen edits it.
 *
 * `updatedBy` is NOT here. It is an admin user id, and who last edited
 * branding is an audit-log question — the same rule applied to dispute
 * decisions above, for the same reason: one record of "who did what",
 * not several that can drift apart.
 *
 * `headerFooterConfig` is NOT here either. It is a free-form JSON blob
 * with no validated shape, and rendering unvalidated JSON into a page is
 * the injection surface decision C exists to close. Header navigation is
 * configured through `HEADER_NAV`, which holds taxonomy ids and nothing
 * else.
 */
export interface AdminBrandingView {
  nameAr: string | null;
  nameEn: string | null;
  shortDescriptionAr: string | null;
  shortDescriptionEn: string | null;
  logoMainUrl: string | null;
  logoSmallUrl: string | null;
  faviconUrl: string | null;
  invoiceLogoUrl: string | null;
  emailLogoUrl: string | null;
  updatedAt: string;
}

export const ADMIN_BRANDING_VIEW_KEYS = [
  "nameAr",
  "nameEn",
  "shortDescriptionAr",
  "shortDescriptionEn",
  "logoMainUrl",
  "logoSmallUrl",
  "faviconUrl",
  "invoiceLogoUrl",
  "emailLogoUrl",
  "updatedAt",
] as const satisfies readonly (keyof AdminBrandingView)[];

// ---------------------------------------------------- one product, whole

/**
 * One product, as the console reads it.
 *
 * WHY THIS EXISTS AT ALL. Until now the console could LIST products and
 * ACT on them — suspend, reactivate, delete — and could not READ one.
 * Every field a decision turns on (what the thing actually is, what it
 * weighs, what a package holds, what the images show) lived only on the
 * supplier's own screen, which an administrator cannot open. Deciding
 * from a name and a status is not reviewing anything.
 *
 * IT IS `ProductDetail` PLUS THE THINGS ONLY SUPERVISION NEEDS, not an
 * extension of it, because two fields genuinely differ:
 *
 *   - `media` carries ADMIN delivery paths (`adminProductMediaImagePath`),
 *     since the supplier's `companies/me/...` route resolves «me» from
 *     the session's company and an administrator has none;
 *   - the supplier's shape has no idea whose product it is, and here
 *     that is the first question.
 *
 * NO STORAGE KEY, exactly as everywhere else. `liveOfferCount` is the
 * count of offers in a status that reaches a buyer — it is what makes an
 * edit consequential, and the screen says so before anyone types.
 */
export interface AdminProductDetail {
  id: string;
  companyId: string;
  companyLegalName: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  approvalStatus: ProductApprovalStatus;
  rejectionReason: string | null;
  archivedAt: string | null;
  taxonomyNodeId: string;
  /** The branch's own name, and its ancestors, outermost first. */
  taxonomyPathAr: string[];
  taxonomyPathEn: string[];
  /** The SOFT picker reference, or null. Nothing reads it for logic. */
  salesUnitId: string | null;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  /** Decimal string at scale 3, or null. Not money. */
  packageContentQuantity: string | null;
  packageContentUnitNameAr: string | null;
  packageContentUnitNameEn: string | null;
  /** Decimal string at scale 3. Not money. */
  weightPerUnit: string;
  /** Decimal strings at scale 2. Not money. */
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  media: ProductMediaView[];
  /**
   * Offers a buyer can currently reach — SCHEDULED, ACTIVE, PAUSED or
   * FUNDED. This is the count that refuses the SUPPLIER an edit.
   */
  liveOfferCount: number;
  createdAt: string;
  updatedAt: string;
}

export const ADMIN_PRODUCT_DETAIL_KEYS = [
  "id",
  "companyId",
  "companyLegalName",
  "nameAr",
  "nameEn",
  "descriptionAr",
  "descriptionEn",
  "approvalStatus",
  "rejectionReason",
  "archivedAt",
  "taxonomyNodeId",
  "taxonomyPathAr",
  "taxonomyPathEn",
  "salesUnitId",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
  "weightPerUnit",
  "lengthCm",
  "widthCm",
  "heightCm",
  "media",
  "liveOfferCount",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof AdminProductDetail)[];

/**
 * The fields an administrator may write on a product.
 *
 * THE SAME FIELDS THE SUPPLIER HAS, and deliberately no others. An
 * administrator corrects a supplier's record; they do not gain a column
 * the owner of the record does not have. Approval status, archiving and
 * deletion are separate ACTIONS with their own routes, their own
 * confirmations and their own cascades — they are not fields on a form.
 *
 * Every value is optional in the sense of "omit to leave alone"; a
 * nullable field additionally accepts `null` to CLEAR it, exactly as on
 * the supplier's own edit. See `UpdateProductDto` for the three intents.
 */
export const ADMIN_PRODUCT_EDITABLE_FIELDS = [
  "taxonomyNodeId",
  "salesUnitId",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
  "nameAr",
  "nameEn",
  "descriptionAr",
  "descriptionEn",
  "weightPerUnit",
  "lengthCm",
  "widthCm",
  "heightCm",
] as const;

export type AdminProductEditableField =
  (typeof ADMIN_PRODUCT_EDITABLE_FIELDS)[number];
