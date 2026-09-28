import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { OPPORTUNITY_SORTS, DEFAULT_OPPORTUNITY_SORT } from "@platform/types";
import { OpportunityDiscoveryService } from "./opportunity-discovery.service";
import { ListOpportunitiesQueryDto } from "./dto/list-opportunities-query.dto";

/**
 * Ordering is the one part of a paginated list that cannot be verified
 * by looking at a single page. These tests assert the ORDER CLAUSE that
 * reaches Prisma, because that is what decides whether page 2 is a
 * continuation of page 1 or an overlapping re-roll of it.
 */

const CITY = "11111111-1111-1111-1111-111111111111";
const NODE = "22222222-2222-2222-2222-222222222222";

function fakePrisma(
  findMany: jest.Mock,
  count: jest.Mock = jest.fn().mockResolvedValue(0),
  // A taxonomy filter widens to the node's subtree now, so the double
  // answers for the tree too. Default: a LEAF, which is what these
  // tests mean — they are about sort and composition, not about depth.
  taxonomyChildren: jest.Mock = jest.fn().mockResolvedValue([])
) {
  return {
    opportunity: { findMany, findFirst: jest.fn().mockResolvedValue(null), count },
    taxonomyNode: { findMany: taxonomyChildren },
  } as never;
}

function settingsStub() {
  return {
    getConfig: jest.fn().mockResolvedValue({ showScheduledPubliclyEnabled: false }),
  } as never;
}

function makeService(findMany: jest.Mock, count?: jest.Mock) {
  return new OpportunityDiscoveryService(fakePrisma(findMany, count), settingsStub());
}

/** Mirrors ValidationPipe in bootstrap/configure-app.ts exactly. */
async function validateQuery(raw: Record<string, unknown>) {
  const dto = plainToInstance(ListOpportunitiesQueryDto, raw, {
    enableImplicitConversion: false,
  });
  return { dto, errors: await validate(dto, { whitelist: true, forbidNonWhitelisted: true }) };
}

describe("sort — the default is NEWEST and stays that way", () => {
  it("orders by createdAt DESC when no sort is supplied", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listPublic({});

    expect(findMany.mock.calls[0][0].orderBy[0]).toEqual({ createdAt: "desc" });
  });

  it("produces the same ordering for an explicit NEWEST as for an omitted sort", async () => {
    const implicitCall = jest.fn().mockResolvedValue([]);
    const explicitCall = jest.fn().mockResolvedValue([]);

    await makeService(implicitCall).listPublic({});
    await makeService(explicitCall).listPublic({ sort: "NEWEST" });

    expect(implicitCall.mock.calls[0][0].orderBy).toEqual(explicitCall.mock.calls[0][0].orderBy);
  });

  it("keeps the wire default at NEWEST — a UI choosing otherwise must not change it", () => {
    expect(DEFAULT_OPPORTUNITY_SORT).toBe("NEWEST");
  });

  it("applies the same default to the trader list", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listForTrader({});

    expect(findMany.mock.calls[0][0].orderBy[0]).toEqual({ createdAt: "desc" });
  });
});

describe("sort — ENDING_SOON", () => {
  it("orders by endAt ASC first", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listPublic({ sort: "ENDING_SOON" });

    expect(findMany.mock.calls[0][0].orderBy[0]).toEqual({ endAt: "asc" });
  });

  it("falls back to createdAt DESC for opportunities closing at the same moment", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listPublic({ sort: "ENDING_SOON" });

    expect(findMany.mock.calls[0][0].orderBy[1]).toEqual({ createdAt: "desc" });
  });

  it("is available to the trader list too", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listForTrader({ sort: "ENDING_SOON" });

    expect(findMany.mock.calls[0][0].orderBy[0]).toEqual({ endAt: "asc" });
  });

  it("never sorts ascending by endAt in NEWEST — the two options are genuinely different", async () => {
    const newest = jest.fn().mockResolvedValue([]);
    const ending = jest.fn().mockResolvedValue([]);

    await makeService(newest).listPublic({ sort: "NEWEST" });
    await makeService(ending).listPublic({ sort: "ENDING_SOON" });

    expect(newest.mock.calls[0][0].orderBy).not.toEqual(ending.mock.calls[0][0].orderBy);
  });
});

