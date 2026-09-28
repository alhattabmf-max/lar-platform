import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpportunityCard } from "@/components/opportunities/opportunity-card";
import type { PublicOpportunityItem } from "@platform/types";

/**
 * The shape of one offer card, per the «بطاقة أزير واحد» reference.
 *
 * The card is ONE GRID in two columns and four rows. The photograph and
 * the information sit side by side at the top; the rows beneath are
 * shared between the columns, which is what puts the progress bar and
 * the action button on the same line, and the closing date and the
 * remaining share on the line below.
 *
 * WHY ROWS ARE ASSERTED, AND NOT MARGINS. Two independent stacks can
 * only be aligned by pushing one down with `mt-auto`, which is one
 * column guessing at the height of the other — it holds when the two
 * come out the same length and drifts when they do not. Being in the
 * same grid row is the real relationship, and it is the one these
 * tests read: the area template is parsed and the row INDEX of each
 * piece compared. A test that merely checked "both are present" would
 * pass for a card whose bar sat below the button.
 *
 * WHY PLACEMENT AND NOT ORDER. Logical placement would put the
 * photograph on the correct side in both languages by flipping
 * automatically, with a single template that never names a side. That
 * layout is right only by side effect: nothing in it records which half
 * the photograph belongs in, so a wrapper that reset the direction
 * would move it and no test would notice. The grid is pinned to
 * physical columns and the areas are chosen from the locale, so Arabic
 * and English carry visibly different templates.
 */

