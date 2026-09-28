/* eslint-disable @typescript-eslint/no-explicit-any -- the Prisma row shape
   is faked here; typing each fixture precisely would restate the client's
   generated types without testing anything. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { OPPORTUNITY_REASON_CODES } from "@platform/domain";
import {
  MONEY_STRING_PATTERN,
  SUPPLIER_OPPORTUNITY_DETAIL_KEYS,
  SUPPLIER_OPPORTUNITY_REASON_CODES,
  SUPPLIER_OPPORTUNITY_STATUSES,
  SUPPLIER_OPPORTUNITY_SUMMARY_KEYS,
  isMoneyString,
} from "@platform/types";
import {
  SUPPLIER_OPPORTUNITY_DETAIL_SELECT,
  SUPPLIER_OPPORTUNITY_SUMMARY_SELECT,
  ownedOpportunityWhere,
  toSupplierOpportunityDetail,
  toSupplierOpportunitySummary,
} from "./supplier-opportunity.view";

/**
 * The supplier's own opportunities, projected.
 *
 * Two defects this replaces, both invisible because the old function looked
 * like a projection: every money field went through `Decimal.toNumber()`,
 * and it mapped a RAW row read with no `select` at all.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const OPPORTUNITY = "22222222-2222-4222-8222-222222222222";

function summaryRow(overrides: Record<string, any> = {}) {
  return {
    id: OPPORTUNITY,
    productId: "77777777-7777-4777-8777-777777777777",
    // ONE PICTURE, the main one. The list shows a supplier their own
    // photograph, through the route scoped to their company rather
    // than the public one — which serves ACTIVE offers only and would
    // answer 404 for a draft to the person who owns it.
    product: {
      nameAr: "زيت زيتون",
      nameEn: "Olive oil",
      media: [{ id: "88888888-8888-4888-8888-888888888888" }],
    },
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    status: "ACTIVE",
    reasonCode: null,
    targetQuantity: 100,
    fundedQuantity: 40,
    unitPriceAmount: new Prisma.Decimal("11.5"),
    currency: "SAR",
    startAt: new Date("2026-08-01T00:00:00.000Z"),
    endAt: new Date("2026-08-20T00:00:00.000Z"),
    extendedAt: null,
    createdAt: new Date("2026-07-25T00:00:00.000Z"),
    ...overrides,
  };
}

function detailRow(overrides: Record<string, any> = {}) {
  return {
    ...summaryRow(),
    descriptionAr: "وصف",
    descriptionEn: "Description",
    expectedPreparationDays: 3,
    fulfillmentLocationId: "33333333-3333-4333-8333-333333333333",
    fulfillmentCityNameAr: "الرياض",
    fulfillmentCityNameEn: "Riyadh",
    fulfillmentRegionNameAr: "منطقة الرياض",
    fulfillmentRegionNameEn: "Riyadh Region",
    taxRatePercent: new Prisma.Decimal("15"),
    unitPriceExclTaxAmount: new Prisma.Decimal("10"),
    unitTaxAmount: new Prisma.Decimal("1.5"),
    totalValueInclTaxAmount: new Prisma.Decimal("1150"),
    shareBasisPoints: 1000,
    shareQuantity: 10,
    firstActivatedAt: new Date("2026-08-01T00:00:00.000Z"),
    pausedAt: null,
    blockedAt: null,
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    ...overrides,
  };
}

describe("the projected opportunity carries exactly its contract", () => {
  it("returns the declared summary keys — no more, no less", () => {
    expect(Object.keys(toSupplierOpportunitySummary(summaryRow() as never)).sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_SUMMARY_KEYS].sort()
    );
  });

  it("returns the declared detail keys", () => {
    expect(Object.keys(toSupplierOpportunityDetail(detailRow() as never)).sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_DETAIL_KEYS].sort()
    );
  });
});

describe("money is a fixed-scale decimal string, never a float", () => {
  it("renders all four amounts at scale two", () => {
    const detail = toSupplierOpportunityDetail(detailRow() as never);

    // 11.5 must serialise as "11.50". A trimmed trailing zero is the
    // shape that gets re-parsed as a float somewhere downstream.
    expect(detail.unitPriceAmount).toBe("11.50");
    expect(detail.unitPriceExclTaxAmount).toBe("10.00");
    expect(detail.unitTaxAmount).toBe("1.50");
    expect(detail.totalValueInclTaxAmount).toBe("1150.00");

    for (const value of [
      detail.unitPriceAmount,
      detail.unitPriceExclTaxAmount,
      detail.unitTaxAmount,
      detail.totalValueInclTaxAmount,
    ]) {
      expect(typeof value).toBe("string");
      expect(value).toMatch(MONEY_STRING_PATTERN);
      expect(isMoneyString(value)).toBe(true);
    }
  });

  it("keeps a value JSON's binary double cannot hold", () => {
    // 0.1 + 0.2 territory: the point of the string is that the digits
    // that left the database are the digits that arrive.
    const detail = toSupplierOpportunityDetail(
      detailRow({ unitPriceAmount: new Prisma.Decimal("1234567890.12") }) as never
    );

    expect(detail.unitPriceAmount).toBe("1234567890.12");
    expect(JSON.parse(JSON.stringify(detail)).unitPriceAmount).toBe("1234567890.12");
  });

  it("reports an unpublished listing's tax fields as null, not zero", () => {
    // These are frozen at publish time. A zero would be a claim that no
    // tax applies.
    const detail = toSupplierOpportunityDetail(
      detailRow({
        status: "DRAFT",
        taxRatePercent: null,
        unitPriceExclTaxAmount: null,
        unitTaxAmount: null,
        totalValueInclTaxAmount: null,
        shareBasisPoints: null,
        shareQuantity: null,
        firstActivatedAt: null,
        fulfillmentCityNameAr: null,
        fulfillmentCityNameEn: null,
        fulfillmentRegionNameAr: null,
        fulfillmentRegionNameEn: null,
      }) as never
    );

    expect(detail.unitPriceExclTaxAmount).toBeNull();
    expect(detail.unitTaxAmount).toBeNull();
    expect(detail.totalValueInclTaxAmount).toBeNull();
    expect(detail.taxRatePercent).toBeNull();
    expect(detail.sharePercentage).toBeNull();
    // The price itself is set at creation and is never null.
    expect(detail.unitPriceAmount).toBe("11.50");
  });

  it("renders the tax RATE at its own scale, because it is not money", () => {
    expect(toSupplierOpportunityDetail(detailRow() as never).taxRatePercent).toBe("15.00");
  });

  it("uses no float conversion anywhere in the serializer", () => {
    const source = readFileSync(join(__dirname, "supplier-opportunity.view.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(code).not.toContain("toNumber");
    expect(code).not.toContain("parseFloat");
    expect(code).not.toMatch(/Number\(/);
    expect(code).toContain("toFixed(2)");
  });

  it("left no supplier-facing serializer behind in the service", () => {
    const source = readFileSync(join(__dirname, "opportunities.service.ts"), "utf8");

    expect(source).not.toContain("toSupplierOpportunityView");
    expect(source).not.toContain("SupplierOpportunityView");
  });

  it("returns the projection from every controller handler, never a raw row", () => {
    // The write methods return the FULL row on purpose — they need the
    // pinned policy versions — so each handler re-reads through the
    // projection rather than mapping what it happens to hold.
    const source = readFileSync(join(__dirname, "opportunities.controller.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    const returns = code.match(/return this\.opportunities\.(\w+)/g) ?? [];
    expect(returns.length).toBeGreaterThan(0);

    /**
     * TWO WAYS TO SATISFY THE RULE, and the rule itself has not moved:
     * what leaves a handler is a PROJECTION, never a row.
     *
     * The first way is to re-read through `getOwnedProjected`, which is
     * what every handler that only changes a status does.
     *
     * The second arrived with the direct-sale actions. `setDirectStock`
     * answers with the listing AND the stock left on it — a number it
     * computed under the row lock and that a second read could not
     * reproduce — and `stopDirect` answers from inside its own
     * transaction. Both map through `toSupplierOpportunityDetail`
     * themselves, so requiring the NAME to say `Projected` would have
     * forced a second query whose only purpose was to satisfy a regex.
     *
     * So the service is read: a method named here must project, one way
     * or the other.
     */
    const service = readFileSync(join(__dirname, "opportunities.service.ts"), "utf8");
    for (const statement of returns) {
      const method = statement.replace("return this.opportunities.", "");
      if (/Projected/.test(method)) continue;

      const body = service.match(
        new RegExp(`\\n  async ${method}\\(([\\s\\S]*?)\\n  \\}\\n`)
      );
      expect([method, body !== null]).toEqual([method, true]);
      expect([method, body![1].includes("toSupplierOpportunityDetail(")]).toEqual([method, true]);
    }

    // `getOwned` hands back the full row and must not be a handler's
    // return value.
    expect(code).not.toMatch(/return this\.opportunities\.getOwned\(/);
    expect(code).not.toContain("toSupplierOpportunity");
  });

  it("does not convert money for the RESPONSE anywhere in the service", () => {
    const source = readFileSync(join(__dirname, "opportunities.service.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    // ONE conversion remains after the Financial Precision Delta, and it
    // is threshold selection only — its result picks a tier INDEX and is
    // never written to a money column. The two that fed the tax
    // computation were removed: both now pass a decimal string.
    //
    // Pinned as an exact set so a second cannot appear unnoticed.
    const sites = code
      .split("\n")
      .filter((line) => /\.toNumber\(\)/.test(line))
      .map((line) => line.trim());

    expect(sites).toEqual([
      // -> selectTier(total), which picks a share-tier band by comparison
      "const totalValueForTierSelection = totalValueDecimal.toNumber();",
    ]);
  });
});