describe("deterministic tiebreakers — every sort terminates in a unique column", () => {
  it.each(OPPORTUNITY_SORTS)("%s ends with an ordering on id", async (sort) => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listPublic({ sort });

    const orderBy = findMany.mock.calls[0][0].orderBy;
    expect(Object.keys(orderBy[orderBy.length - 1])).toEqual(["id"]);
  });

  it.each(OPPORTUNITY_SORTS)("%s names each column exactly once", async (sort) => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listPublic({ sort });

    const columns = (findMany.mock.calls[0][0].orderBy as Record<string, string>[]).flatMap((c) =>
      Object.keys(c)
    );
    expect(new Set(columns).size).toBe(columns.length);
  });

  it.each(OPPORTUNITY_SORTS)("%s uses one direction per clause, never an empty clause", async (sort) => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listPublic({ sort });

    for (const clause of findMany.mock.calls[0][0].orderBy as Record<string, string>[]) {
      expect(Object.keys(clause)).toHaveLength(1);
      expect(["asc", "desc"]).toContain(Object.values(clause)[0]);
    }
  });

  it("uses the identical id direction across sorts, so the tiebreak never flips", async () => {
    const directions = await Promise.all(
      OPPORTUNITY_SORTS.map(async (sort) => {
        const findMany = jest.fn().mockResolvedValue([]);
        await makeService(findMany).listPublic({ sort });
        const orderBy = findMany.mock.calls[0][0].orderBy;
        return orderBy[orderBy.length - 1].id;
      })
    );

    expect(new Set(directions).size).toBe(1);
  });
});

describe("pagination cannot produce duplicate or unstable ordering", () => {
  it.each(OPPORTUNITY_SORTS)(
    "%s sends byte-identical orderBy for page 1 and page 2",
    async (sort) => {
      const first = jest.fn().mockResolvedValue([]);
      const second = jest.fn().mockResolvedValue([]);

      await makeService(first).listPublic({ sort, page: 1, pageSize: 20 });
      await makeService(second).listPublic({ sort, page: 2, pageSize: 20 });

      expect(first.mock.calls[0][0].orderBy).toEqual(second.mock.calls[0][0].orderBy);
    }
  );

  it("advances skip by exactly one page and never changes take", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = makeService(findMany);

    await service.listPublic({ sort: "ENDING_SOON", page: 1, pageSize: 20 });
    await service.listPublic({ sort: "ENDING_SOON", page: 2, pageSize: 20 });
    await service.listPublic({ sort: "ENDING_SOON", page: 3, pageSize: 20 });

    expect(findMany.mock.calls.map((c) => c[0].skip)).toEqual([0, 20, 40]);
    expect(findMany.mock.calls.map((c) => c[0].take)).toEqual([20, 20, 20]);
  });

  it("counts against the SAME where clause the page was read with", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    await makeService(findMany, count).listPublic({ cityId: CITY, sort: "ENDING_SOON", page: 2 });

    // A total computed from a different filter would make the last page
    // number wrong and strand the user on an empty page.
    expect(count.mock.calls[0][0].where).toEqual(findMany.mock.calls[0][0].where);
  });

  it("keeps ordering independent of the filters applied", async () => {
    const unfiltered = jest.fn().mockResolvedValue([]);
    const filtered = jest.fn().mockResolvedValue([]);

    await makeService(unfiltered).listPublic({ sort: "ENDING_SOON" });
    await makeService(filtered).listPublic({ sort: "ENDING_SOON", cityId: CITY, taxonomyNodeId: NODE });

    expect(unfiltered.mock.calls[0][0].orderBy).toEqual(filtered.mock.calls[0][0].orderBy);
  });
});

