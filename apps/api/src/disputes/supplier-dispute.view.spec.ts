import {
  SUPPLIER_DISPUTE_DETAIL_VIEW_KEYS,
  SUPPLIER_DISPUTE_SUMMARY_KEYS,
} from "@platform/types";
import {
  SUPPLIER_DISPUTE_SELECT,
  awaitsSupplierResponse,
  supplierDisputeListWhere,
  supplierDisputeWhere,
  supplierEvidenceQuery,
  toSupplierDisputeDetailView,
  toSupplierDisputeSummary,
} from "./supplier-dispute.view";

/**
 * The supplier's dispute projection.
 *
 * `getForSupplier` had the three defects `getForTrader` had before 8D.5:
 * ownership compared after the fetch, every evidence row returned — including
 * the trader's, each with its storage key — and the administrator's internal
 * `reasonNote` on every decision.
 */

const DISPUTE = "55555555-5555-4555-8555-555555555555";
const COMPANY = "11111111-1111-4111-8111-111111111111";

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DISPUTE,
    orderAllocationId: "33333333-3333-4333-8333-333333333333",
    reasonCode: "ITEM_DAMAGED",
    description: "وصلت الكراتين مبللة",
    status: "OPEN",
    supplierResponseDueAt: new Date("2026-08-20T00:00:00.000Z"),
    openedAt: new Date("2026-08-15T00:00:00.000Z"),
    orderAllocation: { masterOrderId: "22222222-2222-4222-8222-222222222222" },
    supplierResponse: null,
    decisions: [],
    ...overrides,
  } as never;
}

function summaryRow(status = "OPEN") {
  return {
    id: DISPUTE,
    orderAllocationId: "33333333-3333-4333-8333-333333333333",
    status,
    reasonCode: "ITEM_DAMAGED",
    openedAt: new Date("2026-08-15T00:00:00.000Z"),
    supplierResponseDueAt: new Date("2026-08-20T00:00:00.000Z"),
    orderAllocation: { masterOrderId: "22222222-2222-4222-8222-222222222222" },
  };
}

describe("the projected dispute carries exactly its contract", () => {
  it("returns the declared summary keys", () => {
    expect(Object.keys(toSupplierDisputeSummary(summaryRow())).sort()).toEqual(
      [...SUPPLIER_DISPUTE_SUMMARY_KEYS].sort()
    );
  });

  it("returns the declared detail keys", () => {
    expect(Object.keys(toSupplierDisputeDetailView(detailRow(), [])).sort()).toEqual(
      [...SUPPLIER_DISPUTE_DETAIL_VIEW_KEYS].sort()
    );
  });

  it("gives the supplier the trader's accusation — they cannot answer it otherwise", () => {
    const view = toSupplierDisputeDetailView(detailRow(), []);

    expect(view.traderDescription).toBe("وصلت الكراتين مبللة");
  });

  it("selects no internal note, no member of staff and no responder id", () => {
    // Absent from the SELECT, not merely from the mapping: a spread cannot
    // leak a column that was never read.
    const select = JSON.stringify(SUPPLIER_DISPUTE_SELECT);

    for (const forbidden of [
      "reasonNote",
      "decidedByAdminUserId",
      "respondedByUserId",
      "storageObjectKey",
    ]) {
      expect(select).not.toContain(forbidden);
    }
  });

  it("names the exact decision, not a collapsed RESOLVED_*", () => {
    // Four different results live under RESOLVED_*, and collapsing them hides
    // which one occurred — including REJECTED, which is the one the supplier
    // most needs to be able to read.
    const view = toSupplierDisputeDetailView(
      detailRow({
        status: "RESOLVED_REJECTED",
        decisions: [
          {
            sequenceNumber: 1,
            decisionType: "REJECTED",
            decidedAt: new Date("2026-08-18T00:00:00.000Z"),
          },
        ],
      }),
      []
    );

    expect(view.decisions).toEqual([
      { sequenceNumber: 1, decisionType: "REJECTED", decidedAt: "2026-08-18T00:00:00.000Z" },
    ]);
    expect(JSON.stringify(view)).not.toContain("reasonNote");
  });

  it("carries a REPLACEMENT_OFFER response verbatim", () => {
    const view = toSupplierDisputeDetailView(
      detailRow({
        supplierResponse: {
          responseType: "REPLACEMENT_OFFER",
          description: "نرسل بديلاً",
          respondedAt: new Date("2026-08-17T00:00:00.000Z"),
        },
      }),
      []
    );

    expect(view.supplierResponse).toEqual({
      responseType: "REPLACEMENT_OFFER",
      description: "نرسل بديلاً",
      respondedAt: "2026-08-17T00:00:00.000Z",
    });
  });
});

