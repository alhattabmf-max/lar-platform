import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type {
  BannerItem,
  CityItem,
  PublicOpportunityItem,
  RegionItem,
} from "@platform/types";
import {
  OpportunityCard,
  CLOSING_SOON_DAYS,
} from "@/components/opportunities/opportunity-card";
import { OpportunityImage } from "@/components/opportunities/opportunity-image";
import { OpportunityFilters } from "@/components/opportunities/opportunity-filters";
import { OpportunityPagination } from "@/components/opportunities/opportunity-pagination";
import { TraderTermsNotice } from "@/components/opportunities/trader-terms-notice";
import { isRenderableLink } from "@/components/banners/banner-slot";
import { buildTaxonomyOptions } from "@/lib/taxonomy-tree";
import { MARKETPLACE_DEFAULT_SORT, parseMarketplaceQuery } from "@/lib/marketplace-query";

const CITY_ID = "11111111-1111-1111-1111-111111111111";
const NODE_ID = "22222222-2222-2222-2222-222222222222";
// A ROOT CATEGORY, AND A REAL UUID. It was the string "food", which
// `parseMarketplaceQuery` drops as malformed — so a test that chose it
// was testing an EMPTY filter without saying so.
const FOOD_ID = "55555555-5555-4555-8555-555555555555";

function opportunity(
  overrides: Partial<PublicOpportunityItem> = {},
): PublicOpportunityItem {
  return {
    id: "opp-1",
    saleMode: "GROUP" as const,
    productNameAr: "منتج",
    productNameEn: "Product",
    imageUrl: "/api/v1/opportunities/opp-1/image",
    thumbnailUrl: "/api/v1/opportunities/opp-1/image?variant=thumb",
    fulfillmentCityNameAr: "الرياض",
    fulfillmentCityNameEn: "Riyadh",
    fulfillmentRegionNameAr: "منطقة الرياض",
    fulfillmentRegionNameEn: "Riyadh Region",
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    unitPriceInclTaxAmount: "287.50",
    currency: "SAR",
    targetQuantity: 100,
    unsoldQuantity: 90,
    progressPercentage: 10,
    shareQuantity: 10,
    endAt: "2026-09-01T00:00:00.000Z",
    status: "ACTIVE",
    ...overrides,
  };
}

const CARD_LABELS = {
  regionLabel: "Region",
  unitLabel: "Sales unit",
  targetLabel: "Target quantity",
  remainingLabel: "Remaining quantity",
  minimumOrderLabel: "Minimum order",
  priceInclTax: "incl. VAT",
  priceUnavailable: "السعر غير متاح حاليًا",
  scheduledBadge: "Scheduled",
  noImage: "No image available",
  viewDetails: "View details",
  // Interpolated per card by the page, so every "View details" link on a
  // grid has an accessible name that says which opportunity it opens.
  viewDetailsFor: "View details for Product",
  targetValue: "100 Carton",
  remainingValue: "90 Carton",
  minimumOrderValue: "10 Carton",
  // A GROUP OFFER, which is what every fixture here was written
  // to describe: a progress bar and a countdown, not a shelf.
  saleMode: "GROUP" as const,
  stockLabel: "",
  soldOut: false,
  progress: {
    remaining: "90% remaining",
    endsAt: "Offer ends: 1 September 2026",
    ariaLabel: "10% of the available quantity sold",
  },
};

