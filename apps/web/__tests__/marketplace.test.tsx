import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { BannerItem, CityItem, PublicOpportunityItem } from "@platform/types";
import { OpportunityCard, CLOSING_SOON_DAYS } from "@/components/opportunities/opportunity-card";
import { OpportunityImage } from "@/components/opportunities/opportunity-image";
import { OpportunityFilters } from "@/components/opportunities/opportunity-filters";
import { OpportunityPagination } from "@/components/opportunities/opportunity-pagination";
import { TraderTermsNotice } from "@/components/opportunities/trader-terms-notice";
import { isRenderableLink } from "@/components/banners/banner-slot";
import { buildTaxonomyOptions } from "@/lib/taxonomy-tree";
import { parseMarketplaceQuery } from "@/lib/marketplace-query";

const CITY_ID = "11111111-1111-1111-1111-111111111111";
const NODE_ID = "22222222-2222-2222-2222-222222222222";

function opportunity(overrides: Partial<PublicOpportunityItem> = {}): PublicOpportunityItem {
  return {
    id: "opp-1",
    productNameAr: "منتج",
    productNameEn: "Product",
    imageUrl: "/api/v1/opportunities/opp-1/image",
    thumbnailUrl: "/api/v1/opportunities/opp-1/image?variant=thumb",
    fulfillmentCityNameAr: "الرياض",
    fulfillmentCityNameEn: "Riyadh",
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    endAt: "2026-09-01T00:00:00.000Z",
    status: "ACTIVE",
    ...overrides,
  };
}

const CARD_LABELS = {
  cityLabel: "Fulfilment city",
  unitLabel: "Sales unit",
  closesLabel: "Closes",
  closesIn: "Closes in 5 days",
  closingSoonBadge: null,
  scheduledBadge: "Scheduled",
  noImage: "No image available",
  viewDetails: "View details",
};

describe("opportunity card shows only what the anonymous contract carries", () => {
  it("renders the product name as a link to the detail page", () => {
    render(
      <OpportunityCard opportunity={opportunity()} locale="en-SA" labels={CARD_LABELS} />
    );

    expect(screen.getByRole("link", { name: "Product" })).toHaveAttribute(
      "href",
      "/en-SA/opportunities/opp-1"
    );
  });

  it("uses the Arabic name under ar-SA", () => {
    render(
      <OpportunityCard opportunity={opportunity()} locale="ar-SA" labels={CARD_LABELS} />
    );

    expect(screen.getByRole("link", { name: "منتج" })).toBeInTheDocument();
  });

  it("shows the fulfilment city and the selling unit", () => {
    render(
      <OpportunityCard opportunity={opportunity()} locale="en-SA" labels={CARD_LABELS} />
    );

    expect(screen.getByText("Riyadh")).toBeInTheDocument();
    expect(screen.getByText("Carton")).toBeInTheDocument();
  });

  it("omits the unit row entirely when there is no selling unit", () => {
    render(
      <OpportunityCard
        opportunity={opportunity({ salesUnitNameAr: null, salesUnitNameEn: null })}
        locale="en-SA"
        labels={CARD_LABELS}
      />
    );

    expect(screen.queryByText("Sales unit:")).not.toBeInTheDocument();
  });

  it("marks up the closing date as a machine-readable time", () => {
    const { container } = render(
      <OpportunityCard opportunity={opportunity()} locale="en-SA" labels={CARD_LABELS} />
    );

    expect(container.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-09-01T00:00:00.000Z"
    );
  });

  it("badges a SCHEDULED opportunity, and only a scheduled one", () => {
    const { rerender } = render(
      <OpportunityCard
        opportunity={opportunity({ status: "SCHEDULED" })}
        locale="en-SA"
        labels={CARD_LABELS}
      />
    );
    expect(screen.getByText("Scheduled")).toBeInTheDocument();

    rerender(
      <OpportunityCard opportunity={opportunity()} locale="en-SA" labels={CARD_LABELS} />
    );
    expect(screen.queryByText("Scheduled")).not.toBeInTheDocument();
  });

  it("has a closing-soon threshold expressed as a named constant", () => {
    expect(CLOSING_SOON_DAYS).toBeGreaterThan(0);
  });
});

