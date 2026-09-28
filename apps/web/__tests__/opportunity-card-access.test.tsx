import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PublicOpportunityItem } from "@platform/types";
import {
  OpportunityCard,
  type OpportunityCardLabels,
} from "@/components/opportunities/opportunity-card";
import arMessages from "../messages/ar-SA.json";
import enMessages from "../messages/en-SA.json";
import { routing, type AppLocale } from "@/i18n/routing";

/**
 * A visitor must be able to reach an opportunity's detail page.
 *
 * The bug
 * -------
 * The card was, in practice, a dead end. `labels.viewDetails` was
 * declared on the props, translated in both locales, and passed by both
 * pages — and never rendered. The heading was a link, but styled only
 * with `hover:text-secondary focus-visible:underline`: no colour and no
 * underline at rest, so it read as plain text. A visitor on the
 * homepage or `/opportunities` had no visible way in, and a touch user
 * had no hover state to discover one.
 *
 * The card is used by BOTH surfaces the founder reported — the homepage
 * grid and the `/opportunities` list render this same component — so
 * covering it here covers both. The pages are checked separately for
 * passing the interpolated accessible name.
 */

function opportunity(
  overrides: Partial<PublicOpportunityItem> = {},
): PublicOpportunityItem {
  return {
    id: "1b0dc1b1-5b21-4091-b936-a7f22b937742",
    productNameAr: "أسمنت بورتلاندي",
    productNameEn: "Portland Cement",
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
    endAt: "2026-09-06T18:57:00.000Z",
    status: "ACTIVE",
    imageUrl: null,
    thumbnailUrl: null,
    ...overrides,
  } as PublicOpportunityItem;
}

/** Built the way the pages build it, from the real catalogue. */
function labelsFor(locale: AppLocale): OpportunityCardLabels {
  const m = locale === "ar-SA" ? arMessages : enMessages;
  const card = m.marketplace.card;
  const name = locale === "ar-SA" ? "أسمنت بورتلاندي" : "Portland Cement";
  return {
    regionLabel: card.region,
    unitLabel: card.unit,
    targetLabel: card.targetQuantity,
    remainingLabel: card.remainingQuantity,
    minimumOrderLabel: card.minimumOrder,
    priceInclTax: card.priceInclTax,
    priceUnavailable: "السعر غير متاح حاليًا",
    scheduledBadge: card.scheduled,
    noImage: card.noImage,
    viewDetails: card.viewDetails,
    viewDetailsFor: card.viewDetailsFor.replace("{name}", name),
    targetValue: "100",
    remainingValue: "90",
    minimumOrderValue: "10",
    // A GROUP OFFER, which is what every fixture here was written
    // to describe: a progress bar and a countdown, not a shelf.
    saleMode: "GROUP" as const,
    stockLabel: "",
    soldOut: false,
    progress: {
      remaining: m.marketplace.progress.remaining.replace("{percent}", "90"),
      endsAt: m.marketplace.progress.endsAt.replace("{date}", "2026"),
      ariaLabel: m.marketplace.progress.ariaLabel.replace("{percent}", "10"),
    },
  };
}

const HREF = "/opportunities/1b0dc1b1-5b21-4091-b936-a7f22b937742";