describe("opportunity card shows the offer terms a visitor may see", () => {
  it("renders the product name as a link to the detail page", () => {
    render(
      <OpportunityCard
        opportunity={opportunity()}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );

    // Three links now lead to the same page (image, name, action), so
    // the heading is scoped rather than queried by name alone.
    const heading = screen.getByRole("heading", { level: 3 });
    expect(within(heading).getByRole("link")).toHaveAttribute(
      "href",
      "/en-SA/opportunities/opp-1",
    );
  });

  it("uses the Arabic name under ar-SA", () => {
    render(
      <OpportunityCard
        opportunity={opportunity()}
        locale="ar-SA"
        labels={CARD_LABELS}
      />,
    );

    const heading = screen.getByRole("heading", { level: 3 });
    expect(within(heading).getByRole("link")).toHaveTextContent("منتج");
  });

  it("shows neither the region nor the selling unit — both are the detail page's", () => {
    render(
      <OpportunityCard
        opportunity={opportunity()}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );

    // THE REGION LEFT THE CARD — «المنطقة لا أحتاجها، إذا أراد
    //  الشخص منتجًا في منطقة يبحث عن طريق بحث المناطق». It is a
    // FILTER standing at the head of the listing, so printing it on
    // every card repeats the reader's own choice back at them.
    expect(screen.queryByText("Riyadh Region")).not.toBeInTheDocument();
    expect(screen.queryByText("Riyadh")).not.toBeInTheDocument();

    // AND SO DID THE UNIT — «كلمة طبلية، اللي هي وحدة البيع، موجودة
    //  في التفاصيل». What the price keeps is whether tax is in it,
    // which nothing else on the card says.
    const price = screen.getByText(CARD_LABELS.priceInclTax).closest("p")!;
    expect(price.textContent).not.toContain("Carton");
    expect(price.textContent).toContain("287.50");
  });

  it("omits the unit row entirely when there is no selling unit", () => {
    render(
      <OpportunityCard
        opportunity={opportunity({
          salesUnitNameAr: null,
          salesUnitNameEn: null,
        })}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );

    expect(screen.queryByText("Sales unit:")).not.toBeInTheDocument();
  });

  it("shows the closing date beneath the progress bar", () => {
    render(
      <OpportunityCard
        opportunity={opportunity()}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );

    expect(
      screen.getByText("Offer ends: 1 September 2026"),
    ).toBeInTheDocument();
  });

  it("badges a SCHEDULED opportunity, and only a scheduled one", () => {
    const { rerender } = render(
      <OpportunityCard
        opportunity={opportunity({ status: "SCHEDULED" })}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );
    expect(screen.getByText("Scheduled")).toBeInTheDocument();

    rerender(
      <OpportunityCard
        opportunity={opportunity()}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );
    expect(screen.queryByText("Scheduled")).not.toBeInTheDocument();
  });

  it("has a closing-soon threshold expressed as a named constant", () => {
    expect(CLOSING_SOON_DAYS).toBeGreaterThan(0);
  });
});

