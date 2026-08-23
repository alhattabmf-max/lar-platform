import type { MoneyString } from "./money";

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
 *   - no `beforeData`/`afterData`/`ipAddress`/`userAgent` on an audit
 *     entry, which is where request metadata and copied PII would leak.
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
 * One audit entry — the NINE safe fields.
 *
 * `beforeData` and `afterData` are absent by construction. They are
 * arbitrary JSON copies of rows, which means they carry whatever the row
 * carried: a billing name, an email, a masked IBAN, an admin's internal
 * note. An audit VIEWER needs to know that something changed, who
 * changed it and why — not a replay of the values.
 *
 * `ipAddress` and `userAgent` are absent for the same reason: they are
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
  /** ISO 8601 of the oldest row still PENDING — the real backlog signal. */
  oldestPendingAt: string | null;
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
] as const satisfies readonly (keyof AdminCompanyItem)[];

// ------------------------------------------------------------- refunds

export const REFUND_OBLIGATION_STATUSES = [
  "PENDING_EXECUTION",
  "SENT",
  "COMPLETED",
  "FAILED",
] as const;

export type RefundObligationStatus = (typeof REFUND_OBLIGATION_STATUSES)[number];

export const REFUND_OBLIGATION_SOURCES = ["PAYMENT_EXCEPTION", "DISPUTE"] as const;
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
  createdAt: string;
}

export const ADMIN_PLATFORM_BILLING_PROFILE_KEYS = [
  "id",
  "version",
  "legalName",
  "crNumber",
  "isVatRegistered",
  "vatNumber",
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
}

export const ADMIN_TAXONOMY_NODE_ITEM_KEYS = [
  "id",
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
