/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma client
   surface is faked here; typing each mock precisely would restate the
   client's types without testing anything. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NotFoundException } from "@nestjs/common";
import {
  DISPUTE_EVIDENCE_VIEW_KEYS,
  DISPUTE_STATUSES,
  TRADER_DISPUTE_DETAIL_VIEW_KEYS,
} from "@platform/types";
import { DisputeService } from "./dispute.service";
import {
  TRADER_DISPUTE_SELECT,
  toTraderDisputeDetailView,
  traderDisputeWhere,
  traderEvidenceQuery,
} from "./trader-dispute.view";

/**
 * What a trader may see of a dispute.
 *
 * Three parties write into one, so the boundary is per SOURCE: the
 * trader's own words, the supplier's reply to them, the outcome of the
 * decision — and, of the evidence, only their own company's, only as
 * metadata.
 */

const TRADER_COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "99999999-9999-9999-9999-999999999999";
const DISPUTE = "22222222-2222-2222-2222-222222222222";
const ORDER = "33333333-3333-3333-3333-333333333333";
const ALLOCATION = "44444444-4444-4444-4444-444444444444";

function disputeRow(overrides: Record<string, any> = {}) {
  return {
    id: DISPUTE,
    orderAllocationId: ALLOCATION,
    reasonCode: "ITEM_DAMAGED",
    description: "Two cartons arrived crushed.",
    status: "SUPPLIER_RESPONDED",
    supplierResponseDueAt: new Date("2026-08-25T00:00:00.000Z"),
    openedAt: new Date("2026-08-20T00:00:00.000Z"),
    orderAllocation: { masterOrderId: ORDER },
    supplierResponse: {
      responseType: "REJECT",
      description: "The cartons left our warehouse sealed.",
      respondedAt: new Date("2026-08-22T00:00:00.000Z"),
    },
    decisions: [],
    ...overrides,
  };
}

function evidenceRow(overrides: Record<string, any> = {}) {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    content_type: "image/jpeg",
    size_bytes: 204_800,
    uploaded_at: new Date("2026-08-20T01:00:00.000Z"),
    ...overrides,
  };
}