describe("nothing internal crosses the wire", () => {
  const FORBIDDEN = [
    "shareTierPolicyVersionId",
    "shareTierIndex",
    "shareBasisPoints",
    "commissionPolicyVersionId",
    "commissionRateBasisPoints",
    "productApprovalSnapshotId",
    "companyId",
    "fulfillmentCityId",
    "fulfillmentRegionId",
    "pauseReason",
    "cancelReason",
    "reasonDetails",
    "taxCalculationRuleCode",
    "taxCalculationRuleVersion",
  ];

  it.each(FORBIDDEN)("never serialises %s", (field) => {
    const serialised = JSON.stringify(toSupplierOpportunityDetail(detailRow() as never));

    expect(serialised).not.toContain(field);
  });

  it("never SELECTS any of them either — except the one it must derive from", () => {
    // Not selecting is stronger than not mapping. `shareBasisPoints` is
    // the single exception: `sharePercentage` cannot be computed without
    // it, and the raw value is dropped by the mapper.
    for (const select of [
      JSON.stringify(SUPPLIER_OPPORTUNITY_SUMMARY_SELECT),
      JSON.stringify(SUPPLIER_OPPORTUNITY_DETAIL_SELECT),
    ]) {
      for (const field of FORBIDDEN.filter((f) => f !== "shareBasisPoints")) {
        expect([field, select.includes(field)]).toEqual([field, false]);
      }
    }

    expect(JSON.stringify(SUPPLIER_OPPORTUNITY_SUMMARY_SELECT)).not.toContain("shareBasisPoints");
  });

  it("derives sharePercentage and drops the basis points", () => {
    const detail = toSupplierOpportunityDetail(detailRow() as never);

    expect(detail.sharePercentage).toBe(10);
    expect(detail.shareQuantity).toBe(10);
    expect(detail).not.toHaveProperty("shareBasisPoints");
  });

  it("names no trader, order, checkout or payment", () => {
    const serialised = JSON.stringify(toSupplierOpportunityDetail(detailRow() as never));

    for (const forbidden of ["trader", "checkoutSession", "paymentAttempt", "masterOrder"]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("carries fundedQuantity, which is the one demand signal a supplier needs", () => {
    // How much of their own supply cap has sold. Not who bought it.
    expect(toSupplierOpportunitySummary(summaryRow() as never).fundedQuantity).toBe(40);
  });

  it("selects the frozen city and region NAMES, not the ids behind them", () => {
    const select = JSON.stringify(SUPPLIER_OPPORTUNITY_DETAIL_SELECT);

    expect(select).toContain("fulfillmentCityNameAr");
    expect(select).not.toContain("fulfillmentCityId");
  });
});

describe("ACTION_REQUIRED gives a code, never the operator's details", () => {
  it("passes the code through", () => {
    const detail = toSupplierOpportunityDetail(
      detailRow({
        status: "ACTION_REQUIRED",
        reasonCode: "PURCHASE_QUANTITY_NOT_COMPATIBLE",
        blockedAt: new Date("2026-08-05T00:00:00.000Z"),
      }) as never
    );

    expect(detail.status).toBe("ACTION_REQUIRED");
    expect(detail.reasonCode).toBe("PURCHASE_QUANTITY_NOT_COMPATIBLE");
    expect(detail.blockedAt).toBe("2026-08-05T00:00:00.000Z");
  });

  it("is null in every other state", () => {
    expect(toSupplierOpportunitySummary(summaryRow() as never).reasonCode).toBeNull();
  });
});

describe("the wire vocabularies match the real ones", () => {
  it("lists all eight opportunity statuses", () => {
    expect([...SUPPLIER_OPPORTUNITY_STATUSES].sort()).toEqual([
      "ACTION_REQUIRED",
      "ACTIVE",
      "CANCELLED",
      "DRAFT",
      "EXPIRED",
      "FUNDED",
      "PAUSED",
      "SCHEDULED",
    ]);
  });

  it("matches the Prisma enum exactly", () => {
    const schema = readFileSync(join(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");
    const block = schema.match(/enum OpportunityStatus \{([^}]*)\}/)![1];
    const values = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    expect(values.sort()).toEqual([...SUPPLIER_OPPORTUNITY_STATUSES].sort());
  });

  it("lists all eleven ACTION_REQUIRED reason codes, matching @platform/domain", () => {
    // The shared contract restates them so a web client can translate
    // every one without depending on a server-side package. This is what
    // keeps the restatement honest.
    expect([...SUPPLIER_OPPORTUNITY_REASON_CODES].sort()).toEqual(
      Object.values(OPPORTUNITY_REASON_CODES).sort()
    );
    // ELEVEN since LOCATION_REGION_INACTIVE joined it. The region is
    // what blocks a listing now; the city code stays because listings
    // blocked under the old rule still carry it.
    expect(SUPPLIER_OPPORTUNITY_REASON_CODES).toHaveLength(11);
  });
});

describe("ownership lives in the query", () => {
  it("filters by the caller's company", () => {
    expect(ownedOpportunityWhere(COMPANY)).toEqual({ companyId: COMPANY });
  });
});