describe.each([...routing.locales])("opportunity card — %s", (locale) => {
  const labels = labelsFor(locale);
  const productName =
    locale === "ar-SA" ? "أسمنت بورتلاندي" : "Portland Cement";

  function renderCard() {
    return render(
      <OpportunityCard
        opportunity={opportunity()}
        locale={locale}
        labels={labels}
      />,
    );
  }

  it("offers a visible 'view details' action that opens the detail page", () => {
    renderCard();

    const action = screen.getByRole("link", { name: labels.viewDetailsFor });
    expect(action).toHaveAttribute("href", `/${locale}${HREF}`);
    // The visible text is the short label; the accessible name is the
    // long one. Both matter, for different readers.
    expect(action).toHaveTextContent(labels.viewDetails);
  });

  it("the product name is also a link to the same page", () => {
    renderCard();

    const heading = screen.getByRole("heading", { level: 3 });
    const link = within(heading).getByRole("link");
    expect(link).toHaveAttribute("href", `/${locale}${HREF}`);
    expect(link).toHaveTextContent(productName);
  });

  it("offers an unmistakable way in AT REST, not only on hover", () => {
    renderCard();

    // THE RULE UNDER THE NAME CAME OFF — «ألغِ الخط اللي تحت الكتابات
    // مثل اسم المنتج، مشوّه للصورة». In a grid of twelve cards it read
    // as a stroke through the page.
    const heading = within(screen.getByRole("heading", { level: 3 }));
    expect(heading.getByRole("link").className).not.toMatch(/\bunderline\b/);

    // AND THE NAME NO LONGER CARRIES ITS OWN AFFORDANCE. `text-primary`
    // measures 1.07:1 against the body ink beside it — the same navy to
    // any eye — so colour was never doing this work and the rule was
    // doing all of it.
    //
    // WHAT THIS TEST EXISTS FOR IS THE CARD, NOT THE NAME. Reserving
    // every affordance for :hover is what once made the card read as
    // plain text and the detail page unreachable; that is answered now
    // by a FILLED button carrying the same address, visible at rest to
    // a reader who never hovers and never will — a phone.
    const action = screen.getByTestId("offer-card-action");
    expect(action).toHaveAttribute("href", `/${locale}${HREF}`);
    expect(action.className).toMatch(/bg-secondary/);

    // The name stays a real link: reachable, named, and focus-ringed.
    const link = heading.getByRole("link");
    expect(link).toHaveAttribute("href", `/${locale}${HREF}`);
    expect(link.className).toMatch(/focus-visible:outline/);
    // The reference puts headings in the petrol blue, not the teal.
    expect(link.className).toMatch(/text-primary/);
  });

  it("all three routes in are reachable by keyboard, in order", async () => {
    const user = userEvent.setup();
    renderCard();

    const headingLink = within(
      screen.getByRole("heading", { level: 3 }),
    ).getByRole("link");
    const action = screen.getByRole("link", { name: labels.viewDetailsFor });

    // Image first (it comes first in the DOM), then the name, then the
    // action — every one operable without a mouse.
    await user.tab();
    const imageLink = document.activeElement as HTMLElement;
    expect(imageLink.getAttribute("href")).toBe(`/${locale}${HREF}`);

    await user.tab();
    expect(headingLink).toHaveFocus();
    await user.tab();
    expect(action).toHaveFocus();
  });

  it("every route in points at the detail page, and there are exactly three", () => {
    renderCard();

    // Image, product name, and the explicit action — the three the
    // reference calls for.
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link).toHaveAttribute("href", `/${locale}${HREF}`);
    }
  });

  it("every route in is named after this offer, not a generic word", () => {
    renderCard();

    // Queried by ACCESSIBLE NAME, which is what a screen reader
    // announces — for the image link that name comes from the image's
    // alt text, which is the product name.
    const named = screen.getAllByRole("link", {
      name: new RegExp(productName),
    });
    expect(named).toHaveLength(3);

    // And nothing is announced as a bare "image" or "link".
    expect(screen.queryByRole("link", { name: /^image$/i })).toBeNull();
  });

  it("the action names the opportunity, so a link list is not all identical", () => {
    renderCard();

    const action = screen.getByRole("link", { name: labels.viewDetailsFor });
    expect(action.getAttribute("aria-label")).toContain(productName);
    // The bare label alone would be ambiguous across a grid.
    expect(action.getAttribute("aria-label")).not.toBe(labels.viewDetails);
  });

  it("the action is a shared button, not a hand-sized link", () => {
    // It used to carry its own 44px. The height is the system's now —
    // 32px on a desktop and on a phone alike — and what this holds is
    // that the card does not set one itself.
    renderCard();
    const action = screen.getByRole("link", { name: labels.viewDetailsFor });
    expect(action.className).not.toMatch(/min-h-11/);
    expect(action.className).toMatch(/min-h-control/);
  });
});

describe("both public surfaces pass the interpolated accessible name", () => {
  const SURFACES = [
    "components/home/home-content.tsx",
    "app/[locale]/(public)/opportunities/page.tsx",
  ];

  it.each(SURFACES)(
    "%s builds viewDetailsFor from the product name",
    async (file) => {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const source = readFileSync(join(__dirname, "..", file), "utf8");

      // Both surfaces render the same card through the SHARED label
      // builder, which is what supplies the interpolated accessible name.
      // Building the bag twice is how one grid ends up announcing
      // "View details" N times while the other does not.
      expect(source).toContain("offerCardLabels");
    },
  );
});

describe("the catalogue carries the copy in both locales", () => {
  it.each([...routing.locales])(
    "%s has viewDetails and viewDetailsFor",
    (locale) => {
      const card = (locale === "ar-SA" ? arMessages : enMessages).marketplace
        .card;
      expect(card.viewDetails.trim()).not.toBe("");
      expect(card.viewDetailsFor).toContain("{name}");
    },
  );

  it("the two locales say different things, so neither is an untranslated copy", () => {
    expect(arMessages.marketplace.card.viewDetails).not.toBe(
      enMessages.marketplace.card.viewDetails,
    );
  });
});