const OFFER: PublicOpportunityItem = {
  id: "33333333-3333-4333-8333-333333333333",
  saleMode: "GROUP" as const,
  productNameAr: "أسمنت بورتلاندي ٥٠ كجم",
  productNameEn: "Portland cement 50kg",
  imageUrl: "/api/v1/opportunities/33333333-3333-4333-8333-333333333333/image",
  thumbnailUrl:
    "/api/v1/opportunities/33333333-3333-4333-8333-333333333333/image?variant=thumb",
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

const PROGRESS = {
  remaining: "المتبقي 90%",
  endsAt: "ينتهي العرض: 6 سبتمبر 2026",
  ariaLabel: "بيع 10% من الكمية",
};

const LABELS = {
  regionLabel: "المنطقة",
  unitLabel: "وحدة البيع",
  targetLabel: "الكمية المستهدفة",
  remainingLabel: "الكمية المتبقية",
  minimumOrderLabel: "الحد الأدنى للطلب",
  priceInclTax: "شامل الضريبة",
  priceUnavailable: "السعر غير متاح حاليًا",
  scheduledBadge: null,
  noImage: "لا توجد صورة",
  viewDetails: "عرض التفاصيل",
  viewDetailsFor: "عرض تفاصيل أسمنت بورتلاندي ٥٠ كجم",
  targetValue: "100",
  remainingValue: "90",
  minimumOrderValue: "10",
  // A GROUP OFFER, which is what every fixture here was written
  // to describe: a progress bar and a countdown, not a shelf.
  saleMode: "GROUP" as const,
  stockLabel: "",
  soldOut: false,
  progress: PROGRESS,
};

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

function renderCard(locale: "ar-SA" | "en-SA" = "ar-SA", offer = OFFER) {
  return render(
    <OpportunityCard opportunity={offer} locale={locale} labels={LABELS} />,
  );
}

const card = () => screen.getByTestId("offer-card");
const row = () => card().firstElementChild as HTMLElement;
const media = () => screen.getByTestId("offer-card-media");
const info = () => screen.getByTestId("offer-card-info");
const allLinks = () =>
  Array.from(card().querySelectorAll<HTMLAnchorElement>("a[href]"));

describe("the card is one band, a picture and three lines", () => {
  it("lays the row out as a line rather than a grid of areas", () => {
    renderCard();

    // IT WAS A TWO-BY-FOUR GRID and four hundred pixels tall.
    expect(row().className).toContain("sm:flex-row");
    expect(card().style.gridTemplateAreas).toBe("");
  });

  it("puts the picture and the lines side by side, and nothing else", () => {
    renderCard();

    // TWO PARTS ON THE TOP LINE. The way in used to be a third, a
    // column 176 pixels wide and fixed — wider than the product beside
    // it at three cards to a row, and using 94 of its own 261 pixels.
    // «لا أريد أي فراغ في البطاقة، استغل كل الفراغات.»
    const parts = [...row().children];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(media());
    expect(parts[1]).toBe(info());
    expect(row()).not.toContainElement(screen.getByTestId("offer-card-action"));
  });

  it("fixes the picture's width and lets the lines take the rest", () => {
    renderCard();

    expect(media().className).toContain("w-20");
    expect(media().className).toContain("shrink-0");
    expect(info().className).toContain("flex-1");
    expect(info().className).toContain("min-w-0");
  });

  it("makes the picture as tall as the lines beside it", () => {
    renderCard();

    // «مربع الصورة خلّه موازي للأسطر الثلاثة» — and the WIDTH is what
    // is fixed, never the height. `aspect-square` on a stretched item
    // was tried and blew the picture up to four hundred pixels: the
    // width resolved from the image's own intrinsic size and the ratio
    // then derived a height from THAT, so the square measured itself
    // and the row grew to fit.
    expect(media().className).toContain("self-stretch");
    expect(media().className).not.toContain("aspect-square");
    expect(media().className).not.toContain("self-start");
    expect(row().className).toContain("sm:items-stretch");
  });

  it("puts the picture on top on a phone, beside the name from `sm`", () => {
    // «شرايك نحط الصورة أعلى وتحتها المعلومات» — two to a row makes
    // the card 191 wide, where a picture beside a name leaves the
    // name a column too narrow to read. A wide screen is scanned by
    // name and keeps the picture at its side.
    renderCard();

    expect(row().className).toContain("flex-col");
    expect(row().className).toContain("sm:flex-row");
  });
});

describe("what the card no longer repeats", () => {
  it("carries no band of figures at all", () => {
    // «الحد الأدنى موجود في التفاصيل، لا أحتاجه. المنطقة لا
    //  أحتاجها — إذا أراد الشخص منتجًا في منطقة يبحث عن طريق بحث
    //  المناطق.»
    //
    // A LISTING IS SCANNED. Every figure that also lives on the
    // detail page is a line the eye passes on the way to the next
    // card — and the region is a FILTER at the head of this very
    // page, so printing it on every card says nothing a reader did
    // not already choose.
    renderCard();

    expect(screen.queryByTestId("offer-card-facts")).toBeNull();
    const text = info().textContent ?? "";
    expect(text).not.toContain(LABELS.minimumOrderLabel);
    expect(text).not.toContain(LABELS.regionLabel);
    expect(text).not.toContain("منطقة الرياض");
  });

  it("drops the selling unit from the price, and keeps the tax note", () => {
    // «كلمة طبلية، اللي هي وحدة البيع، موجودة في التفاصيل، ما
    //  أحتاجها» — the tax note stays, because a price that does not
    // say whether tax is in it is not a price.
    renderCard();

    const text = info().textContent ?? "";
    expect(text).not.toContain("طبلية");
    expect(text).toContain(LABELS.priceInclTax);
  });

  it("leaves the target and the remaining to the detail page", () => {
    // The bar already answers «how much is left»; a figure beside it
    // saying the same thing is the same fact twice.
    renderCard();

    const text = info().textContent ?? "";
    expect(text).not.toContain("الكمية المطلوبة");
    expect(text).not.toContain("المتبقي");
  });
});

describe("the bar and the way in share one line across the card", () => {
  it("puts them on a line of their own, under the picture and the lines", () => {
    renderCard();

    const bottom = card().lastElementChild as HTMLElement;
    expect(bottom).not.toBe(row());
    expect(bottom).toContainElement(screen.getByTestId("offer-card-progress"));
    expect(bottom).toContainElement(screen.getByTestId("offer-card-action"));
  });

  it("gives the bar what is left and the button the width of its word", () => {
    renderCard();

    // Nothing reserved, nothing empty.
    expect(screen.getByTestId("offer-card-progress").className).toContain(
      "flex-1",
    );
    const action = screen.getByTestId("offer-card-action");
    expect(action.className).toContain("shrink-0");
    expect(action.className).not.toContain("w-full");
  });

  it("carries the bar and its captions, and no marker above them", () => {
    renderCard();

    // «في مؤشر بطاقة المنتج فيه سهم ونسبة فوق المنتج، ألغها من المؤشر
    // ونكتفي بكلمة المتبقي». The arrow pointed at a bar it was already
    // touching, and the percentage was the third time the card said the
    // same thing — the bar draws it, the caption names it. What it cost
    // was a two-rem strip above the bar on every card in the grid.
    const progress = screen.getByTestId("offer-card-progress");

    expect(progress).toContainElement(screen.getByRole("progressbar"));
    expect(progress).toContainElement(
      screen.getByTestId("offer-card-remaining"),
    );
    expect(screen.queryByTestId("offer-progress-marker-row")).toBeNull();
    expect(screen.queryByTestId("offer-progress-marker")).toBeNull();
  });

  it("changes neither the button's height nor the bar's thickness", () => {
    renderCard();

    expect(screen.getByRole("progressbar").className).toContain("h-2");
  });
});

describe("the closing date and the remaining share sit with the bar", () => {
  it("puts them on one line under the bar they describe", () => {
    renderCard();

    const progress = screen.getByTestId("offer-card-progress");
    const ends = screen.getByTestId("offer-card-ends-at");
    const remaining = screen.getByTestId("offer-card-remaining");

    expect(progress).toContainElement(ends);
    expect(progress).toContainElement(remaining);
    expect(ends.parentElement).toBe(remaining.parentElement);
    expect(remaining.parentElement!.className).toContain("justify-between");
  });

  it("keeps the closing date emphasised", () => {
    renderCard();

    expect(screen.getByTestId("offer-card-ends-at").className).toContain(
      "text-danger",
    );
  });
});

describe("which way the card reads is stated on the card", () => {
  it("carries the reading direction, so every piece inherits it", () => {
    renderCard("ar-SA");

    // The old card pinned its GRID to physical columns and chose an
    // area template per language, because four rows across two halves
    // had to be kept in step. A band is one line: the flow direction
    // places the picture at the right in Arabic and the left in
    // English, and there is no second template to disagree.
    expect(card().getAttribute("dir")).toBe("rtl");
  });

  it("flows English left to right", () => {
    renderCard("en-SA");

    expect(card().getAttribute("dir")).toBe("ltr");
  });

  it("still lets the bar carry its own", () => {
    renderCard("ar-SA");

    // The bar's fill grows from the reading edge because of this, and
    // it is declared by the progress component itself rather than
    // inherited — so a wrapper that reset the direction cannot silently
    // reverse a percentage.
    expect(screen.getByRole("progressbar").getAttribute("dir")).toBe("rtl");
  });
});

describe("a price the API did not send", () => {
  it("says so, rather than leaving a blank or printing a zero", () => {
    // "0.00" is a claim about what something costs; a blank is a
    // product with no price and no reason given.
    renderCard("ar-SA", { ...OFFER, unitPriceInclTaxAmount: "not-a-price" });

    expect(screen.getByText(LABELS.priceUnavailable)).toBeInTheDocument();
  });
});

describe("the photograph", () => {
  it("fills its box and crops rather than stretching", () => {
    renderCard();

    // THE BOX IS NO LONGER SQUARE. Its width is fixed and its height is
    // taken from the lines beside it — «مربع الصورة خلّه موازي للأسطر
    // الثلاثة» — so the picture cannot keep a ratio of its own and must
    // crop to what it is given. `object-cover` is what makes that a
    // crop rather than a stretch.
    const img = media().querySelector("img");
    expect(img?.className).toContain("object-cover");
    expect(img?.className).toContain("h-full");
    expect(media().className).toContain("overflow-hidden");
  });

  it("uses the thumbnail, not the full-resolution route", () => {
    renderCard();

    expect(media().querySelector("img")?.getAttribute("src")).toContain(
      "variant=thumb",
    );
  });
});

describe("an offer with no photograph", () => {
  const noImage = { ...OFFER, imageUrl: null, thumbnailUrl: null };

  it("shows a neutral box that SAYS there is no image", () => {
    renderCard("ar-SA", noImage);

    // Half a card standing empty with only a faint icon reads as
    // something that failed to load.
    expect(screen.getByTestId("opportunity-no-image").textContent).toContain(
      LABELS.noImage,
    );
  });

  it("announces it once, not twice", () => {
    renderCard("ar-SA", noImage);

    const placeholder = screen.getByTestId("opportunity-no-image");
    expect(placeholder.getAttribute("aria-label")).toBe(LABELS.noImage);
    // The printed copy repeats the accessible name, so it is hidden
    // from assistive technology rather than read out after it.
    expect(
      within(placeholder).getByText(LABELS.noImage).getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("keeps the same box, so a row of cards does not reflow", () => {
    renderCard("ar-SA", noImage);

    // The placeholder takes the picture's own box — fixed width, height
    // from the lines — so an offer with no photograph is exactly as
    // wide and as tall as one with.
    expect(media().className).toContain("w-20");
    expect(media().className).toContain("self-stretch");
    expect(
      screen.getByTestId("opportunity-no-image").className,
    ).toContain("h-full");
  });

  it("renders no <img> at all rather than a coloured fill", () => {
    renderCard("ar-SA", noImage);

    expect(media().querySelector("img")).toBeNull();
  });
});

describe("which front the card opens into", () => {
  it("defaults to the public marketplace", () => {
    renderCard();

    // Where this card began, and where it stays when nobody names a
    // front: the visitor market is the only place with no session to
    // ask.
    for (const link of allLinks()) {
      expect(link.getAttribute("href")).toBe(`/ar-SA/opportunities/${OFFER.id}`);
    }
  });

  it("opens the caller's front when one is named", () => {
    // «عندما أضغط عرض تفاصيل المنتج في الصفحة الرئيسية في واجهة المشتري
    // يرجعني إلى صفحة الزائر.» The buyer home renders the visitor home
    // — that was asked for — but the card built its address from the
    // LOCALE alone, so it always pointed at the public route and walked
    // a signed-in buyer out of their own portal.
    render(
      <OpportunityCard
        opportunity={OFFER}
        locale="ar-SA"
        labels={LABELS}
        detailBasePath="/ar-SA/trader/opportunities"
      />,
    );

    // ALL THREE ways in, not just the button: the picture and the name
    // open the same page, and a fix that moved only one of them would
    // leave two doors out of the portal.
    const links = allLinks();
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(
        `/ar-SA/trader/opportunities/${OFFER.id}`,
      );
    }
  });

  it("is threaded through the shared home, and the buyer page names it", () => {
    // The prop is useless unless the page that HAS the answer passes
    // it. Read from the source, because these are server components.
    const home = read("components/home/home-content.tsx");
    expect(home).toContain("detailBasePath?: string;");
    expect(home).toContain("detailBasePath={detailBasePath}");

    const trader = read("app/[locale]/trader/page.tsx");
    expect(trader).toContain(
      "detailBasePath={`/${appLocale}/trader/opportunities`}",
    );
  });
});

describe("all three ways into the offer", () => {
  it("opens the detail page from the image, the name and the button", () => {
    renderCard();

    const href = `/ar-SA/opportunities/${OFFER.id}`;
    const links = Array.from(
      card().querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`),
    );

    expect(links).toHaveLength(3);
    // Each is separately reachable and separately named — a grid of
    // cards where every link announces "View details" is unusable.
    expect(
      links.some((l) => l.getAttribute("aria-label") === LABELS.viewDetailsFor),
    ).toBe(true);
    expect(
      links.some(
        (l) => l.getAttribute("aria-label") === "أسمنت بورتلاندي ٥٠ كجم",
      ),
    ).toBe(true);
    expect(links.some((l) => l.textContent?.includes("أسمنت"))).toBe(true);
  });
});

describe("the information column carries what the card kept", () => {
  it("shows the name and the price with its tax, and nothing else", () => {
    renderCard();

    const text = info().textContent ?? "";
    for (const piece of ["أسمنت بورتلاندي ٥٠ كجم", "287.50", LABELS.priceInclTax]) {
      expect(text).toContain(piece);
    }
  });

  it("prices in the accessible orange", () => {
    renderCard();

    // The lighter `accent` measures 2.15:1 on white and fails as text;
    // `accent-interactive` is the accessible shade of the same amber.
    const price = screen.getByText(LABELS.priceInclTax).closest("p")!;
    expect(price.innerHTML).toContain("text-accent-interactive");
  });
});
