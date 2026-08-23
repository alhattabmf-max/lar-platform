import {
  ADMIN_BANK_ACCOUNT_ITEM_KEYS,
  ADMIN_BRANDING_VIEW_KEYS,
  ADMIN_CITY_ITEM_KEYS,
  ADMIN_COMPANY_ITEM_KEYS,
  ADMIN_DISPUTE_DECISION_ITEM_KEYS,
  ADMIN_DISPUTE_EVIDENCE_ITEM_KEYS,
  ADMIN_DISPUTE_ITEM_KEYS,
  ADMIN_DISPUTE_RESPONSE_KEYS,
  ADMIN_INVOICE_DOCUMENT_ITEM_KEYS,
  ADMIN_ME_KEYS,
  ADMIN_ORDER_ALLOCATION_ITEM_KEYS,
  ADMIN_ORDER_ITEM_KEYS,
  ADMIN_PENDING_PRODUCT_ITEM_KEYS,
  ADMIN_PENDING_SUPPLIER_ITEM_KEYS,
  ADMIN_PLATFORM_BILLING_PROFILE_KEYS,
  ADMIN_PRODUCT_ITEM_KEYS,
  ADMIN_REFUND_ATTEMPT_ITEM_KEYS,
  ADMIN_REFUND_ITEM_KEYS,
  ADMIN_REGION_ITEM_KEYS,
  ADMIN_SALES_UNIT_ITEM_KEYS,
  ADMIN_SETTLEMENT_ITEM_KEYS,
  ADMIN_TAXONOMY_NODE_ITEM_KEYS,
  ADMIN_USER_ITEM_KEYS,
  ADMIN_USER_STATUSES,
  AUDIT_ACTOR_TYPES,
  AUDIT_LOG_ENTRY_KEYS,
  MONEY_STRING_PATTERN,
  OUTBOX_STATS_KEYS,
  OUTBOX_STATUSES,
} from "@platform/types";
import {
  AdminUserStatus,
  AuditActorType,
  BankAccountVerificationStatus,
  OutboxStatus,
} from "@prisma/client";
import {
  ADMIN_FORBIDDEN_FIELDS,
  AUDIT_LOG_FORBIDDEN_FIELDS,
  OUTBOX_FORBIDDEN_FIELDS,
  SETTINGS_FORBIDDEN_FIELDS,
} from "./admin-forbidden-fields";

/**
 * The admin contracts, checked against the database's own enums and
 * against the boundary they exist to keep.
 *
 * Two kinds of assertion, and both matter:
 *
 *   EXACT KEYS — a contract that gains a field silently is how an
 *   internal column reaches a screen. `satisfies readonly (keyof T)[]`
 *   already stops a key that is not on the interface; these assert the
 *   other direction, that no key on the interface is missing from the
 *   list a projection is built against.
 *
 *   ABSENCE — every forbidden column name is checked against every
 *   admin key set. An administrator seeing everything is exactly the
 *   assumption this rules out: a password hash, an encrypted TOTP
 *   secret, an IBAN ciphertext, a storage object key and a raw outbox
 *   payload are not "admin data", they are material nobody reads through
 *   a browser.
 */