describe("the card shows offer terms, and still nothing about the platform", () => {
  it("shows the price with its currency and the tax-inclusive note", () => {
    render(
      <OpportunityCard
        opportunity={opportunity()}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );

    // Shown to a VISITOR on purpose: the whole point of the design is
    // that someone can judge an offer before creating an account.
    //
    // The amount and its currency arrive as ONE formatted string from
    // the shared money formatter, so they are matched together rather
    // than as two separate nodes.
    expect(screen.getByText(/287.50/)).toBeInTheDocument();
    expect(screen.getByText(/SAR|ر.س/)).toBeInTheDocument();
    expect(screen.getByText(/incl. VAT/)).toBeInTheDocument();
  });

  it("leaves the minimum, the target and the remaining to the detail page", () => {
    render(
      <OpportunityCard
        opportunity={opportunity()}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );

    // THE MINIMUM WENT WITH THEM — «الحد الأدنى موجود في التفاصيل،
    //  لا أحتاجه». It is the gate, and a gate is read at the moment
    // of ordering rather than while scanning thirty-six cards.
    expect(screen.queryByText("10 Carton")).not.toBeInTheDocument();

    // THE TARGET AND THE REMAINING WERE ALREADY GONE, and not
    // because they matter least — because the bar IS a picture of
    // exactly those two numbers, and the caption under it says what
    // share is left.
    expect(screen.queryByText("100 Carton")).not.toBeInTheDocument();
    expect(screen.queryByText("90 Carton")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it.each([
    // How much has actually sold, share sizing, and the supplier's
    // preparation commitment describe the PLATFORM, not the offer.
    "fundedQuantity",
    "sharePercentage",
    "expectedPreparationDays",
    "supplierCompanyId",
  ])("never renders %s, even if the object carries it", (field) => {
    const smuggled = {
      ...opportunity(),
      [field]: "SMUGGLED-VALUE",
    } as unknown as PublicOpportunityItem;

    const { container } = render(
      <OpportunityCard
        opportunity={smuggled}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );

    // The card reads named fields and never spreads the payload, so an
    // extra property is inert rather than rendered.
    expect(container.textContent).not.toContain("SMUGGLED-VALUE");
  });

  it('never says the quantity was "collected"', () => {
    const { container } = render(
      <OpportunityCard
        opportunity={opportunity()}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );

    // The cap is not a funding goal and reaching it unlocks nothing.
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).not.toContain("collected");
    expect(text).not.toContain("تم جمع");
  });
});

describe("the no-image state is a first-class state, not a broken image", () => {
  it("renders a labelled placeholder when there is no image", () => {
    render(
      <OpportunityImage
        src={null}
        productName="Product"
        noImageLabel="No image available"
      />,
    );

    expect(
      screen.getByRole("img", { name: "No image available" }),
    ).toBeInTheDocument();
  });

  it("issues no image request at all when the URL is null", () => {
    const { container } = render(
      <OpportunityImage
        src={null}
        productName="Product"
        noImageLabel="No image available"
      />,
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("uses the product name as alt text for a real image", () => {
    render(
      <OpportunityImage
        src="/api/v1/opportunities/opp-1/image"
        productName="Product"
        noImageLabel="No image available"
      />,
    );

    expect(screen.getByRole("img", { name: "Product" }).tagName).toBe("IMG");
  });

  it("resolves the API-relative path against the API origin", () => {
    render(
      <OpportunityImage
        src="/api/v1/opportunities/opp-1/image"
        productName="Product"
        noImageLabel="No image available"
      />,
    );

    expect(
      screen.getByRole("img", { name: "Product" }).getAttribute("src"),
    ).toMatch(/^https?:\/\/[^/]+\/api\/v1\/opportunities\/opp-1\/image$/);
  });

  it("never exposes a storage object key", () => {
    const { container } = render(
      <OpportunityImage
        src="/api/v1/opportunities/opp-1/image"
        productName="Product"
        noImageLabel="No image available"
      />,
    );

    expect(container.innerHTML).not.toContain("objectKey");
    expect(container.innerHTML).not.toContain("products/");
  });

  it("lazy-loads by default and eagerly only when asked", () => {
    const { rerender } = render(
      <OpportunityImage src="/img" productName="P" noImageLabel="none" />,
    );
    expect(screen.getByRole("img", { name: "P" })).toHaveAttribute(
      "loading",
      "lazy",
    );

    rerender(
      <OpportunityImage
        src="/img"
        productName="P"
        noImageLabel="none"
        priority
      />,
    );
    expect(screen.getByRole("img", { name: "P" })).toHaveAttribute(
      "loading",
      "eager",
    );
  });
});

describe("filters are a real GET form applied server-side", () => {
  const REGION_ID = "44444444-4444-4444-4444-444444444444";

  const REGIONS: RegionItem[] = [
    { id: REGION_ID, nameAr: "منطقة الرياض", nameEn: "Riyadh Region" },
  ];

  const CITIES: CityItem[] = [
    {
      id: CITY_ID,
      nameAr: "الرياض",
      nameEn: "Riyadh",
      region: { id: REGION_ID, nameAr: "منطقة الرياض", nameEn: "Riyadh Region" },
    },
  ];

  const TAXONOMY = buildTaxonomyOptions(
    [
      {
        id: FOOD_ID,
        parentId: null,
        nameAr: "غذاء",
        nameEn: "Food",
        iconUrl: null,
        sortOrder: 0,
      },
      {
        id: NODE_ID,
        parentId: FOOD_ID,
        nameAr: "ألبان",
        nameEn: "Dairy",
        iconUrl: null,
        sortOrder: 1,
      },
    ],
    "en-SA",
  );

  const LABELS = {
    formLabel: "Filter opportunities",
    regionLabel: "Region",
    anyRegion: "All regions",
    cityLabel: "Fulfilment city",
    anyCity: "All cities in the region",
    categoryLabel: "Category",
    anyCategory: "All categories",
    anyBranch: "All branches",
    categoryExactMatchHint:
      "The category is matched exactly: choosing a parent category does not include its subcategories.",
    sortLabel: "Sort",
    sortOptions: { NEWEST: "Newest", ENDING_SOON: "Ending soonest" } as const,
    apply: "Apply",
    clear: "Clear filters",
    showResults: "عرض النتائج",
  };

  function renderFilters(params: Record<string, string> = {}) {
    return render(
      <OpportunityFilters
        locale="en-SA"
        query={parseMarketplaceQuery(params)}
        regions={REGIONS}
        cities={CITIES}
        taxonomyOptions={TAXONOMY}
        labels={LABELS}
      />,
    );
  }

  it("follows the address when the filters are cleared, without a reload", () => {
    // «عندما أحدّد الخيارات وأضغط على البحث، بعدها أسوّي إزالة الفلاتر —
    //  تبقى البيانات اللي اخترتها موجودة، ولا يعود إلى الوضع الطبيعي
    //  إلا إذا سوّيت تحديث للصفحة.»
    //
    // «إزالة الفلاتر» is a LINK, and a link inside the app is a client
    // navigation: this form is re-rendered with a fresh query and never
    // unmounted, so its `useState` initialisers — which run once per
    // mount — kept every choice. The list said "no filters" while the
    // controls still said Riyadh. Only a hard refresh remounted it.
    const view = render(
      <OpportunityFilters
        locale="en-SA"
        query={parseMarketplaceQuery({
          regionId: REGION_ID,
          cityId: CITY_ID,
          taxonomyNodeId: FOOD_ID,
          sort: "NEWEST",
        })}
        regions={REGIONS}
        cities={CITIES}
        taxonomyOptions={TAXONOMY}
        labels={LABELS}
      />,
    );

    const region = () => screen.getByLabelText(LABELS.regionLabel) as HTMLSelectElement;
    const sort = () => screen.getByLabelText(LABELS.sortLabel) as HTMLSelectElement;
    expect(region().value).toBe(REGION_ID);
    expect(sort().value).toBe("NEWEST");

    // THE CLEARED ADDRESS, re-rendered rather than remounted — exactly
    // what the link does.
    view.rerender(
      <OpportunityFilters
        locale="en-SA"
        query={parseMarketplaceQuery({})}
        regions={REGIONS}
        cities={CITIES}
        taxonomyOptions={TAXONOMY}
        labels={LABELS}
      />,
    );

    expect(region().value).toBe("");
    // THE SORT TOO. It was `defaultValue`, which an uncontrolled select
    // reads once per mount, so it went stale for the same reason.
    expect(sort().value).toBe(MARKETPLACE_DEFAULT_SORT);
    // AND THE CITY CHOOSER IS GONE, because no region is chosen.
    expect(screen.queryByLabelText(LABELS.cityLabel)).toBeNull();
  });

  it("does not reset itself while a reader is choosing", () => {
    // The query object is rebuilt on every render of the page above, so
    // a reset that compared the OBJECT would fire on every unrelated
    // re-render and throw away a half-made choice. It compares the four
    // values the address carries.
    const query = { regionId: REGION_ID };
    const view = render(
      <OpportunityFilters
        locale="en-SA"
        query={parseMarketplaceQuery(query)}
        regions={REGIONS}
        cities={CITIES}
        taxonomyOptions={TAXONOMY}
        labels={LABELS}
      />,
    );

    const city = () => screen.getByLabelText(LABELS.cityLabel) as HTMLSelectElement;
    fireEvent.change(city(), { target: { value: CITY_ID } });
    expect(city().value).toBe(CITY_ID);

    // A NEW OBJECT carrying the SAME address.
    view.rerender(
      <OpportunityFilters
        locale="en-SA"
        query={parseMarketplaceQuery({ regionId: REGION_ID })}
        regions={REGIONS}
        cities={CITIES}
        taxonomyOptions={TAXONOMY}
        labels={LABELS}
      />,
    );

    expect(city().value).toBe(CITY_ID);
  });

  it("submits by GET to the marketplace URL, so it works without JavaScript", () => {
    const { container } = renderFilters();
    const form = container.querySelector("form")!;

    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/en-SA/opportunities");
  });

  it("names its fields exactly as the query parameters, so the browser builds the URL", () => {
    const { container } = renderFilters();

    expect(
      container.querySelector('select[name="regionId"]'),
    ).toBeInTheDocument();
    expect(container.querySelector('select[name="sort"]')).toBeInTheDocument();

    // THE CATEGORY IS TWO CHOOSERS AND ONE PARAMETER, so it is carried
    // by a hidden field rather than by a name on either — «حين يختار
    // التصنيف يفتح فرعه بجانبه». Two selects both named
    // `taxonomyNodeId` would serialise as an array and the API would
    // refuse it; the hidden field holds whichever of the two is the
    // answer: the branch when one is chosen, the category when not.
    expect(
      container.querySelector('input[type="hidden"][name="taxonomyNodeId"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('select[name="taxonomyNodeId"]'),
    ).toBeNull();
  });

  it("has no page field, so applying a filter returns to the first page", () => {
    const { container } = renderFilters({ page: "4" });

    expect(container.querySelector('[name="page"]')).toBeNull();
  });

  it("labels every control", () => {
    renderFilters();

    expect(screen.getByLabelText("Region")).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByLabelText("Sort")).toBeInTheDocument();
  });

  it("reflects the active filters as the selected options", () => {
    renderFilters({
      regionId: REGION_ID,
      taxonomyNodeId: NODE_ID,
      sort: "NEWEST",
    });

    expect(screen.getByLabelText("Region")).toHaveValue(REGION_ID);
    expect(screen.getByLabelText("Sort")).toHaveValue("NEWEST");

    // A BRANCH IN THE ADDRESS SHOWS ITS CATEGORY IN THE FIRST CHOOSER
    // AND ITSELF IN THE SECOND. The address carries one node id and it
    // may be either, so the category chooser walks up to the root
    // rather than assuming the id it was given is one.
    const [category, branch] = screen.getAllByLabelText("Category");
    expect(category).toHaveValue(FOOD_ID);
    expect(branch).toHaveValue(NODE_ID);
    // And ONE parameter leaves the form: the branch.
    expect(
      document.querySelector('input[type="hidden"][name="taxonomyNodeId"]'),
    ).toHaveValue(NODE_ID);
  });

  /**
   * THE CITY IS A REFINEMENT, not a peer of the region.
   *
   * Offering every city in the Kingdom beside a region would let a
   * visitor choose a pair that matches nothing; offering the filter at
   * all while no city is active would be a question with no answers.
   * So it appears only once a region is chosen AND that region has
   * active cities.
   */
  it("offers no city filter until a region is chosen", () => {
    const { container } = renderFilters();

    expect(container.querySelector('select[name="cityId"]')).toBeNull();
  });

  it("offers the cities of the chosen region, and only those", () => {
    const { container } = renderFilters({ regionId: REGION_ID });
    const city = container.querySelector('select[name="cityId"]');

    expect(city).toBeInTheDocument();
    expect(
      within(city as HTMLElement)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All cities in the region", "Riyadh"]);
  });

  it("offers no city filter for a region with no active cities", () => {
    const { container } = renderFilters({
      regionId: "55555555-5555-5555-5555-555555555555",
    });

    expect(container.querySelector('select[name="cityId"]')).toBeNull();
  });

  it("offers the categories, and opens their branches beside them", () => {
    // «حين يختار التصنيف يفتح فرعه بجانبه» — so the first chooser holds
    // the CATEGORIES and the second, which appears only once one is
    // chosen, holds that category's branches. A single flat list with
    // "Food › Dairy" in it was a hierarchy pretending to be a line.
    renderFilters();
    const [category] = screen.getAllByLabelText("Category");
    expect(
      within(category).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["All categories", "Food"]);

    // Nothing is chosen, so there is no branch chooser yet.
    expect(screen.getAllByLabelText("Category")).toHaveLength(1);
  });

  it("shows a category's branches once it is chosen", () => {
    renderFilters({ taxonomyNodeId: FOOD_ID });

    const choosers = screen.getAllByLabelText("Category");
    expect(choosers).toHaveLength(2);
    expect(
      within(choosers[1]).getAllByRole("option").map((o) => o.textContent),
    ).toEqual(["All branches", "Dairy"]);
  });

  it("NO LONGER warns that a parent excludes its subcategories, because it does not", () => {
    // THE WARNING WAS TRUE AND IS NOW FALSE. A parent filter reaches the
    // whole subtree, so leaving the sentence up would be the trap it was
    // written to prevent — pointed the other way.
    //
    // The component reads `TAXONOMY_FILTER_INCLUDES_DESCENDANTS` rather
    // than having the sentence deleted, so the two can never disagree:
    // flip the constant back and the warning returns by itself.
    renderFilters();

    expect(screen.queryByText(LABELS.categoryExactMatchHint)).toBeNull();
  });

  it("leaves the category control with nothing false attached to it", () => {
    renderFilters();
    const select = screen.getByLabelText("Category");
    const describedBy = select.getAttribute("aria-describedby");

    // Either no description at all, or one that is NOT the retired
    // warning. A stale `aria-describedby` pointing at a removed node is
    // how a screen reader ends up announcing nothing where a sentence
    // used to be.
    if (describedBy) {
      expect(document.getElementById(describedBy)?.textContent).not.toBe(
        LABELS.categoryExactMatchHint,
      );
    } else {
      expect(describedBy).toBeNull();
    }
  });

  it("offers both sort options and no others", () => {
    renderFilters();
    const options = within(screen.getByLabelText("Sort")).getAllByRole(
      "option",
    );

    expect(options.map((o) => o.getAttribute("value"))).toEqual([
      "NEWEST",
      "ENDING_SOON",
    ]);
  });

  it("shows a clear-filters link only while a filter is active", () => {
    const { unmount } = renderFilters();
    expect(
      screen.queryByRole("link", { name: "Clear filters" }),
    ).not.toBeInTheDocument();
    unmount();

    renderFilters({ cityId: CITY_ID });
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/en-SA/opportunities",
    );
  });

  it("still renders when the catalogue reads failed and the lists are empty", () => {
    render(
      <OpportunityFilters
        locale="en-SA"
        query={parseMarketplaceQuery({})}
        regions={[]}
        cities={[]}
        taxonomyOptions={[]}
        labels={LABELS}
      />,
    );

    // THE REGION FILTER SURVIVES AN EMPTY LIST — it renders with just
    // its "all regions" option rather than disappearing, so the form
    // still has the shape a visitor expects. The city filter is absent
    // because no region is chosen, which is its normal state.
    expect(screen.getByLabelText("Region")).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Category")).getAllByRole("option"),
    ).toHaveLength(1);
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
      />,
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
      "/en-SA/opportunities",
    );
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/en-SA/opportunities?page=3",
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
      <OpportunityPagination
        locale="en-SA"
        query={filtered}
        total={100}
        labels={LABELS}
      />,
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

    render(
      <OpportunityPagination
        locale="en-SA"
        query={query}
        total={100}
        labels={LABELS}
      />,
    );

    const next = screen
      .getByRole("link", { name: "Next" })
      .getAttribute("href")!;
    const params = new URL(next, "https://example.test").searchParams;

    expect(params.has("pageSize")).toBe(false);
    expect(
      parseMarketplaceQuery(Object.fromEntries(params.entries())).pageSize,
    ).toBe(query.pageSize);
  });

  it("advances and retreats by exactly one page", () => {
    const query = { ...parseMarketplaceQuery({ cityId: CITY_ID }), page: 3 };

    render(
      <OpportunityPagination
        locale="en-SA"
        query={query}
        total={100}
        labels={LABELS}
      />,
    );

    const pageOf = (name: string) =>
      new URL(
        screen.getByRole("link", { name }).getAttribute("href")!,
        "https://example.test",
      ).searchParams.get("page");

    expect(pageOf("Previous")).toBe("2");
    expect(pageOf("Next")).toBe("4");
  });

  it("renders an unavailable direction as inert text, never a focusable dead link", () => {
    renderPager(1, 100);

    expect(
      screen.queryByRole("link", { name: "Previous" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toBeInTheDocument();
  });

  it("offers no next link on the final page", () => {
    renderPager(5, 100);

    expect(
      screen.queryByRole("link", { name: "Next" }),
    ).not.toBeInTheDocument();
  });

  it("names the navigation landmark", () => {
    renderPager(2, 100);

    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toBeInTheDocument();
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
      />,
    );
  }

  it("offers a sign-in link that returns to the opportunity afterwards", () => {
    renderNotice();

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/en-SA/login?returnTo=%2Fen-SA%2Fopportunities%2Fopp-1",
    );
  });

  it("offers registration as the alternative", () => {
    renderNotice();

    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/en-SA/register");
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
      imageUrl: "/api/v1/banners/b1/image?locale=ar-SA",
      thumbnailUrl: "/api/v1/banners/b1/image?locale=ar-SA&variant=thumb",
      linkUrl: null,
    };

    for (const forbidden of [
      "startsAt",
      "endsAt",
      "isActive",
      "state",
      "objectKey",
      "placement",
    ]) {
      expect(banner).not.toHaveProperty(forbidden);
    }

    // NO TEXT EITHER. A banner is artwork: every word a visitor reads is
    // drawn inside the picture, so there is no operator-written string
    // on this contract to render — and therefore none to escape.
    for (const gone of ["titleAr", "titleEn", "bodyAr", "bodyEn"]) {
      expect(banner).not.toHaveProperty(gone);
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

    const roots = [
      join(__dirname, "..", "components"),
      join(__dirname, "..", "app"),
    ];
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

describe("a withdrawn offer stops being readable", () => {
  // MEASURED LIVE, NOT SUSPECTED. An offer an operator had CANCELLED
  // kept answering 200 with its name and its price — five consecutive
  // requests, and again thirty-five seconds after a thirty-second
  // window — while the API answered 404 to every one of them. Clearing
  // `.next/cache/fetch-cache` was the only thing that stopped it.
  const data = readFileSync(
    join(__dirname, "..", "lib", "marketplace-data.ts"),
    "utf8",
  );
  const detail = data.slice(
    data.indexOf("export async function loadOpportunityDetail"),
    data.indexOf("export", data.indexOf("export async function loadOpportunityDetail") + 10),
  );

  it("reads one offer WITHOUT the fetch cache", () => {
    // Next serves a stale entry and revalidates behind the request; a
    // revalidation that returns NON-2xx does not evict, it keeps the
    // last good response. So a read whose upstream can turn into a 404
    // has no expiry at all — the answer that should remove it is the
    // one that gets discarded.
    expect(detail).toContain('cache: "no-store"');
    expect(detail).not.toContain("revalidate:");
  });

  it("leaves the LIST cached, because a list cannot become a 404", () => {
    // Its upstream stays 200 and simply returns fewer rows, so it
    // expires normally. Removing its window would cost an API call on
    // every visit to buy nothing.
    const list = data.slice(
      data.indexOf("export function loadOpportunities"),
      data.indexOf("export async function loadOpportunityDetail"),
    );
    expect(list).toContain("OPPORTUNITY_LIST_TTL");
  });
});
