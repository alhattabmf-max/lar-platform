import {
  ORDER_ALLOCATION_STATUSES,
  PRODUCT_APPROVAL_STATUSES,
  PRODUCT_DETAIL_KEYS,
  PRODUCT_MEDIA_VIEW_KEYS,
  PRODUCT_SUMMARY_KEYS,
  REPLACEMENT_OBLIGATION_STATUSES,
  SETTLEMENT_DETAIL_KEYS,
  SETTLEMENT_SUMMARY_KEYS,
  SUPPLIER_ALLOCATION_DETAIL_KEYS,
  SUPPLIER_DISPUTE_DETAIL_VIEW_KEYS,
  SUPPLIER_DISPUTE_RESPONSE_TYPES,
  SUPPLIER_DISPUTE_SUMMARY_KEYS,
  SUPPLIER_ORDER_DETAIL_KEYS,
  SUPPLIER_ORDER_SUMMARY_KEYS,
  SUPPLIER_PAYOUT_OUTCOMES,
  SUPPLIER_REPLACEMENT_DETAIL_KEYS,
  SUPPLIER_REPLACEMENT_SUMMARY_KEYS,
  productNeedsSupplierAction,
  supplierAllocationAction,
  supplierReplacementAction,
} from "@platform/types";
import {
  DisputeSupplierResponseType,
  OrderAllocationStatus,
  ProductApprovalStatus,
  ReplacementObligationStatus,
  SupplierPayoutOutcome,
} from "@prisma/client";

/**
 * The supplier contracts, checked against the database's own enums and against
 * the boundary they exist to keep.
 *
 * Written before any projection, so the shapes are agreed before anything maps
 * onto them — and so a vocabulary invented here rather than read from Prisma
 * fails immediately rather than at the first request.
 */

describe("every supplier vocabulary comes from a real enum", () => {
  it("payout outcomes are exactly Prisma's two", () => {
    // ZERO_BALANCE is not a failure: it means nothing was owed for that
    // allocation. A UI rendering it as one would send someone chasing a
    // payment that was never due.
    expect([...SUPPLIER_PAYOUT_OUTCOMES].sort()).toEqual(
      Object.values(SupplierPayoutOutcome).sort()
    );
  });

  it("dispute response types are exactly Prisma's four", () => {
    // REPLACEMENT_OFFER is the one a form would silently drop.
    expect([...SUPPLIER_DISPUTE_RESPONSE_TYPES].sort()).toEqual(
      Object.values(DisputeSupplierResponseType).sort()
    );
  });

  it("product approval statuses are exactly Prisma's six", () => {
    expect([...PRODUCT_APPROVAL_STATUSES].sort()).toEqual(
      Object.values(ProductApprovalStatus).sort()
    );
  });

  it("allocation statuses match Prisma's", () => {
    expect([...ORDER_ALLOCATION_STATUSES].sort()).toEqual(
      Object.values(OrderAllocationStatus).sort()
    );
  });

  it("replacement statuses match Prisma's", () => {
    expect([...REPLACEMENT_OBLIGATION_STATUSES].sort()).toEqual(
      Object.values(ReplacementObligationStatus).sort()
    );
  });
});

describe("a fulfilment action is offered from exactly one state", () => {
  it("maps each actionable status to the transition the server claims from", () => {
    // `OrderAllocationService` claims every transition with a conditional
    // UPDATE — `WHERE id = ... AND status = '<from>'` — and answers 409 when it
    // moves zero rows. Offering an action from any other state promises
    // something that fails.
    expect(supplierAllocationAction("AWAITING_PREPARATION")).toBe("start-preparation");
    expect(supplierAllocationAction("PREPARING")).toBe("mark-ready");
    expect(supplierAllocationAction("READY_TO_SHIP")).toBe("ship");
  });

  it("offers NOTHING once shipped — DELIVERED is not the supplier's to declare", () => {
    // Delivery is confirmed by the trader, or by an administrator. A supplier
    // marking their own shipment delivered would be marking their own
    // homework, and it starts the dispute window.
    expect(supplierAllocationAction("SHIPPED")).toBeNull();
    expect(supplierAllocationAction("DELIVERED")).toBeNull();
  });

  it("covers every status, so none falls through undefined", () => {
    for (const status of ORDER_ALLOCATION_STATUSES) {
      const action = supplierAllocationAction(status);
      expect([status, action === null || typeof action === "string"]).toEqual([status, true]);
    }
  });

  it("applies the same rule to replacements", () => {
    expect(supplierReplacementAction("AWAITING_PREPARATION")).toBe("start-preparation");
    expect(supplierReplacementAction("PREPARING")).toBe("mark-ready");
    expect(supplierReplacementAction("READY_TO_SHIP")).toBe("ship");
    expect(supplierReplacementAction("SHIPPED")).toBeNull();
    expect(supplierReplacementAction("DELIVERED")).toBeNull();
    // FAILED is an administrative outcome, not something a supplier declares
    // about their own obligation.
    expect(supplierReplacementAction("FAILED")).toBeNull();
  });
});