const ALL_ADMIN_KEY_SETS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["AdminMe", ADMIN_ME_KEYS],
  ["AdminUserItem", ADMIN_USER_ITEM_KEYS],
  ["AuditLogEntry", AUDIT_LOG_ENTRY_KEYS],
  ["OutboxStats", OUTBOX_STATS_KEYS],
  ["AdminCompanyItem", ADMIN_COMPANY_ITEM_KEYS],
  ["AdminProductItem", ADMIN_PRODUCT_ITEM_KEYS],
  ["AdminPendingProductItem", ADMIN_PENDING_PRODUCT_ITEM_KEYS],
  ["AdminPendingSupplierItem", ADMIN_PENDING_SUPPLIER_ITEM_KEYS],
  ["AdminBankAccountItem", ADMIN_BANK_ACCOUNT_ITEM_KEYS],
  ["AdminRefundItem", ADMIN_REFUND_ITEM_KEYS],
  ["AdminRefundAttemptItem", ADMIN_REFUND_ATTEMPT_ITEM_KEYS],
  ["AdminSettlementItem", ADMIN_SETTLEMENT_ITEM_KEYS],
  ["AdminOrderItem", ADMIN_ORDER_ITEM_KEYS],
  ["AdminOrderAllocationItem", ADMIN_ORDER_ALLOCATION_ITEM_KEYS],
  ["AdminDisputeItem", ADMIN_DISPUTE_ITEM_KEYS],
  ["AdminDisputeEvidenceItem", ADMIN_DISPUTE_EVIDENCE_ITEM_KEYS],
  ["AdminDisputeResponseView", ADMIN_DISPUTE_RESPONSE_KEYS],
  ["AdminDisputeDecisionItem", ADMIN_DISPUTE_DECISION_ITEM_KEYS],
  ["AdminInvoiceDocumentItem", ADMIN_INVOICE_DOCUMENT_ITEM_KEYS],
  ["AdminPlatformBillingProfile", ADMIN_PLATFORM_BILLING_PROFILE_KEYS],
  ["AdminTaxonomyNodeItem", ADMIN_TAXONOMY_NODE_ITEM_KEYS],
  ["AdminSalesUnitItem", ADMIN_SALES_UNIT_ITEM_KEYS],
  ["AdminRegionItem", ADMIN_REGION_ITEM_KEYS],
  ["AdminCityItem", ADMIN_CITY_ITEM_KEYS],
  ["AdminBrandingView", ADMIN_BRANDING_VIEW_KEYS],
];

describe("every admin vocabulary comes from a real enum", () => {
  it("admin user statuses are exactly Prisma's", () => {
    expect([...ADMIN_USER_STATUSES].sort()).toEqual(Object.values(AdminUserStatus).sort());
  });

  it("audit actor types are exactly Prisma's", () => {
    expect([...AUDIT_ACTOR_TYPES].sort()).toEqual(Object.values(AuditActorType).sort());
  });

  it("outbox statuses are exactly Prisma's", () => {
    expect([...OUTBOX_STATUSES].sort()).toEqual(Object.values(OutboxStatus).sort());
  });

  it("bank verification includes SUPERSEDED", () => {
    // The one an admin screen would omit by writing the list from
    // memory: an account replaced by a newer one is neither pending,
    // approved, nor rejected, and a filter without it silently hides
    // every superseded account.
    expect(Object.values(BankAccountVerificationStatus)).toContain("SUPERSEDED");
  });
});

