import { companyWhere } from "./admin-directory.service";

/**
 * The companies predicate, which three callers share.
 *
 * The list, the tab badges and the export all narrow by this. Three
 * copies would be three chances for a tab's number to disagree with the
 * rows under it, or for an export to carry rows the screen was not
 * showing — so the tests are on the predicate rather than on any one
 * caller.
 */

describe("companyWhere", () => {
  it("narrows by nothing when nothing was asked", () => {
    expect(companyWhere({})).toEqual({});
  });

  describe("the operational filter", () => {
    it("reads ACTIVE as verified, and nothing looser", () => {
      // THIS USED TO MEAN "anything but suspended", which returned
      // every supplier still waiting to be reviewed — rows the list
      // then drew a «نشطة» badge on. A company is operating when it
      // is verified, and a buyer is verified at registration.
      expect(companyWhere({ operationalStatus: "ACTIVE" })).toEqual({
        AND: [{ verificationStatus: { in: ["VERIFIED"] } }],
      });
    });

    it("reads NOT_ACTIVE as waiting or refused", () => {
      // Both of the ways a company can be short of running, and
      // neither of them is suspension.
      expect(companyWhere({ operationalStatus: "NOT_ACTIVE" })).toEqual({
        AND: [
          { verificationStatus: { in: ["PENDING_VERIFICATION", "REJECTED"] } },
        ],
      });
    });

    it("reads SUSPENDED as exactly that value", () => {
      expect(companyWhere({ operationalStatus: "SUSPENDED" })).toEqual({
        AND: [{ verificationStatus: { in: ["SUSPENDED"] } }],
      });
    });

    it("ignores a value that is neither", () => {
      expect(companyWhere({ operationalStatus: "MAYBE" })).toEqual({});
    });

    it("applies to a BUYER as readily as a supplier", () => {
      // A buyer is verified at registration, so ACTIVE finds it and
      // SUSPENDED still means suspended — the filter reads the same
      // column for both kinds.
      const where = companyWhere({
        accountType: "TRADER",
        operationalStatus: "SUSPENDED",
      });

      expect(where).toEqual({
        accountType: "TRADER",
        AND: [{ verificationStatus: { in: ["SUSPENDED"] } }],
      });
    });
  });

  describe("the registration date range", () => {
    it("takes a lower bound from the start of that day", () => {
      const where = companyWhere({ registeredFrom: "2026-08-25" });

      expect(where.createdAt).toEqual({
        gte: new Date("2026-08-25T00:00:00.000Z"),
      });
    });

    it("takes an upper bound INCLUSIVE of the day named", () => {
      const where = companyWhere({ registeredTo: "2026-08-25" });

      // A reader who picks the 25th means everything registered that
      // day; `lte` on midnight would return only its first instant.
      expect(where.createdAt).toEqual({
        lte: new Date("2026-08-25T23:59:59.999Z"),
      });
    });

    it("takes both together as one range", () => {
      const where = companyWhere({
        registeredFrom: "2026-01-01",
        registeredTo: "2026-12-31",
      });

      expect(where.createdAt).toEqual({
        gte: new Date("2026-01-01T00:00:00.000Z"),
        lte: new Date("2026-12-31T23:59:59.999Z"),
      });
    });

    it("adds no date predicate when neither bound was given", () => {
      expect(companyWhere({ search: "x" }).createdAt).toBeUndefined();
    });
  });

  describe("search", () => {
    it("looks in the name case-insensitively and in the registration exactly", () => {
      const where = companyWhere({ search: "نهضة" });

      expect(where.OR).toEqual([
        { legalName: { contains: "نهضة", mode: "insensitive" } },
        { crNumber: { contains: "نهضة" } },
      ]);
    });

    it("ignores a search of only spaces", () => {
      expect(companyWhere({ search: "   " })).toEqual({});
    });
  });

  it("combines every filter into one predicate", () => {
    const where = companyWhere({
      search: "نهضة",
      accountType: "SUPPLIER",
      verificationStatus: "PENDING_VERIFICATION",
      operationalStatus: "ACTIVE",
      registeredFrom: "2026-01-01",
    });

    expect(where.accountType).toBe("SUPPLIER");
    expect(where.OR).toHaveLength(2);
    expect(where.createdAt).toBeDefined();
    // BOTH status conditions survive. Written as two keys of one object
    // the second would have replaced the first, and "pending AND
    // running" would have returned every unsuspended company.
    expect(where.AND).toEqual([
      { verificationStatus: "PENDING_VERIFICATION" },
      { verificationStatus: { in: ["VERIFIED"] } },
    ]);
  });

  it("keeps a contradiction as a contradiction rather than dropping half of it", () => {
    // "Suspended AND pending verification" describes no company, because
    // one column cannot hold both. Returning nothing is the truthful
    // answer; returning every suspended company would not be.
    const where = companyWhere({
      verificationStatus: "PENDING_VERIFICATION",
      operationalStatus: "SUSPENDED",
    });

    expect(where.AND).toEqual([
      { verificationStatus: "PENDING_VERIFICATION" },
      { verificationStatus: { in: ["SUSPENDED"] } },
    ]);
  });
});
