import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OfferProgress } from "@/components/opportunities/offer-progress";
import { OpportunityCard } from "@/components/opportunities/opportunity-card";
import type { PublicOpportunityItem } from "@platform/types";

/**
 * Which way the progress bar runs, and where its two labels sit.
 *
 * The bar fills from the READING EDGE — right in Arabic, left in
 * English — and the marker with its percentage rides on the filled
 * end. Beneath it, the closing date sits at that same reading-start
 * edge and the remaining share at the far edge, in BOTH directions.
 *
 * WHY THIS IS NOT A DOM-ORDER TEST. Source order and visual order are
 * deliberately opposite here: "remaining" is written first, because it
 * belongs to the bar and is read straight after it, while explicit
 * `gridColumn` placement decides where each label lands. A test that
 * asserted "the first span is the date" would pass for the wrong
 * reason and would break the moment someone reordered the JSX for
 * readability — without the layout changing at all. So what is checked
 * is the placement itself, plus the direction it is resolved against.
 *
 * jsdom computes no geometry, so "position" here means the two things
 * that actually determine it: the container's direction, and the grid
 * column each label is placed in. Column 1 is the start edge and
 * column 2 the far edge, in both directions, which is precisely why
 * the component needs no per-locale branch.
 */

const LABELS = {
  remaining: "المتبقي 90%",
  endsAt: "ينتهي العرض: 6 سبتمبر 2026",
  ariaLabel: "بيع 10% من الكمية",
};

const ENGLISH_LABELS = {
  remaining: "90% remaining",
  endsAt: "Offer ends: 6 September 2026",
  ariaLabel: "10% of the quantity sold",
};

function edgeOf(testId: string): { edge: string | null; column: string } {
  const el = screen.getByTestId(testId);
  return { edge: el.getAttribute("data-edge"), column: el.style.gridColumn };
}

describe("Arabic: the bar runs right to left", () => {
  it("fills and marks from the RIGHT", () => {
    render(
      <OfferProgress progressPercentage={10} locale="ar-SA" labels={LABELS} />,
    );

    // `dir=rtl` is what makes both the filled block and the marker's
    // `inset-inline-start` resolve to the right edge. Without it the
    // bar would grow away from where an Arabic reader starts.
    expect(screen.getByTestId("offer-progress").getAttribute("dir")).toBe(
      "rtl",
    );
    expect(screen.getByTestId("offer-progress-fill").style.width).toBe("10%");
    expect(
      screen.getByTestId("offer-progress-marker").style.insetInlineStart,
    ).toContain("10%");
  });

  it("puts the closing date at the RIGHT and the remaining share at the LEFT", () => {
    render(
      <OfferProgress progressPercentage={10} locale="ar-SA" labels={LABELS} />,
    );

    // Column 1 is the start edge, which in RTL is the right.
    expect(edgeOf("offer-progress-ends-at")).toEqual({
      edge: "start",
      column: "1",
    });
    expect(edgeOf("offer-progress-remaining")).toEqual({
      edge: "end",
      column: "2",
    });
  });

  it("places the labels against the RTL container, not the page", () => {
    render(
      <OfferProgress progressPercentage={10} locale="ar-SA" labels={LABELS} />,
    );

    // The placement only means "right" if it is resolved in an RTL
    // box. Asserting the column without the direction would pass just
    // as well for a bar that ran the wrong way.
    const container = screen.getByTestId("offer-progress");
    expect(container.getAttribute("dir")).toBe("rtl");
    expect(
      within(container).getByTestId("offer-progress-ends-at").style.gridColumn,
    ).toBe("1");
  });
});

describe("English: the bar runs left to right", () => {
  it("fills and marks from the LEFT", () => {
    render(
      <OfferProgress
        progressPercentage={10}
        locale="en-SA"
        labels={ENGLISH_LABELS}
      />,
    );

    expect(screen.getByTestId("offer-progress").getAttribute("dir")).toBe(
      "ltr",
    );
    expect(
      screen.getByTestId("offer-progress-marker").style.insetInlineStart,
    ).toContain("10%");
  });

  it("puts the closing date at the LEFT and the remaining share at the RIGHT", () => {
    render(
      <OfferProgress
        progressPercentage={10}
        locale="en-SA"
        labels={ENGLISH_LABELS}
      />,
    );

    // Same placement, opposite side of the screen — the direction does
    // the mirroring, so the component needs no branch and the two
    // locales cannot drift apart.
    expect(edgeOf("offer-progress-ends-at")).toEqual({
      edge: "start",
      column: "1",
    });
    expect(edgeOf("offer-progress-remaining")).toEqual({
      edge: "end",
      column: "2",
    });
  });
});