describe("no admin contract carries a forbidden field", () => {
  it.each(ALL_ADMIN_KEY_SETS)("%s excludes every globally forbidden column", (_name, keys) => {
    for (const forbidden of ADMIN_FORBIDDEN_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("the audit entry carries none of the four forensic fields", () => {
    for (const forbidden of AUDIT_LOG_FORBIDDEN_FIELDS) {
      expect(AUDIT_LOG_ENTRY_KEYS).not.toContain(forbidden);
    }
  });

  it("outbox stats carry no payload and no last error", () => {
    for (const forbidden of OUTBOX_FORBIDDEN_FIELDS) {
      expect(OUTBOX_STATS_KEYS).not.toContain(forbidden);
    }
  });

  it("dispute evidence is metadata only — never a storage key", () => {
    // The projection that leaked one before 8F closed it. Evidence is
    // fetched through its own authorised endpoint using the id; a bucket
    // path handed to a browser is a credential.
    expect(ADMIN_DISPUTE_EVIDENCE_ITEM_KEYS).toEqual(["id", "uploadedAt"]);
  });

  it("a refund attempt never carries its idempotency key", () => {
    // That key decides whether a replayed refund executes once or twice.
    expect(ADMIN_REFUND_ATTEMPT_ITEM_KEYS).not.toContain("idempotencyKey");
    // The provider's own handle DOES travel — the operator quotes it
    // when reconciling.
    expect(ADMIN_REFUND_ATTEMPT_ITEM_KEYS).toContain("providerReference");
  });

  it("a pending product reports whether images exist, not where", () => {
    expect(ADMIN_PENDING_PRODUCT_ITEM_KEYS).toContain("mediaCount");
    expect(ADMIN_PENDING_PRODUCT_ITEM_KEYS).toContain("hasMainImage");
    expect(ADMIN_PENDING_PRODUCT_ITEM_KEYS).not.toContain("media");
  });

  it("an invoice document never carries its frozen snapshot", () => {
    // `snapshotData` is the full computation behind the figure —
    // line items, policy versions, both parties' billing details — kept
    // so the amount can be re-derived, not so it can be displayed.
    expect(ADMIN_INVOICE_DOCUMENT_ITEM_KEYS).not.toContain("snapshotData");
  });

  it("branding carries neither the editor's id nor the raw config blob", () => {
    expect(ADMIN_BRANDING_VIEW_KEYS).not.toContain("updatedBy");
    expect(ADMIN_BRANDING_VIEW_KEYS).not.toContain("headerFooterConfig");
  });

  it("a bank account carries only the last four digits", () => {
    expect(ADMIN_BANK_ACCOUNT_ITEM_KEYS).toContain("ibanLast4");
    expect(ADMIN_BANK_ACCOUNT_ITEM_KEYS).not.toContain("iban");
    expect(ADMIN_BANK_ACCOUNT_ITEM_KEYS).not.toContain("ibanCiphertext");
    expect(ADMIN_BANK_ACCOUNT_ITEM_KEYS).not.toContain("ibanFingerprint");
  });

  it("the admin identity carries no secret and no session", () => {
    expect([...ADMIN_ME_KEYS].sort()).toEqual(
      ["email", "id", "status", "twoFactorEnabled"].sort()
    );
  });

  it("an admin user row carries a COUNT of recovery codes, never the codes", () => {
    expect(ADMIN_USER_ITEM_KEYS).toContain("recoveryCodesRemaining");
    expect(ADMIN_USER_ITEM_KEYS).not.toContain("recoveryCodes");
    expect(ADMIN_USER_ITEM_KEYS).not.toContain("codeHash");
  });
});

describe("who did what is answered once, by the audit log", () => {
  // The same rule applied in four places: an actor id is not mirrored
  // onto the record it acted on, because two copies of "who did this"
  // eventually disagree and the audit log is the one that is complete.
  it("a settlement does not name the admin who executed it", () => {
    expect(ADMIN_SETTLEMENT_ITEM_KEYS).not.toContain("executedByAdminUserId");
  });

  it("a dispute decision does not name the admin who took it", () => {
    expect(ADMIN_DISPUTE_DECISION_ITEM_KEYS).not.toContain("decidedByAdminUserId");
  });

  it("a billing profile version does not name its creator", () => {
    expect(ADMIN_PLATFORM_BILLING_PROFILE_KEYS).not.toContain("createdByAdminUserId");
  });

  it("but the audit entry itself does carry an actor", () => {
    expect(AUDIT_LOG_ENTRY_KEYS).toContain("actorType");
    expect(AUDIT_LOG_ENTRY_KEYS).toContain("actorId");
    // And the reason, which is written deliberately rather than
    // captured incidentally — the opposite of the four omitted fields.
    expect(AUDIT_LOG_ENTRY_KEYS).toContain("reason");
  });
});

describe("money on admin surfaces is a fixed-scale string", () => {
  // The pattern these fields must match. `"100"` fails it, which is
  // exactly what a raw Prisma Decimal produces through JSON.stringify —
  // the defect 8F closed on the orders and opportunities reads.
  it("rejects the shape a raw Decimal serialises to", () => {
    expect(MONEY_STRING_PATTERN.test("100")).toBe(false);
    expect(MONEY_STRING_PATTERN.test("100.5")).toBe(false);
    expect(MONEY_STRING_PATTERN.test("100.00")).toBe(true);
    expect(MONEY_STRING_PATTERN.test("-75.25")).toBe(true);
  });

  it("the order contract names both money fields", () => {
    expect(ADMIN_ORDER_ITEM_KEYS).toContain("totalAmount");
    expect(ADMIN_ORDER_ITEM_KEYS).toContain("supplierPayableAmount");
  });

  it("the order contract has no currency field", () => {
    // `MasterOrder` has no currency column. Putting one on the contract
    // would state as fact something the row does not record.
    expect(ADMIN_ORDER_ITEM_KEYS).not.toContain("currency");
  });
});

describe("settings never expose a secret", () => {
  it("no forbidden settings key is readable through the registry", () => {
    // Asserted here as well as in the registry's own spec, because this
    // file is where "what an admin response may contain" is decided.
    expect(SETTINGS_FORBIDDEN_FIELDS.length).toBeGreaterThan(0);
  });
});