describe("no commercial term can reach a public card", () => {
  const COMMERCIAL_TEXT = [
    "SAR",
    "ر.س",
    "price",
    "السعر",
    "quantity",
    "الكمية",
    "share",
    "الحصة",
    "%",
  ];

  it.each(COMMERCIAL_TEXT)("never renders %s", (fragment) => {
    const { container } = render(
      <OpportunityCard opportunity={opportunity()} locale="en-SA" labels={CARD_LABELS} />
    );

    expect(container.textContent?.toLowerCase()).not.toContain(fragment.toLowerCase());
  });

  it("cannot display a price even when one is smuggled into the object", () => {
    // The card reads named fields, never spreads the payload — so an
    // extra property is inert rather than rendered.
    const smuggled = {
      ...opportunity(),
      unitPriceAmount: 115,
      targetQuantity: 500,
    } as unknown as PublicOpportunityItem;

    const { container } = render(
      <OpportunityCard opportunity={smuggled} locale="en-SA" labels={CARD_LABELS} />
    );

    expect(container.textContent).not.toContain("115");
    expect(container.textContent).not.toContain("500");
  });
});

describe("the no-image state is a first-class state, not a broken image", () => {
  it("renders a labelled placeholder when there is no image", () => {
    render(
      <OpportunityImage src={null} productName="Product" noImageLabel="No image available" />
    );

    expect(screen.getByRole("img", { name: "No image available" })).toBeInTheDocument();
  });

  it("issues no image request at all when the URL is null", () => {
    const { container } = render(
      <OpportunityImage src={null} productName="Product" noImageLabel="No image available" />
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("uses the product name as alt text for a real image", () => {
    render(
      <OpportunityImage
        src="/api/v1/opportunities/opp-1/image"
        productName="Product"
        noImageLabel="No image available"
      />
    );

    expect(screen.getByRole("img", { name: "Product" }).tagName).toBe("IMG");
  });

  it("resolves the API-relative path against the API origin", () => {
    render(
      <OpportunityImage
        src="/api/v1/opportunities/opp-1/image"
        productName="Product"
        noImageLabel="No image available"
      />
    );

    expect(screen.getByRole("img", { name: "Product" }).getAttribute("src")).toMatch(
      /^https?:\/\/[^/]+\/api\/v1\/opportunities\/opp-1\/image$/
    );
  });

  it("never exposes a storage object key", () => {
    const { container } = render(
      <OpportunityImage
        src="/api/v1/opportunities/opp-1/image"
        productName="Product"
        noImageLabel="No image available"
      />
    );

    expect(container.innerHTML).not.toContain("objectKey");
    expect(container.innerHTML).not.toContain("products/");
  });

  it("lazy-loads by default and eagerly only when asked", () => {
    const { rerender } = render(
      <OpportunityImage src="/img" productName="P" noImageLabel="none" />
    );
    expect(screen.getByRole("img", { name: "P" })).toHaveAttribute("loading", "lazy");

    rerender(<OpportunityImage src="/img" productName="P" noImageLabel="none" priority />);
    expect(screen.getByRole("img", { name: "P" })).toHaveAttribute("loading", "eager");
  });
});

describe("filters are a real GET form applied server-side", () => {
  const CITIES: CityItem[] = [
    {
      id: CITY_ID,
      nameAr: "الرياض",
      nameEn: "Riyadh",
      region: { id: "r1", nameAr: "الرياض", nameEn: "Riyadh Region" },
    },
  ];

  const TAXONOMY = buildTaxonomyOptions(
    [
      { id: "food", parentId: null, nameAr: "غذاء", nameEn: "Food", iconUrl: null, sortOrder: 0 },
      {
        id: NODE_ID,
        parentId: "food",
        nameAr: "ألبان",
        nameEn: "Dairy",
        iconUrl: null,
        sortOrder: 1,
      },
    ],
    "en-SA"
  );

  const LABELS = {
    regionLabel: "Filter opportunities",
    cityLabel: "Fulfilment city",
    anyCity: "All cities",
    categoryLabel: "Category",
    anyCategory: "All categories",
    categoryExactMatchHint:
      "The category is matched exactly: choosing a parent category does not include its subcategories.",
    sortLabel: "Sort",
    sortOptions: { NEWEST: "Newest", ENDING_SOON: "Ending soonest" } as const,
    apply: "Apply",
    clear: "Clear filters",
  };

  function renderFilters(params: Record<string, string> = {}) {
    return render(
      <OpportunityFilters
        locale="en-SA"
        query={parseMarketplaceQuery(params)}
        cities={CITIES}
        taxonomyOptions={TAXONOMY}
        labels={LABELS}
      />
    );
  }

  it("submits by GET to the marketplace URL, so it works without JavaScript", () => {
    const { container } = renderFilters();
    const form = container.querySelector("form")!;

    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/en-SA/opportunities");
  });

  it("names its fields exactly as the query parameters, so the browser builds the URL", () => {
    const { container } = renderFilters();

    expect(container.querySelector('select[name="cityId"]')).toBeInTheDocument();
    expect(container.querySelector('select[name="taxonomyNodeId"]')).toBeInTheDocument();
    expect(container.querySelector('select[name="sort"]')).toBeInTheDocument();
  });

  it("has no page field, so applying a filter returns to the first page", () => {
    const { container } = renderFilters({ page: "4" });

    expect(container.querySelector('[name="page"]')).toBeNull();
  });

  it("labels every control", () => {
    renderFilters();

    expect(screen.getByLabelText("Fulfilment city")).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByLabelText("Sort")).toBeInTheDocument();
  });

  it("reflects the active filters as the selected options", () => {
    renderFilters({ cityId: CITY_ID, taxonomyNodeId: NODE_ID, sort: "NEWEST" });

    expect(screen.getByLabelText("Fulfilment city")).toHaveValue(CITY_ID);
    expect(screen.getByLabelText("Category")).toHaveValue(NODE_ID);
    expect(screen.getByLabelText("Sort")).toHaveValue("NEWEST");
  });

  it("offers parent categories as well as children", () => {
    renderFilters();
    const options = within(screen.getByLabelText("Category")).getAllByRole("option");

    expect(options.map((o) => o.textContent)).toEqual([
      "All categories",
      "Food",
      "Food › Dairy",
    ]);
  });

  it("says plainly that a parent does NOT include its subcategories", () => {
    renderFilters();

    expect(screen.getByText(LABELS.categoryExactMatchHint)).toBeInTheDocument();
  });

  it("wires that warning to the control with aria-describedby", () => {
    renderFilters();
    const select = screen.getByLabelText("Category");
    const describedBy = select.getAttribute("aria-describedby")!;

    expect(document.getElementById(describedBy)?.textContent).toBe(
      LABELS.categoryExactMatchHint
    );
  });

  it("offers both sort options and no others", () => {
    renderFilters();
    const options = within(screen.getByLabelText("Sort")).getAllByRole("option");

    expect(options.map((o) => o.getAttribute("value"))).toEqual(["NEWEST", "ENDING_SOON"]);
  });

  it("shows a clear-filters link only while a filter is active", () => {
    const { unmount } = renderFilters();
    expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();
    unmount();

    renderFilters({ cityId: CITY_ID });
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/en-SA/opportunities"
    );
  });

  it("still renders when the catalogue reads failed and the lists are empty", () => {
    render(
      <OpportunityFilters
        locale="en-SA"
        query={parseMarketplaceQuery({})}
        cities={[]}
        taxonomyOptions={[]}
        labels={LABELS}
      />
    );

    expect(screen.getByLabelText("Fulfilment city")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Category")).getAllByRole("option")).toHaveLength(1);
  });
});

describe("pagination navigates by link", () => {
  const LABELS = {
    navLabel: "Pagination",
    previous: "Previous",
    next: "Next",
    status: "Page 2 of 5",
  };

  function renderPager(page: number, total: number) {
    return render(
      <OpportunityPagination
        locale="en-SA"
        query={{ ...parseMarketplaceQuery({}), page }}
        total={total}
        labels={LABELS}
      />
    );
  }

  it("renders nothing when everything fits on one page", () => {
    const { container } = renderPager(1, 5);

    expect(container).toBeEmptyDOMElement();
  });

  it("uses links, not buttons, because these are navigations", () => {
    renderPager(2, 100);

    expect(screen.getByRole("link", { name: "Previous" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("builds hrefs that move exactly one page", () => {
    renderPager(2, 100);

    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/en-SA/opportunities"
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/en-SA/opportunities?page=3"
    );
  });

  it("carries every active filter and the sort into both page links", () => {
    const filtered = {
      ...parseMarketplaceQuery({
        cityId: CITY_ID,
        taxonomyNodeId: NODE_ID,
        sort: "NEWEST",
      }),
      page: 2,
    };

    render(
      <OpportunityPagination locale="en-SA" query={filtered} total={100} labels={LABELS} />
    );

    for (const name of ["Previous", "Next"]) {
      const href = screen.getByRole("link", { name }).getAttribute("href")!;
      const params = new URL(href, "https://example.test").searchParams;

      // Losing a filter on page 2 would silently widen the result set
      // while the heading still claims the list is filtered.
      expect(params.get("cityId"), name).toBe(CITY_ID);
      expect(params.get("taxonomyNodeId"), name).toBe(NODE_ID);
      expect(params.get("sort"), name).toBe("NEWEST");
    }
  });

  it("keeps pageSize constant across pages without putting it in the URL", () => {
    // pageSize is fixed for this surface, so it is preserved by never
    // varying rather than by being written into every link — a value in
    // the URL could be hand-edited and then clamped by the API, showing
    // something other than what the URL claims.
    const query = { ...parseMarketplaceQuery({}), page: 2 };

    render(<OpportunityPagination locale="en-SA" query={query} total={100} labels={LABELS} />);

    const next = screen.getByRole("link", { name: "Next" }).getAttribute("href")!;
    const params = new URL(next, "https://example.test").searchParams;

    expect(params.has("pageSize")).toBe(false);
    expect(parseMarketplaceQuery(Object.fromEntries(params.entries())).pageSize).toBe(
      query.pageSize
    );
  });

  it("advances and retreats by exactly one page", () => {
    const query = { ...parseMarketplaceQuery({ cityId: CITY_ID }), page: 3 };

    render(<OpportunityPagination locale="en-SA" query={query} total={100} labels={LABELS} />);

    const pageOf = (name: string) =>
      new URL(
        screen.getByRole("link", { name }).getAttribute("href")!,
        "https://example.test"
      ).searchParams.get("page");

    expect(pageOf("Previous")).toBe("2");
    expect(pageOf("Next")).toBe("4");
  });

  it("renders an unavailable direction as inert text, never a focusable dead link", () => {
    renderPager(1, 100);

    expect(screen.queryByRole("link", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toBeInTheDocument();
  });

  it("offers no next link on the final page", () => {
    renderPager(5, 100);

    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
  });

  it("names the navigation landmark", () => {
    renderPager(2, 100);

    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
  });
});

describe("the trader-terms notice explains the boundary without crossing it", () => {
  function renderNotice() {
    return render(
      <TraderTermsNotice
        title="Commercial terms"
        description="Price, quantities and share size are available to trader accounts after signing in."
        signInLabel="Sign in"
        registerLabel="Create an account"
        signInHref="/en-SA/login?returnTo=%2Fen-SA%2Fopportunities%2Fopp-1"
        registerHref="/en-SA/register"
      />
    );
  }

  it("offers a sign-in link that returns to the opportunity afterwards", () => {
    renderNotice();

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/en-SA/login?returnTo=%2Fen-SA%2Fopportunities%2Fopp-1"
    );
  });

  it("offers registration as the alternative", () => {
    renderNotice();

    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/en-SA/register"
    );
  });

  it("renders no figure of any kind — it takes no commercial props", () => {
    const { container } = renderNotice();

    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe("banner links are re-validated at render time", () => {
  it.each([
    ["an internal path", "/en-SA/opportunities"],
    ["an https URL", "https://example.test/promo"],
  ])("accepts %s", (_label, url) => {
    expect(isRenderableLink(url)).toBe(true);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["plain http", "http://example.test/promo"],
    ["a protocol-relative URL", "//evil.test/promo"],
    ["a bare word", "promo"],
    ["an empty string", ""],
  ])("refuses %s", (_label, url) => {
    expect(isRenderableLink(url)).toBe(false);
  });

  it("treats a missing link as not renderable", () => {
    expect(isRenderableLink(null)).toBe(false);
  });
});

describe("banner payloads carry no admin metadata", () => {
  it("the public contract has no schedule, status or object key", () => {
    const banner: BannerItem = {
      id: "b1",
      titleAr: "عنوان",
      titleEn: "Title",
      bodyAr: null,
      bodyEn: null,
      imageUrl: null,
      thumbnailUrl: null,
      linkUrl: null,
    };

    for (const forbidden of ["startsAt", "endsAt", "isActive", "state", "objectKey", "placement"]) {
      expect(banner).not.toHaveProperty(forbidden);
    }
  });
});

describe("no component in this app renders raw HTML", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps banner and policy text as React text nodes", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const roots = [join(__dirname, "..", "components"), join(__dirname, "..", "app")];
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry)) continue;

        // Strip comments first: this very file's own explanation of the
        // rule must not be mistaken for a violation of it.
        const source = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");

        if (source.includes("dangerouslySetInnerHTML")) offenders.push(full);
      }
    };

    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});