describe("evidence is filtered in the DATABASE, and carries no storage key", () => {
  const query = supplierEvidenceQuery(DISPUTE, COMPANY);

  it("filters by the uploader's COMPANY inside the SQL", () => {
    // Reading every row and dropping the trader's afterwards puts the trader's
    // attachments in this process's memory, one logging statement away from
    // being served.
    expect(query.sql).toContain("u.company_id =");
    expect(query.values).toEqual([DISPUTE, COMPANY]);
  });

  it("filters by company, not by the single user who uploaded the file", () => {
    // A colleague who uploaded and a colleague reading later work for the same
    // company; user-scoping makes the feature useless above one person.
    expect(query.sql).not.toContain("uploaded_by_user_id =");
  });

  it("never SELECTS a storage key", () => {
    const selectClause = query.sql.slice(0, query.sql.indexOf("FROM"));

    expect(selectClause).not.toContain("storage_object_key");
  });

  it("orders evidence deterministically, terminating in the id", () => {
    expect(query.sql.replace(/\s+/g, " ")).toContain("ORDER BY de.uploaded_at ASC, de.id ASC");
  });

  it("projects an evidence row to metadata only", () => {
    const view = toSupplierDisputeDetailView(detailRow(), [
      {
        id: "e1",
        content_type: "image/jpeg",
        size_bytes: 4096,
        uploaded_at: new Date("2026-08-16T00:00:00.000Z"),
      },
    ]);

    expect(view.evidence).toEqual([
      {
        id: "e1",
        contentType: "image/jpeg",
        sizeBytes: 4096,
        uploadedAt: "2026-08-16T00:00:00.000Z",
      },
    ]);
  });

  it("carries no URL, because there is no authorised delivery endpoint", () => {
    const view = toSupplierDisputeDetailView(detailRow(), [
      { id: "e1", content_type: null, size_bytes: null, uploaded_at: new Date() },
    ]);

    expect(Object.keys(view.evidence[0]).sort()).toEqual([
      "contentType",
      "id",
      "sizeBytes",
      "uploadedAt",
    ]);
  });
});

describe("ownership lives in the query", () => {
  it("scopes a single dispute to the id AND the company together", () => {
    expect(supplierDisputeWhere(DISPUTE, COMPANY)).toEqual({
      id: DISPUTE,
      orderAllocation: { masterOrder: { supplierCompanyId: COMPANY } },
    });
  });

  it("scopes the list to disputes raised against this supplier", () => {
    expect(supplierDisputeListWhere(COMPANY)).toEqual({
      orderAllocation: { masterOrder: { supplierCompanyId: COMPANY } },
    });
  });
});

describe("awaiting a response is exactly OPEN", () => {
  it("is true while the ball is with the supplier", () => {
    expect(awaitsSupplierResponse("OPEN")).toBe(true);
    expect(toSupplierDisputeSummary(summaryRow("OPEN")).awaitingSupplierResponse).toBe(true);
  });

  it.each([
    "SUPPLIER_RESPONDED",
    "AWAITING_REPLACEMENT",
    "RESOLVED_ACCEPTED",
    "RESOLVED_PARTIAL",
    "RESOLVED_REJECTED",
    "RESOLVED_REPLACED",
  ])("is false once the dispute has moved to %s", (status) => {
    expect(awaitsSupplierResponse(status)).toBe(false);
    expect(toSupplierDisputeSummary(summaryRow(status)).awaitingSupplierResponse).toBe(false);
  });
});
