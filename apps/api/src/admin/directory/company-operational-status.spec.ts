import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMPANY_OPERATIONAL_STATUSES,
  companyOperationalStatus,
  verificationStatusesFor,
} from "@platform/types";

/**
 * WHETHER A COMPANY IS ACTUALLY OPERATING.
 *
 * The badge said «نشطة» on a supplier that had registered a minute
 * ago, submitted nothing, and could do nothing — because the rule was
 * "not suspended". These pin the rule that replaced it, and pin the
 * filter to the same function so a filtered list and the badges inside
 * it cannot contradict each other.
 */
describe("a company is active only when it is verified", () => {
  it("calls a verified company active", () => {
    expect(companyOperationalStatus("VERIFIED")).toBe("ACTIVE");
  });

  it("does NOT call a supplier awaiting verification active", () => {
    // The defect this replaces, stated as a test.
    expect(companyOperationalStatus("PENDING_VERIFICATION")).toBe("NOT_ACTIVE");
  });

  it("does not call a refused company active either", () => {
    expect(companyOperationalStatus("REJECTED")).toBe("NOT_ACTIVE");
  });

  it("keeps suspension its own answer", () => {
    // Suspended is not the same as never activated, and an operator
    // reading a list needs to tell them apart.
    expect(companyOperationalStatus("SUSPENDED")).toBe("SUSPENDED");
  });

  it("covers every verification status with no gap", () => {
    const statuses = [
      "PENDING_VERIFICATION",
      "VERIFIED",
      "REJECTED",
      "SUSPENDED",
    ] as const;

    for (const status of statuses) {
      const operational = companyOperationalStatus(status);
      expect(COMPANY_OPERATIONAL_STATUSES).toContain(operational);
      // And the round trip holds: the filter for that operational
      // value returns a set containing the status it came from.
      expect(verificationStatusesFor(operational)).toContain(status);
    }
  });

  it("partitions the statuses — no status answers to two filters", () => {
    const seen = new Set<string>();
    for (const operational of COMPANY_OPERATIONAL_STATUSES) {
      for (const status of verificationStatusesFor(operational)) {
        expect([status, seen.has(status)]).toEqual([status, false]);
        seen.add(status);
      }
    }
    expect(seen.size).toBe(4);
  });
});

describe("the filter and the badge read the same rule", () => {
  it("derives the query from verificationStatusesFor, not its own list", () => {
    const source = readFileSync(
      join(__dirname, "admin-directory.service.ts"),
      "utf8"
    );

    expect(source).toContain("verificationStatusesFor(");
    // The old rule, restated so it cannot come back: ACTIVE meaning
    // "anything that is not suspended".
    expect(source).not.toContain('verificationStatus: { not: "SUSPENDED"');
  });
});