describe("city + taxonomy + sort compose", () => {
  it("applies all three in one query", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listPublic({
      cityId: CITY,
      taxonomyNodeId: NODE,
      sort: "ENDING_SOON",
      page: 2,
      pageSize: 10,
    });

    const call = findMany.mock.calls[0][0];
    expect(call.where.fulfillmentCityId).toBe(CITY);
    expect(call.where.productApprovalSnapshot).toEqual({
      is: { OR: [{ snapshot: { path: ["taxonomyNodeId"], equals: NODE } }] },
    });
    expect(call.orderBy[0]).toEqual({ endAt: "asc" });
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
  });

  it("still restricts to publicly visible statuses when filters are present", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listPublic({ cityId: CITY, taxonomyNodeId: NODE, sort: "ENDING_SOON" });

    expect(findMany.mock.calls[0][0].where.status.in).toEqual(["ACTIVE"]);
  });

  it("filters taxonomy against the frozen snapshot, never the live product row", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listPublic({ taxonomyNodeId: NODE });

    const where = findMany.mock.calls[0][0].where;
    expect(where.productApprovalSnapshot).toBeDefined();
    expect(where).not.toHaveProperty("product");
  });

  it("expands to the node's DESCENDANTS, and still reads only the frozen snapshot", async () => {
    // THIS TEST USED TO ASSERT THE OPPOSITE, and was right to: nothing
    // was filed on a parent because everything could be. Products may no
    // longer sit on a node with children, so equality here would make
    // every parent in the category bar an empty page.
    //
    // WHAT DID NOT CHANGE is the half that matters for correctness: the
    // clause still reads the FROZEN approval snapshot and never joins
    // the live product, so recategorising a product tomorrow cannot
    // alter what an already-sold listing is findable under.
    const findMany = jest.fn().mockResolvedValue([]);
    const children = jest
      .fn()
      .mockResolvedValueOnce([{ id: "leaf-a" }])
      .mockResolvedValueOnce([]);
    const service = new OpportunityDiscoveryService(
      fakePrisma(findMany, undefined, children),
      settingsStub()
    );

    await service.listPublic({ taxonomyNodeId: NODE });

    const clause = findMany.mock.calls[0][0].where.productApprovalSnapshot;
    expect(clause.is.OR).toEqual([
      { snapshot: { path: ["taxonomyNodeId"], equals: NODE } },
      { snapshot: { path: ["taxonomyNodeId"], equals: "leaf-a" } },
    ]);

    // Every branch is still a snapshot read, and the live row is absent.
    for (const branch of clause.is.OR) {
      expect(branch.snapshot.path).toEqual(["taxonomyNodeId"]);
    }
    expect(findMany.mock.calls[0][0].where).not.toHaveProperty("product");
  });

  it("composes on the trader list identically", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await makeService(findMany).listForTrader({ cityId: CITY, taxonomyNodeId: NODE, sort: "ENDING_SOON" });

    const call = findMany.mock.calls[0][0];
    expect(call.where.fulfillmentCityId).toBe(CITY);
    expect(call.orderBy[0]).toEqual({ endAt: "asc" });
  });
});

describe("sort validation rejects anything outside the closed vocabulary", () => {
  it.each(OPPORTUNITY_SORTS)("accepts %s", async (sort) => {
    const { errors } = await validateQuery({ sort });
    expect(errors).toHaveLength(0);
  });

  it("accepts an omitted sort", async () => {
    const { errors } = await validateQuery({});
    expect(errors).toHaveLength(0);
  });

  it.each([
    ["an unknown value", "CHEAPEST"],
    ["the right value in the wrong case", "newest"],
    ["an empty string", ""],
    ["a SQL fragment", "createdAt DESC; DROP TABLE opportunities"],
    ["a number", 1],
    ["an array", ["NEWEST"]],
  ])("rejects %s", async (_label, sort) => {
    const { errors } = await validateQuery({ sort });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("sort");
  });

  it("names the constraint that failed, so the 400 is actionable", async () => {
    const { errors } = await validateQuery({ sort: "CHEAPEST" });
    expect(Object.keys(errors[0].constraints ?? {})).toContain("isIn");
  });

  it("rejects an unknown query parameter outright rather than ignoring it", async () => {
    const { errors } = await validateQuery({ sortBy: "NEWEST" });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("sortBy");
  });

  it("still rejects a malformed cityId alongside a valid sort", async () => {
    const { errors } = await validateQuery({ sort: "NEWEST", cityId: "not-a-uuid" });

    expect(errors.map((e) => e.property)).toEqual(["cityId"]);
  });
});
