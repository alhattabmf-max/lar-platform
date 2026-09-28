import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CompanyDeletionEligibilityService } from "./company-deletion-eligibility.service";

/**
 * WHAT KEEPS A COMPANY ON THE PLATFORM.
 *
 * This refused a removal because the company had a bank account, or
 * had accepted the terms, or had ever opened a checkout — so a company
 * that registered, filled its record in and never traded could not be
 * removed at all, which is the one case the feature was for.
 *
 * The counts are read in one `$transaction([...])`, in a fixed order,
 * so a test can hand back an array and know which number lands where.
 * That order is asserted first: if somebody inserts a count in the
 * middle, every case below would silently be testing the wrong rule.
 */

/** The reads, in the order `check` issues them. */
const READS = [
  "activeOrFundedProducts",
  "liveOrders",
  "openDisputes",
  "heldAtCheckout",
  "paymentsInFlight",
  "incompleteRefunds",
  "incompleteSettlements",
  "ordersEverPlaced",
  "paymentsEverTaken",
  "productReports",
] as const;

const NOTHING = READS.map(() => 0);

function serviceReturning(counts: number[]) {
  return new CompanyDeletionEligibilityService({
    opportunity: { count: () => 0 },
    masterOrder: { count: () => 0 },
    dispute: { count: () => 0 },
    checkoutSession: { count: () => 0 },
    paymentAttempt: { count: () => 0 },
    refundObligation: { count: () => 0 },
    orderAllocation: { count: () => 0 },
    productReport: { count: () => 0 },
    $transaction: async () => counts,
  } as never);
}

/** One read set to n, everything else zero. */
function only(read: (typeof READS)[number], n: number): number[] {
  const counts = [...NOTHING];
  counts[READS.indexOf(read)] = n;
  return counts;
}

describe("the order of the reads", () => {
  it("is what the service actually issues", () => {
    const source = readFileSync(
      join(__dirname, "company-deletion-eligibility.service.ts"),
      "utf8"
    );
    const destructured = source
      .slice(source.indexOf("const ["), source.indexOf("] = await"))
      .replace("const [", "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");

    // If this fails, every case below is testing the wrong rule.
    expect(destructured).toEqual([...READS]);
  });
});

describe("a company that owes nothing can be removed", () => {
  it("allows it when there is nothing outstanding at all", async () => {
    const result = await serviceReturning(NOTHING).check("company-a");
    expect(result).toEqual({ allowed: true, blockers: [] });
  });
});

describe("what stops a removal", () => {
  const cases: ReadonlyArray<
    readonly [(typeof READS)[number], string, string]
  > = [
    ["activeOrFundedProducts", "ACTIVE_OR_FUNDED_PRODUCTS", "a live or funded product"],
    ["liveOrders", "LIVE_ORDERS", "an order still running"],
    ["openDisputes", "OPEN_DISPUTES", "a dispute nobody has finished with"],
    ["heldAtCheckout", "AMOUNTS_DUE_OR_HELD", "money or stock held at checkout"],
    ["paymentsInFlight", "AMOUNTS_DUE_OR_HELD", "a payment still in flight"],
    ["incompleteRefunds", "INCOMPLETE_REFUNDS", "a refund that has not landed"],
    ["incompleteSettlements", "INCOMPLETE_SETTLEMENTS", "a settlement not made"],
  ];

  for (const [read, kind, description] of cases) {
    it(`refuses on ${description}`, async () => {
      const result = await serviceReturning(only(read, 3)).check("company-a");
      expect(result.allowed).toBe(false);
      expect(result.blockers).toEqual([{ kind, count: 3 }]);
    });
  }

  it("adds the two amounts together under one heading", async () => {
    // «مبلغ مستحق أو محجوز» is one thing to an operator, counted from
    // two places: a lock at checkout and a payment mid-flight.
    const counts = [...NOTHING];
    counts[READS.indexOf("heldAtCheckout")] = 2;
    counts[READS.indexOf("paymentsInFlight")] = 3;

    const result = await serviceReturning(counts).check("company-a");
    expect(result.blockers).toEqual([{ kind: "AMOUNTS_DUE_OR_HELD", count: 5 }]);
  });

  it("names every reason at once, not the first one it meets", async () => {
    // An operator told to fix one thing, who then meets a second, has
    // been made to do the work twice.
    const counts = [...NOTHING];
    counts[READS.indexOf("liveOrders")] = 1;
    counts[READS.indexOf("openDisputes")] = 2;

    const result = await serviceReturning(counts).check("company-a");
    expect(result.blockers.map((blocker) => blocker.kind)).toEqual([
      "LIVE_ORDERS",
      "OPEN_DISPUTES",
    ]);
  });
});

describe("what the database itself stops", () => {
  it("refuses once the company has traded", async () => {
    // Not policy. A master order points at the supplier's bank account
    // and at the checkout session it came from, ON DELETE RESTRICT.
    const result = await serviceReturning(only("ordersEverPlaced", 7)).check("c");
    expect(result.blockers).toEqual([{ kind: "FINANCIAL_RECORDS", count: 7 }]);
  });

  it("counts a payment attempt as a financial record too", async () => {
    // It points at the policy acceptance in force when it was taken,
    // and carries the refunds and provider events behind it.
    const result = await serviceReturning(only("paymentsEverTaken", 2)).check("c");
    expect(result.blockers).toEqual([{ kind: "FINANCIAL_RECORDS", count: 2 }]);
  });

  it("refuses while a report names one of its products", async () => {
    const result = await serviceReturning(only("productReports", 1)).check("c");
    expect(result.blockers).toEqual([{ kind: "PRODUCT_REPORTS", count: 1 }]);
  });
});

describe("what is no longer a blocker", () => {
  it("does not count a bank account, a branch, a profile or a policy", () => {
    // THE DEFECT THIS REPLACES, stated from the source: a company that
    // never traded was unremovable because it had done the ordinary
    // things every company does.
    const source = readFileSync(
      join(__dirname, "company-deletion-eligibility.service.ts"),
      "utf8"
    );
    const code = source
      .replace(new RegExp("/\\*[\\s\\S]*?\\*/", "g"), "")
      .replace(new RegExp("(^|[^:])//.*$", "gm"), "$1");

    expect(code).not.toContain("supplierBankAccount.count");
    expect(code).not.toContain("policyAcceptance.count");
    expect(code).not.toContain("supplierTaxProfile.count");
    expect(code).not.toContain("traderTaxProfile.count");
    expect(code).not.toContain("supplierInvoicingProfile.count");
    expect(code).not.toContain("companyLocation.count");
    // A product with no obligation on it is a row that exists because
    // the company does.
    expect(code).not.toContain("product.count");
  });

  it("counts a checkout only while it is holding something", async () => {
    // An abandoned or expired lock holds nothing and stops nothing.
    const source = readFileSync(
      join(__dirname, "company-deletion-eligibility.service.ts"),
      "utf8"
    );
    expect(source).toContain("HOLDING_STATUSES");
    expect(source).toContain("CheckoutSessionStatus.LOCKED");
    expect(source).toContain("CheckoutSessionStatus.PAYMENT_PENDING");
    expect(source).not.toContain("CheckoutSessionStatus.ABANDONED");
  });
});
