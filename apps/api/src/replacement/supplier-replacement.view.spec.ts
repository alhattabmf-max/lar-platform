import {
  SUPPLIER_REPLACEMENT_ACTIONS,
  SUPPLIER_REPLACEMENT_DETAIL_KEYS,
  SUPPLIER_REPLACEMENT_SUMMARY_KEYS,
  supplierReplacementAction,
} from "@platform/types";
import {
  SUPPLIER_REPLACEMENT_DETAIL_SELECT,
  SUPPLIER_REPLACEMENT_SUMMARY_SELECT,
  awaitsSupplierAction,
  supplierReplacementWhere,
  toSupplierReplacementDetail,
  toSupplierReplacementSummary,
} from "./supplier-replacement.view";

/**
 * The supplier's replacement obligations.
 *
 * There was no read surface for these at all before 8E: only the three POST
 * actions existed, so `REPLACEMENT_REQUIRED` — a notification with an
 * ACTION_REQUIRED urgency — pointed nowhere.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OBLIGATION = "66666666-6666-4666-8666-666666666666";

const DESTINATION = {
  locationNameSnapshot: "الفرع الرئيسي",
  cityNameArSnapshot: "الرياض",
  cityNameEnSnapshot: "Riyadh",
  regionNameArSnapshot: "منطقة الرياض",
  regionNameEnSnapshot: "Riyadh Region",
  addressSnapshot: "طريق الملك فهد",
  contactNameSnapshot: "محمد",
  contactPhoneSnapshot: "+966500000001",
};

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: OBLIGATION,
    originalOrderAllocationId: "33333333-3333-4333-8333-333333333333",
    status: "AWAITING_PREPARATION",
    replacementQuantity: 4,
    createdAt: new Date("2026-08-15T00:00:00.000Z"),
    shippedAt: null,
    deliveredAt: null,
    failedAt: null,
    originalOrderAllocation: { masterOrderId: "22222222-2222-4222-8222-222222222222" },
    ...overrides,
  } as never;
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    ...(summaryRow() as object),
    preparationStartedAt: null,
    readyToShipAt: null,
    shipmentTracking: null,
    disputeDecision: { disputeId: "55555555-5555-4555-8555-555555555555" },
    originalOrderAllocation: {
      masterOrderId: "22222222-2222-4222-8222-222222222222",
      checkoutLocationAllocation: DESTINATION,
    },
    ...overrides,
  } as never;
}

describe("the projected obligation carries exactly its contract", () => {
  it("returns the declared summary keys", () => {
    expect(Object.keys(toSupplierReplacementSummary(summaryRow())).sort()).toEqual(
      [...SUPPLIER_REPLACEMENT_SUMMARY_KEYS].sort()
    );
  });

  it("returns the declared detail keys", () => {
    expect(Object.keys(toSupplierReplacementDetail(detailRow())).sort()).toEqual(
      [...SUPPLIER_REPLACEMENT_DETAIL_KEYS].sort()
    );
  });

  it("reduces the dispute to its id and nothing else", () => {
    // The supplier lost that decision and may open the dispute under its own
    // boundary. The complaint text, the administrator's reasoning and the
    // evidence do not travel here, where none of them would be filtered.
    const detail = toSupplierReplacementDetail(detailRow());

    expect(detail.disputeId).toBe("55555555-5555-4555-8555-555555555555");

    const serialised = JSON.stringify(detail);
    for (const forbidden of ["reasonNote", "decidedByAdminUserId", "evidence", "description"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("selects the dispute's id only — the rest is never read", () => {
    const select = JSON.stringify(SUPPLIER_REPLACEMENT_DETAIL_SELECT);

    expect(select).toContain("disputeId");
    for (const forbidden of ["reasonNote", "reasonCode", "decidedByAdminUserId"]) {
      expect(select).not.toContain(forbidden);
    }
  });

  it("gives the courier the address and a contact, and no coordinate", () => {
    const detail = toSupplierReplacementDetail(detailRow());

    expect(detail.address).toBe("طريق الملك فهد");
    expect(detail.contactName).toBe("محمد");
    expect(detail.contactPhone).toBe("+966500000001");

    // A coordinate is not an address, and no sentinel stands in for one.
    const select = JSON.stringify(SUPPLIER_REPLACEMENT_DETAIL_SELECT);
    expect(select).not.toContain("latitude");
    expect(select).not.toContain("longitude");
  });

  it("carries no money at all — a replacement is not a payment", () => {
    const serialised = JSON.stringify(toSupplierReplacementDetail(detailRow()));

    for (const forbidden of ["Amount", "netAmount", "commission", "payable"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("reads the destination through the ORIGINAL allocation's frozen snapshot", () => {
    // A replacement goes where the original went. Reading a live location
    // would send it wherever the branch has since moved to.
    const select = JSON.stringify(SUPPLIER_REPLACEMENT_SUMMARY_SELECT);
    expect(select).not.toContain("checkoutLocationAllocation");

    expect(JSON.stringify(SUPPLIER_REPLACEMENT_DETAIL_SELECT)).toContain("Snapshot");
  });
});

describe("timestamps are ISO strings or null, never a Date", () => {
  it("passes a null through as null", () => {
    const summary = toSupplierReplacementSummary(summaryRow());

    expect(summary.createdAt).toBe("2026-08-15T00:00:00.000Z");
    expect(summary.shippedAt).toBeNull();
    expect(summary.deliveredAt).toBeNull();
    expect(summary.failedAt).toBeNull();
  });

  it("renders FAILED with its timestamp", () => {
    // FAILED is on `ReplacementObligationStatus` and on no other fulfilment
    // enum. A consumer that treats it as unreachable strands the obligation.
    const summary = toSupplierReplacementSummary(
      summaryRow({ status: "FAILED", failedAt: new Date("2026-08-19T00:00:00.000Z") })
    );

    expect(summary.status).toBe("FAILED");
    expect(summary.failedAt).toBe("2026-08-19T00:00:00.000Z");
  });

  it("carries the carrier and tracking number when a shipment exists", () => {
    const detail = toSupplierReplacementDetail(
      detailRow({ shipmentTracking: { carrierCode: "SMSA", trackingNumber: "TRK-1" } })
    );

    expect(detail.carrierCode).toBe("SMSA");
    expect(detail.trackingNumber).toBe("TRK-1");
  });

  it("reports no shipment as null rather than an empty string", () => {
    const detail = toSupplierReplacementDetail(detailRow());

    expect(detail.carrierCode).toBeNull();
    expect(detail.trackingNumber).toBeNull();
  });
});

describe("ownership lives in the query", () => {
  it("scopes obligations through the ORIGINAL allocation to the caller", () => {
    expect(supplierReplacementWhere(COMPANY)).toEqual({
      originalOrderAllocation: { masterOrder: { supplierCompanyId: COMPANY } },
    });
  });
});

describe("awaiting an action, and which action", () => {
  it.each(["AWAITING_PREPARATION", "PREPARING", "READY_TO_SHIP"] as const)(
    "%s still needs the supplier to move",
    (status) => {
      expect(awaitsSupplierAction(status)).toBe(true);
      expect(toSupplierReplacementSummary(summaryRow({ status })).awaitingSupplierAction).toBe(
        true
      );
    }
  );

  it.each(["SHIPPED", "DELIVERED", "FAILED"] as const)("%s does not", (status) => {
    // Once shipped the next move is the trader's confirmation; DELIVERED and
    // FAILED are finished.
    expect(awaitsSupplierAction(status)).toBe(false);
    expect(toSupplierReplacementSummary(summaryRow({ status })).awaitingSupplierAction).toBe(
      false
    );
  });

  it("offers an action for exactly the states that await one", () => {
    // The flag and the action come from the same rule, so a UI cannot show a
    // button on a row it has just told the user needs nothing.
    for (const status of ["AWAITING_PREPARATION", "PREPARING", "READY_TO_SHIP"] as const) {
      expect([status, supplierReplacementAction(status)]).toEqual([
        status,
        SUPPLIER_REPLACEMENT_ACTIONS[status],
      ]);
      expect(awaitsSupplierAction(status)).toBe(true);
    }

    for (const status of ["SHIPPED", "DELIVERED", "FAILED"] as const) {
      expect([status, supplierReplacementAction(status)]).toEqual([status, null]);
    }
  });

  it("offers no action that confirms delivery — that is the trader's", () => {
    expect(Object.values(SUPPLIER_REPLACEMENT_ACTIONS).join(" ")).not.toContain("deliver");
  });
});