describe("placement wins over source order", () => {
  it("writes 'remaining' first but places it last", () => {
    const { container } = render(
      <OfferProgress progressPercentage={10} locale="ar-SA" labels={LABELS} />,
    );

    const footer = container.querySelector(
      '[data-testid="offer-progress-footer"]',
    );
    const spans = Array.from(footer?.querySelectorAll("span") ?? []);
    const order = spans.map((s) => s.getAttribute("data-testid"));

    // The two are opposite on purpose. If someone ever "fixes" the
    // layout by swapping these lines instead of the columns, this
    // recorded mismatch is what shows the columns were the real rule.
    expect(order).toEqual([
      "offer-progress-remaining",
      "offer-progress-ends-at",
    ]);
    expect(spans[0].style.gridColumn).toBe("2");
    expect(spans[1].style.gridColumn).toBe("1");
  });
});

describe("the card and the detail page draw the SAME bar", () => {
  const offer: PublicOpportunityItem = {
    id: "22222222-2222-4222-8222-222222222222",
    saleMode: "GROUP" as const,
    productNameAr: "طبلية تمر",
    productNameEn: "Pallet of dates",
    imageUrl: null,
    thumbnailUrl: null,
    fulfillmentCityNameAr: "الرياض",
    fulfillmentCityNameEn: "Riyadh",
    fulfillmentRegionNameAr: "منطقة الرياض",
    fulfillmentRegionNameEn: "Riyadh Region",
    salesUnitNameAr: "طبلية",
    salesUnitNameEn: "Pallet",
    unitPriceInclTaxAmount: "287.50",
    currency: "SAR",
    targetQuantity: 100,
    unsoldQuantity: 90,
    progressPercentage: 10,
    shareQuantity: 10,
    endAt: "2026-09-06T00:00:00.000Z",
    status: "ACTIVE",
  };

  const CARD_LABELS = {
    regionLabel: "المنطقة",
    unitLabel: "وحدة البيع",
    targetLabel: "الكمية المستهدفة",
    remainingLabel: "المتبقي",
    minimumOrderLabel: "الحد الأدنى للطلب",
    priceInclTax: "شامل الضريبة",
    priceUnavailable: "السعر غير متاح حاليًا",
    scheduledBadge: null,
    noImage: "بلا صورة",
    viewDetails: "عرض التفاصيل",
    viewDetailsFor: "عرض تفاصيل طبلية تمر",
    targetValue: "100",
    remainingValue: "90",
    minimumOrderValue: "10",
    // A GROUP OFFER, which is what every fixture here was written
    // to describe: a progress bar and a countdown, not a shelf.
    saleMode: "GROUP" as const,
    stockLabel: "",
    soldOut: false,
    progress: LABELS,
  };

  it("draws the card's bar with the same direction and fill as a standalone one", () => {
    render(
      <OpportunityCard
        opportunity={offer}
        locale="ar-SA"
        labels={CARD_LABELS}
      />,
    );

    // THE SAME TRACK, arranged differently. Which way the bar runs
    // comes from the same component the detail page uses;
    // reimplementing it is how the two end up disagreeing by a side.
    expect(screen.getByRole("progressbar").getAttribute("dir")).toBe("rtl");
    expect(screen.getByTestId("offer-progress-fill").style.width).toBe("10%");

    // AND NO MARKER ON THE CARD — «في مؤشر بطاقة المنتج فيه سهم ونسبة
    // فوق المنتج، ألغها من المؤشر ونكتفي بكلمة المتبقي». The percentage
    // was the third time the card said the same thing: the bar draws
    // it and the caption under it names it.
    expect(screen.queryByTestId("offer-progress-marker-row")).toBeNull();
    expect(screen.queryByTestId("offer-progress-marker")).toBeNull();
  });

  it("mirrors the card's bar in English without a second implementation", () => {
    render(
      <OpportunityCard
        opportunity={offer}
        locale="en-SA"
        labels={CARD_LABELS}
      />,
    );

    expect(screen.getByRole("progressbar").getAttribute("dir")).toBe("ltr");
    expect(screen.queryByTestId("offer-progress-marker-row")).toBeNull();
  });

  it("carries the captions in the card's own rows, not under the bar", () => {
    render(
      <OpportunityCard
        opportunity={offer}
        locale="ar-SA"
        labels={CARD_LABELS}
      />,
    );

    // The composed footer belongs to the detail page's arrangement.
    expect(screen.queryByTestId("offer-progress-footer")).toBeNull();
    expect(screen.getByTestId("offer-card-ends-at").textContent).toBe(
      LABELS.endsAt,
    );
    expect(screen.getByTestId("offer-card-remaining").textContent).toBe(
      LABELS.remaining,
    );
  });

  it("still prints both captions under a bar composed the detail page's way", () => {
    render(
      <OfferProgress progressPercentage={10} locale="ar-SA" labels={LABELS} />,
    );

    // The default is unchanged, so the detail page keeps its date.
    expect(edgeOf("offer-progress-ends-at")).toEqual({
      edge: "start",
      column: "1",
    });
    expect(edgeOf("offer-progress-remaining")).toEqual({
      edge: "end",
      column: "2",
    });
  });
});