describe("the trader dispute view carries exactly its contract", () => {
  it("returns the declared keys — no more, no less", () => {
    const view = toTraderDisputeDetailView(disputeRow() as any, [evidenceRow()]);

    expect(Object.keys(view).sort()).toEqual([...TRADER_DISPUTE_DETAIL_VIEW_KEYS].sort());
    expect(Object.keys(view.evidence[0]).sort()).toEqual([...DISPUTE_EVIDENCE_VIEW_KEYS].sort());
  });

  it("carries no storage key, path or uploader anywhere", () => {
    // A storage key is an internal address. Exposing one tells a client
    // where the platform keeps its files and invites a request built
    // from it — and there is no authorised delivery endpoint to pair it
    // with anyway.
    const serialised = JSON.stringify(
      toTraderDisputeDetailView(disputeRow() as any, [evidenceRow()])
    );

    for (const forbidden of [
      "storageObjectKey",
      "storage_object_key",
      "objectKey",
      "thumbnailObjectKey",
      "dispute-evidence/",
      "bucket",
      "uploadedByUserId",
      "uploaded_by_user_id",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("carries no download URL it could only have forged", () => {
    const serialised = JSON.stringify(
      toTraderDisputeDetailView(disputeRow() as any, [evidenceRow()])
    );

    expect(serialised).not.toContain("http");
    expect(serialised).not.toMatch(/"url"|"href"|"downloadUrl"/);
  });

  it("withholds the administrator's internal note and identity", () => {
    // `reasonNote` is written for the platform's own record, not as
    // correspondence with either party. Naming the deciding member of
    // staff invites pressure on an individual.
    const view = toTraderDisputeDetailView(
      disputeRow({
        decisions: [
          {
            sequenceNumber: 1,
            decisionType: "PARTIAL_REFUND",
            decidedAt: new Date("2026-08-24T00:00:00.000Z"),
            reasonNote: "Supplier photos inconclusive; splitting the difference.",
            decidedByAdminUserId: "admin-1",
          },
        ],
      }) as any,
      []
    );

    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain("reasonNote");
    expect(serialised).not.toContain("Supplier photos inconclusive");
    expect(serialised).not.toContain("decidedByAdminUserId");
    expect(serialised).not.toContain("admin-1");

    expect(Object.keys(view.decisions[0]).sort()).toEqual([
      "decidedAt",
      "decisionType",
      "sequenceNumber",
    ]);
  });

  it("includes the supplier's reply, which is addressed to the trader", () => {
    // Withholding it would tell someone they lost without telling them
    // why. It is counterparty free text, which is a rendering
    // constraint on the consumer, not a reason to drop it.
    const view = toTraderDisputeDetailView(disputeRow() as any, []);

    expect(view.supplierResponse).toEqual({
      responseType: "REJECT",
      description: "The cartons left our warehouse sealed.",
      respondedAt: "2026-08-22T00:00:00.000Z",
    });
    expect(JSON.stringify(view)).not.toContain("respondedByUserId");
  });

  it("handles a dispute with no reply yet", () => {
    const view = toTraderDisputeDetailView(disputeRow({ supplierResponse: null }) as any, []);
    expect(view.supplierResponse).toBeNull();
  });

  it("keeps the trader's own description", () => {
    expect(toTraderDisputeDetailView(disputeRow() as any, []).description).toBe(
      "Two cartons arrived crushed."
    );
  });

  it("carries the order id, so the UI can link back without a second read", () => {
    expect(toTraderDisputeDetailView(disputeRow() as any, []).orderId).toBe(ORDER);
  });

  it("survives an evidence row whose upload record is missing", () => {
    // The upload row holds the metadata; the evidence still exists
    // without it and should still be listed, with nulls.
    const view = toTraderDisputeDetailView(
      disputeRow() as any,
      [evidenceRow({ content_type: null, size_bytes: null })]
    );

    expect(view.evidence[0].contentType).toBeNull();
    expect(view.evidence[0].sizeBytes).toBeNull();
    expect(view.evidence[0].id).toBeTruthy();
  });
});

describe("the four RESOLVED_* outcomes stay distinct", () => {
  it.each(DISPUTE_STATUSES.filter((s) => s.startsWith("RESOLVED_")))(
    "%s reaches the view unchanged",
    (status) => {
      // Refunded in full, refunded in part, refused, and replaced are
      // four different results. Collapsing them to "resolved" hides
      // which one actually happened.
      const view = toTraderDisputeDetailView(disputeRow({ status }) as any, []);

      expect(view.status).toBe(status);
      expect(view.status).not.toBe("RESOLVED");
    }
  );

  it("keeps all four in the contract, not folded into one", () => {
    const resolved = DISPUTE_STATUSES.filter((s) => s.startsWith("RESOLVED_"));
    expect(resolved).toEqual([
      "RESOLVED_ACCEPTED",
      "RESOLVED_PARTIAL",
      "RESOLVED_REJECTED",
      "RESOLVED_REPLACED",
    ]);
  });

  it("passes the decision type through exactly", () => {
    const view = toTraderDisputeDetailView(
      disputeRow({
        decisions: [
          { sequenceNumber: 1, decisionType: "FULL_REFUND", decidedAt: new Date() },
          { sequenceNumber: 2, decisionType: "REPLACEMENT", decidedAt: new Date() },
        ],
      }) as any,
      []
    );

    expect(view.decisions.map((d) => d.decisionType)).toEqual(["FULL_REFUND", "REPLACEMENT"]);
  });
});

describe("ownership lives in the query", () => {
  it("scopes through the allocation's order to the trader company", () => {
    expect(traderDisputeWhere(DISPUTE, TRADER_COMPANY)).toEqual({
      id: DISPUTE,
      orderAllocation: { masterOrder: { traderCompanyId: TRADER_COMPANY } },
    });
  });

  it("selects no internal decision or response field from the database", () => {
    // Not selecting is stronger than not mapping: a column never read
    // cannot be leaked by a later refactor that spreads.
    const decisionColumns = Object.keys(TRADER_DISPUTE_SELECT.decisions.select);
    expect(decisionColumns).not.toContain("reasonNote");
    expect(decisionColumns).not.toContain("decidedByAdminUserId");

    const responseColumns = Object.keys(TRADER_DISPUTE_SELECT.supplierResponse.select);
    expect(responseColumns).not.toContain("respondedByUserId");

    // The evidence relation is absent entirely: it needs a filter this
    // select cannot express, so it is read separately.
    expect(Object.keys(TRADER_DISPUTE_SELECT)).not.toContain("evidence");
  });

  it("orders decisions by their sequence, which is what makes them a history", () => {
    expect(TRADER_DISPUTE_SELECT.decisions.orderBy).toEqual({ sequenceNumber: "asc" });
  });

  it("answers a cross-company dispute with 404, the same as an unknown one", async () => {
    const findFirst = jest.fn(async (..._args: any[]) => null);
    const service = new DisputeService(
      { dispute: { findFirst }, $queryRaw: jest.fn(async () => []) } as any,
      {} as any
    );

    await expect(service.getForTrader(DISPUTE, OTHER_COMPANY)).rejects.toBeInstanceOf(
      NotFoundException
    );
    // The scoped WHERE means the row simply is not found. A 403 would
    // confirm the dispute exists and belongs to someone.
    expect((findFirst.mock.calls[0][0] as any).where).toEqual(
      traderDisputeWhere(DISPUTE, OTHER_COMPANY)
    );
  });
});

describe("evidence is filtered by COMPANY, in the database", () => {
  const sql = traderEvidenceQuery(DISPUTE, TRADER_COMPANY).sql;

  it("joins users and filters on company_id", () => {
    // Company-scoped, not user-scoped: a colleague who opened the
    // dispute and a colleague reading it later work for the same
    // company, and hiding one from the other makes the feature useless
    // for any company with more than one person.
    expect(sql).toContain("JOIN users u ON u.id = de.uploaded_by_user_id");
    expect(sql).toContain("u.company_id =");
  });

  it("filters in SQL rather than fetching everything and discarding", () => {
    // Reading every row and dropping the supplier's afterwards puts
    // their attachments in the process's memory, one logging statement
    // away from being served.
    expect(sql).toContain("WHERE de.dispute_id =");
    expect(sql).not.toMatch(/SELECT \*/);
  });

  it("selects no storage key even into memory", () => {
    expect(sql).not.toContain("de.storage_object_key,");
    expect(sql).not.toMatch(/SELECT[\s\S]*storage_object_key[\s\S]*FROM/);
  });

  it("LEFT joins the upload metadata, so evidence survives a missing row", () => {
    expect(sql).toContain("LEFT JOIN evidence_uploads");
    expect(sql).toContain("eu.storage_object_key = de.storage_object_key");
  });

  it("orders deterministically, terminating in the primary key", () => {
    expect(sql).toContain("ORDER BY de.uploaded_at ASC, de.id ASC");
  });

  it("parameterises both ids rather than interpolating them", () => {
    // `Prisma.sql` produces bound parameters; the ids must never appear
    // as literal text in the statement.
    const query = traderEvidenceQuery(DISPUTE, TRADER_COMPANY);
    expect(query.sql).not.toContain(DISPUTE);
    expect(query.sql).not.toContain(TRADER_COMPANY);
    expect(query.values).toEqual([DISPUTE, TRADER_COMPANY]);
  });
});

describe("the service reads evidence through that query", () => {
  function build(evidence: unknown[]) {
    const queryRaw = jest.fn(async (..._args: any[]) => evidence);
    const findFirst = jest.fn(async (..._args: any[]) => disputeRow());
    const service = new DisputeService(
      { dispute: { findFirst }, $queryRaw: queryRaw } as any,
      {} as any
    );
    return { service, queryRaw };
  }

  it("returns the company's own evidence", async () => {
    const { service } = build([evidenceRow()]);

    const view = await service.getForTrader(DISPUTE, TRADER_COMPANY);

    expect(view.evidence).toHaveLength(1);
    expect(view.evidence[0]).toEqual({
      id: "55555555-5555-5555-5555-555555555555",
      contentType: "image/jpeg",
      sizeBytes: 204_800,
      uploadedAt: "2026-08-20T01:00:00.000Z",
    });
  });

  it("passes the caller's company into the filter", async () => {
    const { service, queryRaw } = build([]);

    await service.getForTrader(DISPUTE, TRADER_COMPANY);

    expect(queryRaw.mock.calls[0][0]).toEqual(traderEvidenceQuery(DISPUTE, TRADER_COMPANY));
  });

  it("returns an empty list when only the supplier attached anything", async () => {
    // The supplier's rows never come back from the query at all, so
    // there is nothing to filter out here.
    const { service } = build([]);

    expect((await service.getForTrader(DISPUTE, TRADER_COMPANY)).evidence).toEqual([]);
  });
});

describe("the source keeps the boundary it documents", () => {
  const SOURCE = readFileSync(join(__dirname, "trader-dispute.view.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never spreads a row into the response", () => {
    expect(SOURCE).not.toMatch(/\.\.\.row\b/);
    expect(SOURCE).not.toMatch(/\.\.\.dispute\b/);
    expect(SOURCE).not.toMatch(/\.\.\.decision\b/);
  });

  it("builds no URL from a storage key", () => {
    expect(SOURCE).not.toContain("http");
    expect(SOURCE).not.toMatch(/`\/api/);
  });
});
