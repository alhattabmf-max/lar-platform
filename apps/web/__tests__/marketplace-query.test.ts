import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, OPPORTUNITY_SORTS } from "@platform/types";
import {
  MARKETPLACE_DEFAULT_SORT,
  hasActiveFilters,
  marketplaceHref,
  parseMarketplaceQuery,
  toApiQueryString,
  toUrlSearchParams,
  withFilters,
  withPage,
} from "@/lib/marketplace-query";

const CITY = "11111111-1111-1111-1111-111111111111";
const NODE = "22222222-2222-2222-2222-222222222222";

describe("parsing the address bar", () => {
  it("defaults to page 1 and the surface's own sort", () => {
    const query = parseMarketplaceQuery({});

    expect(query.page).toBe(1);
    expect(query.sort).toBe(MARKETPLACE_DEFAULT_SORT);
    expect(query.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("prefers ENDING_SOON on this surface, which is NOT the API default", async () => {
    const { DEFAULT_OPPORTUNITY_SORT } = await import("@platform/types");

    expect(MARKETPLACE_DEFAULT_SORT).toBe("ENDING_SOON");
    expect(MARKETPLACE_DEFAULT_SORT).not.toBe(DEFAULT_OPPORTUNITY_SORT);
  });

  it.each(OPPORTUNITY_SORTS)("accepts %s from the URL", (sort) => {
    expect(parseMarketplaceQuery({ sort }).sort).toBe(sort);
  });

  it("keeps well-formed ids", () => {
    const query = parseMarketplaceQuery({ cityId: CITY, taxonomyNodeId: NODE });

    expect(query.cityId).toBe(CITY);
    expect(query.taxonomyNodeId).toBe(NODE);
  });

  it("reads a real page number", () => {
    expect(parseMarketplaceQuery({ page: "7" }).page).toBe(7);
  });
});

describe("a hand-edited URL degrades instead of erroring", () => {
  it.each([
    ["an unknown sort", "CHEAPEST"],
    ["the wrong case", "ending_soon"],
    ["an empty value", ""],
  ])("falls back to the default sort for %s", (_label, sort) => {
    expect(parseMarketplaceQuery({ sort }).sort).toBe(MARKETPLACE_DEFAULT_SORT);
  });

  it.each([
    ["a non-uuid", "not-a-uuid"],
    ["a SQL fragment", "1 OR 1=1"],
    ["an empty value", ""],
    ["a uuid missing a group", "11111111-1111-1111-1111"],
  ])("drops %s rather than forwarding it to the API", (_label, cityId) => {
    expect(parseMarketplaceQuery({ cityId }).cityId).toBeUndefined();
  });

  it.each([
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "2.5"],
    ["alphanumeric", "2abc"],
    ["words", "last"],
  ])("resets %s page numbers to 1", (_label, page) => {
    expect(parseMarketplaceQuery({ page }).page).toBe(1);
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseMarketplaceQuery({ page: ["3", "9"] }).page).toBe(3);
    expect(parseMarketplaceQuery({ cityId: [CITY, NODE] }).cityId).toBe(CITY);
  });

  it("never lets pageSize be set from the URL", () => {
    // Fixed for this surface: a hand-edited value would be clamped by
    // the API, showing something other than what the URL claims.
    const query = parseMarketplaceQuery({ pageSize: "500" } as Record<string, string>);

    expect(query.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("serialising for the API", () => {
  it("always sends page, pageSize and sort explicitly", () => {
    const params = new URLSearchParams(toApiQueryString(parseMarketplaceQuery({})));

    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe(String(DEFAULT_PAGE_SIZE));
    expect(params.get("sort")).toBe(MARKETPLACE_DEFAULT_SORT);
  });

  it("omits filters that are not set, rather than sending empty strings", () => {
    const params = new URLSearchParams(toApiQueryString(parseMarketplaceQuery({})));

    expect(params.has("cityId")).toBe(false);
    expect(params.has("taxonomyNodeId")).toBe(false);
  });

  it("includes both filters when both are set", () => {
    const query = parseMarketplaceQuery({ cityId: CITY, taxonomyNodeId: NODE, sort: "NEWEST" });
    const params = new URLSearchParams(toApiQueryString(query));

    expect(params.get("cityId")).toBe(CITY);
    expect(params.get("taxonomyNodeId")).toBe(NODE);
    expect(params.get("sort")).toBe("NEWEST");
  });

  it("only ever emits values the API's closed vocabulary accepts", () => {
    const params = new URLSearchParams(
      toApiQueryString(parseMarketplaceQuery({ sort: "CHEAPEST" }))
    );

    expect(OPPORTUNITY_SORTS).toContain(params.get("sort"));
  });
});

describe("serialising for the address bar", () => {
  it("produces a bare path for the unfiltered default view", () => {
    expect(marketplaceHref("ar-SA", parseMarketplaceQuery({}))).toBe("/ar-SA/opportunities");
  });

  it("omits page=1 and the default sort as redundant", () => {
    const params = toUrlSearchParams(parseMarketplaceQuery({}));

    expect(params.has("page")).toBe(false);
    expect(params.has("sort")).toBe(false);
  });

  it("writes a non-default sort", () => {
    const params = toUrlSearchParams(parseMarketplaceQuery({ sort: "NEWEST" }));

    expect(params.get("sort")).toBe("NEWEST");
  });

  it("never writes pageSize to the URL", () => {
    const params = toUrlSearchParams(parseMarketplaceQuery({ page: "2" }));

    expect(params.has("pageSize")).toBe(false);
  });

  it("round-trips a filtered view back to the same query", () => {
    const original = parseMarketplaceQuery({
      cityId: CITY,
      taxonomyNodeId: NODE,
      sort: "NEWEST",
      page: "4",
    });

    const href = marketplaceHref("en-SA", original);
    const search = new URL(href, "https://example.test").searchParams;
    const reparsed = parseMarketplaceQuery(Object.fromEntries(search.entries()));

    expect(reparsed).toEqual(original);
  });
});

describe("changing filters and pages", () => {
  it("resets to page 1 whenever a filter changes", () => {
    const onPageFour = withPage(parseMarketplaceQuery({}), 4);

    expect(withFilters(onPageFour, { cityId: CITY }).page).toBe(1);
    expect(withFilters(onPageFour, { taxonomyNodeId: NODE }).page).toBe(1);
    expect(withFilters(onPageFour, { sort: "NEWEST" }).page).toBe(1);
  });

  it("keeps the other filters when one changes", () => {
    const both = parseMarketplaceQuery({ cityId: CITY, taxonomyNodeId: NODE });

    expect(withFilters(both, { sort: "NEWEST" })).toMatchObject({
      cityId: CITY,
      taxonomyNodeId: NODE,
      sort: "NEWEST",
    });
  });

  it("does not reset filters when only the page changes", () => {
    const both = parseMarketplaceQuery({ cityId: CITY, taxonomyNodeId: NODE });

    expect(withPage(both, 3)).toMatchObject({ cityId: CITY, taxonomyNodeId: NODE, page: 3 });
  });

  it("never produces a page below 1", () => {
    expect(withPage(parseMarketplaceQuery({}), 0).page).toBe(1);
    expect(withPage(parseMarketplaceQuery({}), -5).page).toBe(1);
  });
});

describe("detecting active filters", () => {
  it("is false for the default view", () => {
    expect(hasActiveFilters(parseMarketplaceQuery({}))).toBe(false);
  });

  it.each([
    ["a city", { cityId: CITY }],
    ["a category", { taxonomyNodeId: NODE }],
  ])("is true with %s", (_label, params) => {
    expect(hasActiveFilters(parseMarketplaceQuery(params))).toBe(true);
  });

  it("does not count sorting as a filter — sorting narrows nothing", () => {
    expect(hasActiveFilters(parseMarketplaceQuery({ sort: "NEWEST" }))).toBe(false);
  });
});