describe("the supplier order contract keeps the trader out of it", () => {
  const allKeys = [
    ...SUPPLIER_ORDER_SUMMARY_KEYS,
    ...SUPPLIER_ORDER_DETAIL_KEYS,
    ...SUPPLIER_ALLOCATION_DETAIL_KEYS,
  ] as readonly string[];

  it("names no trader identity anywhere", () => {
    // `supplier/orders` returned a raw row carrying traderCompanyId until 8E.
    // None of it is needed to pack a box.
    for (const forbidden of [
      "traderCompanyId",
      "traderTaxProfileSnapshot",
      "traderBillingLegalNameSnapshot",
      "checkoutSessionId",
      "paymentAttemptId",
      "acceptedByUserId",
      "policyAcceptanceId",
    ]) {
      expect([forbidden, allKeys.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("names no commission derivation, only what is charged", () => {
    // The supplier is a party to the commission and may see the amount. How
    // the platform priced it — the base, the rate, the tax rule code and
    // version — describes the platform, not this supplier's bill.
    for (const forbidden of [
      "commissionBase",
      "commissionRateBasisPoints",
      "commissionTaxRate",
      "commissionTaxRuleCode",
      "commissionTaxRuleVersion",
    ]) {
      expect([forbidden, allKeys.includes(forbidden)]).toEqual([forbidden, false]);
    }
    expect(SUPPLIER_ORDER_DETAIL_KEYS).toContain("commissionAmount");
    expect(SUPPLIER_ORDER_DETAIL_KEYS).toContain("commissionTaxAmount");
  });

  it("names no bank account, ledger or snapshot", () => {
    for (const forbidden of [
      "supplierBankAccountId",
      "supplierTaxProfileSnapshot",
      "supplierInvoicingProfileSnapshot",
      "ledger",
      "journalEntry",
      "snapshotData",
    ]) {
      expect([forbidden, allKeys.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("gives the courier what a delivery needs, and no coordinate", () => {
    // The destination is the trader's branch and the supplier is shipping
    // there — city, address and someone to call. A latitude is not an address.
    for (const needed of ["locationName", "address", "contactName", "contactPhone"]) {
      expect([needed, SUPPLIER_ALLOCATION_DETAIL_KEYS.includes(needed as never)]).toEqual([
        needed,
        true,
      ]);
    }
    for (const forbidden of ["latitude", "longitude", "latitudeSnapshot", "longitudeSnapshot"]) {
      expect([forbidden, allKeys.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("extends the summary rather than restating it", () => {
    for (const key of SUPPLIER_ORDER_SUMMARY_KEYS) {
      expect([key, SUPPLIER_ORDER_DETAIL_KEYS.includes(key)]).toEqual([key, true]);
    }
  });
});

/**
 * Fields that must never appear on a settlement response.
 *
 * Kept HERE, in the guard, rather than exported from `@platform/types`. A
 * denylist of internal column names is not part of an HTTP contract: shipping
 * it would put it in the web bundle, where it names the platform's banking
 * internals to anyone reading the JavaScript and reads as a map of what to look
 * for. The contract states what a response HAS; this test states what it must
 * not, and only the test needs to know.
 */
const SETTLEMENT_FORBIDDEN_FIELDS = [
  "externalTransferReference",
  "executedByAdminUserId",
  "supplierBankAccountId",
  "iban",
  "accountNumber",
  "ledger",
  "journalEntry",
  "allocationShareBasisPoints",
  "roundingRemainder",
] as const;

describe("the settlement contract withholds the platform's banking operation", () => {
  const allKeys = [...SETTLEMENT_SUMMARY_KEYS, ...SETTLEMENT_DETAIL_KEYS] as readonly string[];

  it.each(SETTLEMENT_FORBIDDEN_FIELDS)("never carries %s", (field) => {
    expect(allKeys).not.toContain(field);
  });

  it("carries what a supplier needs to reconcile", () => {
    for (const needed of [
      "netAmount",
      "outcome",
      "executedAt",
      "orderAllocationId",
      "masterOrderId",
    ]) {
      expect([needed, SETTLEMENT_SUMMARY_KEYS.includes(needed as never)]).toEqual([needed, true]);
    }
  });

  it("shows the basis from the FROZEN snapshot, without its rounding internals", () => {
    // The remainders exist so per-allocation shares sum exactly to the order
    // total. Showing someone a "rounding remainder" line invites a question
    // with no useful answer.
    for (const needed of [
      "productAmountInclTax",
      "shippingFeeAmount",
      "commissionShareAmount",
      "supplierPayableShareAmount",
    ]) {
      expect([needed, SETTLEMENT_DETAIL_KEYS.includes(needed as never)]).toEqual([needed, true]);
    }
    expect(allKeys.some((k) => k.toLowerCase().includes("remainder"))).toBe(false);
    expect(allKeys).not.toContain("allocationShareBasisPoints");
  });
});

describe("the supplier dispute contract mirrors the trader's boundary", () => {
  it("carries the trader's complaint, which the supplier must answer", () => {
    expect(SUPPLIER_DISPUTE_DETAIL_VIEW_KEYS).toContain("traderDescription");
  });

  it("carries no storage key, uploader, admin note or internal id", () => {
    // The same defects `getForTrader` had before 8D.5: all evidence returned
    // including the counterparty's, each with its storage key, plus the
    // administrator's internal note.
    for (const forbidden of [
      "storageObjectKey",
      "uploadedByUserId",
      "respondedByUserId",
      "reasonNote",
      "decidedByAdminUserId",
    ]) {
      expect([forbidden, SUPPLIER_DISPUTE_DETAIL_VIEW_KEYS.includes(forbidden as never)]).toEqual([
        forbidden,
        false,
      ]);
    }
  });

  it("flags who is waiting, so the list can lead with what needs answering", () => {
    expect(SUPPLIER_DISPUTE_SUMMARY_KEYS).toContain("awaitingSupplierResponse");
  });
});

describe("the supplier replacement contract is its own, not the trader's", () => {
  it("asks what must be sent, not where mine is", () => {
    // The trader's contract answers "where is my replacement?" and offers a
    // confirm-delivery action. Sharing one shape would mean one side reading
    // fields written for the other, and a role flag deciding which actions are
    // valid — one wrong prop from offering a supplier the trader's
    // confirmation.
    expect(SUPPLIER_REPLACEMENT_SUMMARY_KEYS).toContain("awaitingSupplierAction");
    expect(SUPPLIER_REPLACEMENT_DETAIL_KEYS).toContain("contactPhone");
  });

  it("carries no dispute narrative or decision reasoning", () => {
    for (const forbidden of ["traderDescription", "reasonNote", "evidence", "decisions"]) {
      expect([
        forbidden,
        SUPPLIER_REPLACEMENT_DETAIL_KEYS.includes(forbidden as never),
      ]).toEqual([forbidden, false]);
    }
    // The dispute id IS carried, so the supplier can open it and read it under
    // that surface's own boundary.
    expect(SUPPLIER_REPLACEMENT_DETAIL_KEYS).toContain("disputeId");
  });
});

describe("the product contract", () => {
  it("carries the rejection reason, which is correspondence", () => {
    // Written by a reviewer FOR the supplier. Withholding it leaves someone
    // told they failed without being told why.
    expect(PRODUCT_SUMMARY_KEYS).toContain("rejectionReason");
  });

  it("names which statuses need the supplier to act", () => {
    expect(productNeedsSupplierAction("REJECTED")).toBe(true);
    expect(productNeedsSupplierAction("SUSPENDED")).toBe(true);
    expect(productNeedsSupplierAction("DRAFT")).toBe(true);
    expect(productNeedsSupplierAction("PENDING_REVIEW")).toBe(false);
    expect(productNeedsSupplierAction("APPROVED")).toBe(false);
    expect(productNeedsSupplierAction("CLOSED")).toBe(false);
  });

  it("exposes media as ROUTES, never as storage keys", () => {
    // The delivery endpoint added in 8E.2 is what makes a URL possible at
    // all. It is built from the route's own ids and re-checks ownership on
    // every request, so the path is an address rather than a capability —
    // which is why it can be handed out while the storage key cannot.
    const keys = [...PRODUCT_DETAIL_KEYS, ...PRODUCT_MEDIA_VIEW_KEYS] as readonly string[];

    for (const forbidden of [
      "objectKey",
      "thumbnailObjectKey",
      "storageObjectKey",
      "snapshots",
    ]) {
      expect([forbidden, keys.includes(forbidden)]).toEqual([forbidden, false]);
    }

    expect(PRODUCT_MEDIA_VIEW_KEYS).toContain("url");
    expect(PRODUCT_MEDIA_VIEW_KEYS).toContain("thumbnailUrl");
    expect(PRODUCT_SUMMARY_KEYS).toContain("thumbnailUrl");
    // A product with no images has a null URL and a zero count — the two must
    // agree, so a UI cannot render a broken image for an empty product.
    expect(PRODUCT_SUMMARY_KEYS).toContain("mediaCount");
  });
});
