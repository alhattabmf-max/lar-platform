import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TaxonomyNodeItem } from "@platform/types";
import {
  OfferProgress,
  clampPercent,
} from "@/components/opportunities/offer-progress";
import { BannerCarousel } from "@/components/banners/banner-carousel";
import { CategoryNav } from "@/components/shell/category-nav";
import { buildCategoryTree } from "@/components/shell/category-tree";
import { routing } from "@/i18n/routing";
import arMessages from "../messages/ar-SA.json";
import enMessages from "../messages/en-SA.json";

/**
 * The visitor-facing offer surfaces, against the approved references.
 *
 * Covers the behaviours the founder named: the progress marker tracking
 * the real percentage, "collected" never appearing, a banner with and
 * without a link, subcategories opening, the two detail cards being
 * equal, the square image, and both locales carrying the copy.
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const PROGRESS_LABELS = {
  remaining: "90% remaining",
  endsAt: "Offer ends: 6 September 2026",
  ariaLabel: "10% of the available quantity sold",
};

// ---------------------------------------------------------- progress

describe("the progress marker tracks the real percentage", () => {
  it.each([
    [0, "0%"],
    [10, "10%"],
    [40, "40%"],
    [90, "90%"],
    [100, "100%"],
  ])("shows %i%% and positions the marker there", (percent, text) => {
    const { container } = render(
      <OfferProgress
        progressPercentage={percent}
        locale="ar-SA"
        labels={{ ...PROGRESS_LABELS, ariaLabel: `${percent}% sold` }}
      />,
    );

    expect(screen.getByText(text)).toBeInTheDocument();

    // The marker's offset is computed from the value, so it moves —
    // a fixed position would be decoration pretending to be data.
    const marker = container.querySelector(
      "[style*='inset-inline-start']",
    ) as HTMLElement;
    expect(marker.getAttribute("style")).toContain(`${percent}%`);

    // And the filled track matches.
    const fill = container.querySelector("[style*='width']") as HTMLElement;
    expect(fill.getAttribute("style")).toContain(`${percent}%`);
  });

  it("moves between two different offers rather than sitting at one value", () => {
    const { container: low } = render(
      <OfferProgress
        progressPercentage={10}
        locale="ar-SA"
        labels={PROGRESS_LABELS}
      />,
    );
    const { container: high } = render(
      <OfferProgress
        progressPercentage={90}
        locale="ar-SA"
        labels={PROGRESS_LABELS}
      />,
    );

    const offsetOf = (c: HTMLElement) =>
      (
        c.querySelector("[style*='inset-inline-start']") as HTMLElement
      ).getAttribute("style");

    expect(offsetOf(low)).not.toBe(offsetOf(high));
  });

  it("exposes the bar to assistive tech with its real value", () => {
    render(
      <OfferProgress
        progressPercentage={40}
        locale="en-SA"
        labels={PROGRESS_LABELS}
      />,
    );

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("never says the quantity was collected", () => {
    const { container } = render(
      <OfferProgress
        progressPercentage={40}
        locale="ar-SA"
        labels={PROGRESS_LABELS}
      />,
    );

    // The cap is a supply limit, not a funding goal; reaching it
    // unlocks nothing, and "collected" would say otherwise.
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).not.toContain("collected");
    expect(text).not.toContain("تم جمع");
  });

  it.each([
    [-5, 0],
    [140, 100],
    [Number.NaN, 0],
    [33.4, 33],
    [33.6, 34],
  ])("clamps %s to %i", (input, expected) => {
    expect(clampPercent(input)).toBe(expected);
  });

  it("shows the closing date, and only the closing date", () => {
    render(
      <OfferProgress
        progressPercentage={10}
        locale="en-SA"
        labels={PROGRESS_LABELS}
      />,
    );

    expect(screen.getByText(PROGRESS_LABELS.endsAt)).toBeInTheDocument();
    // The reference shows no start date anywhere on the card.
    expect(screen.queryByText(/opens|يبدأ/i)).toBeNull();
  });
});

// ------------------------------------------------------------ banner

const slide = (
  over: Partial<Parameters<typeof BannerCarousel>[0]["slides"][number]> = {},
) => ({
  id: "b1",
  imageUrl: "http://localhost:3000/api/v1/banners/b1/image",
  alt: "عرض الأسمنت",
  href: null,
  external: false,
  ...over,
});

const BANNER_LABELS = {
  regionLabel: "Promotions",
  previousLabel: "Previous image",
  nextLabel: "Next image",
  goToTemplate: "Go to image {index}",
};

describe("the promotional banner is an image, and only an image", () => {
  it("renders no title or body text over the picture", () => {
    const { container } = render(
      <BannerCarousel slides={[slide()]} {...BANNER_LABELS} />,
    );

    // The stored title exists — as ALT TEXT, which a screen reader
    // hears and a visitor never sees as a caption.
    expect(screen.getByAltText("عرض الأسمنت")).toBeInTheDocument();
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("h1,h2,h3")).toBeNull();
  });

  it("is NOT clickable when it has no link", () => {
    render(
      <BannerCarousel slides={[slide({ href: null })]} {...BANNER_LABELS} />,
    );

    // Nothing should look pressable that leads nowhere.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("makes the WHOLE image clickable when it has one", () => {
    render(
      <BannerCarousel
        slides={[slide({ href: "/ar-SA/opportunities/o1" })]}
        {...BANNER_LABELS}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/ar-SA/opportunities/o1");
    expect(within(link).getByAltText("عرض الأسمنت")).toBeInTheDocument();
  });

  it("never renders the link target as text", () => {
    const { container } = render(
      <BannerCarousel
        slides={[slide({ href: "/ar-SA/opportunities/o1" })]}
        {...BANNER_LABELS}
      />,
    );

    expect(container.textContent).not.toContain("/ar-SA/opportunities/o1");
  });

  it("shows no carousel controls for a single banner", () => {
    render(<BannerCarousel slides={[slide()]} {...BANNER_LABELS} />);
    expect(screen.queryByRole("button", { name: "Next image" })).toBeNull();
  });

  it("advances through several banners on demand", async () => {
    const user = userEvent.setup();
    render(
      <BannerCarousel
        slides={[
          slide({ id: "b1", alt: "أول" }),
          slide({ id: "b2", alt: "ثاني" }),
        ]}
        {...BANNER_LABELS}
      />,
    );

    expect(screen.getByAltText("أول")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByAltText("ثاني")).toBeInTheDocument();
  });

  it("gives each dot a name that says which image it opens", () => {
    render(
      <BannerCarousel
        slides={[slide({ id: "b1" }), slide({ id: "b2" })]}
        {...BANNER_LABELS}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Go to image 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Go to image 2" }),
    ).toBeInTheDocument();
  });

  it("advances on its own after the interval", async () => {
    vi.useFakeTimers();
    try {
      render(
        <BannerCarousel
          slides={[
            slide({ id: "b1", alt: "أول" }),
            slide({ id: "b2", alt: "ثاني" }),
          ]}
          {...BANNER_LABELS}
          intervalMs={1000}
        />,
      );

      expect(screen.getByAltText("أول")).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByAltText("ثاني")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("wraps around rather than stopping at the last image", async () => {
    vi.useFakeTimers();
    try {
      render(
        <BannerCarousel
          slides={[
            slide({ id: "b1", alt: "أول" }),
            slide({ id: "b2", alt: "ثاني" }),
          ]}
          {...BANNER_LABELS}
          intervalMs={1000}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByAltText("أول")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("PAUSES while the pointer is over it", async () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <BannerCarousel
          slides={[
            slide({ id: "b1", alt: "أول" }),
            slide({ id: "b2", alt: "ثاني" }),
          ]}
          {...BANNER_LABELS}
          intervalMs={1000}
        />,
      );

      // An image must not slide out from under someone about to click it.
      fireEvent.mouseEnter(container.querySelector("section") as HTMLElement);
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByAltText("أول")).toBeInTheDocument();

      fireEvent.mouseLeave(container.querySelector("section") as HTMLElement);
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByAltText("ثاني")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("PAUSES while focus is inside it", async () => {
    vi.useFakeTimers();
    try {
      render(
        <BannerCarousel
          slides={[
            slide({ id: "b1", alt: "أول" }),
            slide({ id: "b2", alt: "ثاني" }),
          ]}
          {...BANNER_LABELS}
          intervalMs={1000}
        />,
      );

      fireEvent.focus(screen.getByRole("button", { name: "Next image" }));
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByAltText("أول")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays put once the visitor has chosen a slide themselves", async () => {
    vi.useFakeTimers();
    try {
      render(
        <BannerCarousel
          slides={[
            slide({ id: "b1", alt: "أول" }),
            slide({ id: "b2", alt: "ثاني" }),
          ]}
          {...BANNER_LABELS}
          intervalMs={1000}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Go to image 2" }));
      expect(screen.getByAltText("ثاني")).toBeInTheDocument();

      // Having chosen, having it taken back is worse than no automation.
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });
      expect(screen.getByAltText("ثاني")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not move at all when the visitor asked for reduced motion", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    vi.useFakeTimers();
    try {
      render(
        <BannerCarousel
          slides={[
            slide({ id: "b1", alt: "أول" }),
            slide({ id: "b2", alt: "ثاني" }),
          ]}
          {...BANNER_LABELS}
          intervalMs={1000}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(10000);
      });
      // A stated need, not a preference to weigh. The manual buttons
      // remain the whole interface for these visitors.
      expect(screen.getByAltText("أول")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Next image" }),
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
      window.matchMedia = original;
    }
  });

  it("keeps the live region quiet while it is moving on its own", () => {
    const { container } = render(
      <BannerCarousel
        slides={[slide({ id: "b1" }), slide({ id: "b2" })]}
        {...BANNER_LABELS}
      />,
    );

    // A region that announces itself every few seconds makes a screen
    // reader unusable.
    expect(container.querySelector("[aria-live]")).toHaveAttribute(
      "aria-live",
      "off",
    );
  });

  it("announces politely once the visitor has taken control", () => {
    const { container } = render(
      <BannerCarousel
        slides={[slide({ id: "b1" }), slide({ id: "b2" })]}
        {...BANNER_LABELS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(container.querySelector("[aria-live]")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("marks an external destination so it cannot leak a referrer", () => {
    render(
      <BannerCarousel
        slides={[slide({ href: "https://example.com/promo", external: true })]}
        {...BANNER_LABELS}
      />,
    );

    expect(screen.getByRole("link")).toHaveAttribute(
      "rel",
      "noopener noreferrer nofollow",
    );
  });
});

// -------------------------------------------------------- categories

const node = (over: Partial<TaxonomyNodeItem>): TaxonomyNodeItem => ({
  id: "n1",
  parentId: null,
  nameAr: "تصنيف",
  nameEn: "Category",
  iconUrl: null,
  sortOrder: 0,
  ...over,
});

const NAV_LABELS = {
  homeLabel: "Home",
  homeHref: "/en-SA",
  viewAllLabel: "View all",
  viewAllHref: "/en-SA/opportunities",
  allInCategoryLabel: "All products",
  navLabel: "Categories",
  openTemplate: "Show {name} subcategories",
};

describe("the category bar is built from real taxonomy", () => {
  const NODES = [
    node({ id: "build", nameEn: "Building", sortOrder: 1 }),
    node({ id: "food", nameEn: "Food", sortOrder: 2 }),
    node({ id: "cement", parentId: "build", nameEn: "Cement", sortOrder: 1 }),
    node({ id: "steel", parentId: "build", nameEn: "Steel", sortOrder: 2 }),
    // THE THIRD LEVEL, which the platform allows and this bar used
    // to drop on the floor.
    node({
      id: "grey-cement",
      parentId: "cement",
      nameEn: "Grey cement",
      sortOrder: 1,
    }),
  ];
  const href = (id: string) => `/en-SA/opportunities?taxonomyNodeId=${id}`;

  it("uses the operator's chosen categories, in the operator's order", () => {
    const tree = buildCategoryTree(NODES, ["food", "build"], "en-SA", href);
    expect(tree.map((item) => item.id)).toEqual(["food", "build"]);
  });

  it("falls back to every active root in sortOrder when none is configured", () => {
    const tree = buildCategoryTree(NODES, [], "en-SA", href);
    expect(tree.map((item) => item.id)).toEqual(["build", "food"]);
  });

  it("drops a configured id whose node was retired", () => {
    // An item that 404s is worse than an item that is gone.
    const tree = buildCategoryTree(
      NODES,
      ["build", "deleted-node"],
      "en-SA",
      href,
    );
    expect(tree.map((item) => item.id)).toEqual(["build"]);
  });

  it("attaches each root's children, in order", () => {
    const tree = buildCategoryTree(NODES, [], "en-SA", href);
    expect(tree[0].children.map((c) => c.id)).toEqual(["cement", "steel"]);
    expect(tree[1].children).toEqual([]);
  });

  it("goes all the way down, not one level", () => {
    // «حطّيت تصنيفًا فرعيًّا لفرع، وعند الضغط عليه في صفحة الزائر ما
    //  انبثق منه الفرع الفرعي.»
    //
    // IT BUILT ONE LEVEL. `TAXONOMY_MAX_DEPTH` is 3, the console
    // manages three and the server serves three — so a third-level
    // category existed everywhere except the one place a buyer
    // could reach it.
    const tree = buildCategoryTree(NODES, [], "en-SA", href);
    const cement = tree[0].children.find((c) => c.id === "cement");

    expect(cement?.children.map((c) => c.id)).toEqual(["grey-cement"]);
    // And a branch with nothing under it says so, rather than being
    // undefined for the panel to guess at.
    expect(tree[0].children.find((c) => c.id === "steel")?.children).toEqual(
      [],
    );
  });

  it("builds the third level's destination from an id too", () => {
    const tree = buildCategoryTree(NODES, [], "en-SA", href);
    const leaf = tree[0].children[0].children[0];
    expect(leaf.href).toContain("taxonomyNodeId=grey-cement");
  });

  it("builds every destination from an id, never from a stored URL", () => {
    const tree = buildCategoryTree(NODES, [], "en-SA", href);
    for (const item of [tree[0], ...tree[0].children]) {
      expect(item.href).toContain("taxonomyNodeId=");
    }
  });

  it("uses the Arabic name under ar-SA", () => {
    const tree = buildCategoryTree(
      [node({ id: "x", nameAr: "مواد البناء", nameEn: "Building" })],
      [],
      "ar-SA",
      href,
    );
    expect(tree[0].label).toBe("مواد البناء");
  });

  it("opens a category's subcategories on demand, from the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <CategoryNav
        items={buildCategoryTree(NODES, [], "en-SA", href)}
        {...NAV_LABELS}
      />,
    );

    // Closed to begin with.
    expect(screen.queryByRole("link", { name: "Cement" })).toBeNull();

    const toggle = screen.getByRole("button", {
      name: "Show Building subcategories",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Cement" })).toHaveAttribute(
      "href",
      "/en-SA/opportunities?taxonomyNodeId=cement",
    );
    expect(screen.getByRole("link", { name: "Steel" })).toBeInTheDocument();
  });

  it("keeps the parent reachable without saying its name twice", async () => {
    // «عند عرض التصنيفات يظهر اسم التصنيف، لا تكرّر اسمه، واكتب بدله
    // جميع المنتجات.»
    //
    // The entry exists so a category WITH branches stays choosable in
    // its own right — that has not changed. What changed is what it
    // SAYS: it repeated the name on the button four pixels above it,
    // two identical words of which only one navigated.
    const user = userEvent.setup();
    render(
      <CategoryNav
        items={buildCategoryTree(NODES, [], "en-SA", href)}
        {...NAV_LABELS}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Show Building subcategories" }),
    );

    expect(screen.getByRole("link", { name: "All products" })).toHaveAttribute(
      "href",
      "/en-SA/opportunities?taxonomyNodeId=build",
    );
    // And the name is on the opener alone.
    expect(screen.queryByRole("link", { name: "Building" })).toBeNull();
  });

  it("renders a childless category as a plain link, not a menu button", () => {
    render(
      <CategoryNav
        items={buildCategoryTree(NODES, [], "en-SA", href)}
        {...NAV_LABELS}
      />,
    );

    expect(screen.getByRole("link", { name: "Food" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Food/ })).toBeNull();
  });

  it("always offers Home, so the bar is never empty", () => {
    render(<CategoryNav items={[]} {...NAV_LABELS} />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/en-SA",
    );
  });

  it("offers the full list SECOND, right after Home", () => {
    render(
      <CategoryNav
        items={buildCategoryTree(NODES, [], "en-SA", href)}
        {...NAV_LABELS}
      />,
    );

    const bar = screen.getByTestId("category-nav");
    const entries = Array.from(bar.querySelectorAll("li > a, li > button")).map(
      (el) => el.textContent?.trim(),
    );

    // Home, then the way into every offer, then the real categories in
    // the administrator's order. A reader looking for "everything"
    // should not have to scan past the taxonomy to find it.
    expect(entries[0]).toBe("Home");
    expect(entries[1]).toBe("View all");
    expect(screen.getByTestId("nav-view-all")).toHaveAttribute(
      "href",
      "/en-SA/opportunities",
    );
  });

  it("puts the full-list link in the bar and NOWHERE else on the landing page", () => {
    // It used to sit beside a heading on the landing page as well, so
    // the same destination appeared twice and moved depending on which
    // page you were on.
    const home = read("app/[locale]/(public)/page.tsx");
    expect(home).not.toContain('t("viewAll")');
    expect(home).not.toContain("/opportunities`}");
  });
});

// --------------------------------------------------- layout contract

describe("the reference layout is honoured", () => {
  const CARD = read("components/opportunities/opportunity-card.tsx");
  const DETAIL = read("components/opportunities/opportunity-detail.tsx");

  it("the card image is square, cropped rather than stretched", () => {
    expect(CARD).toContain("aspect-square");
    // object-cover crops; object-fill would distort.
    expect(read("components/opportunities/opportunity-image.tsx")).toContain(
      "object-cover",
    );
  });

  it("the detail image is square too", () => {
    expect(DETAIL).toContain("aspect-square");
  });

  it("the card uses the THUMBNAIL and the detail the full-resolution image", () => {
    expect(CARD).toContain("opportunity.thumbnailUrl");
    expect(DETAIL).toContain("opportunity.imageUrl");
  });

  it("puts ONE, TWO and THREE across, by width", () => {
    // THE OWNER SET TWO — «طبّق تصميم بطاقة المنتج بطاقتين في الصف» —
    // and then set three: «أحتاج أقلّل بعض المعلومات عشان يصير الصف
    // يأخذ ثلاث بطاقات».
    //
    // AND THE THIRD CARD WAS BOUGHT, not squeezed in. The photograph
    // went from 112 pixels to 80, the selling unit moved onto the
    // price, and the two figures the bar already answers went to the
    // detail page. The earlier argument that a third column had to
    // shrink the other two was true of the card as it stood then.
    //
    // THE GRID IS A COMPONENT, because the buyer's home shows the same
    // thing — «والصفحة الرئيسية للمشتري نفس محتوى الصفحة الرئيسية في
    // واجهة الزائر» — and two pages that agreed on the day they were
    // written is not the same content.
    const home = read("components/home/home-content.tsx");

    // TWO FROM THE START NOW — «أفضّل بطاقتين» — and three from
    // `lg`. What paid for the second card on a phone is the same
    // thing that paid for the third on a desktop: the figures the
    // detail page already carries left the card.
    expect(home).toContain("grid-cols-2");
    expect(home).toContain("lg:grid-cols-3");
    expect(home).not.toContain("grid-cols-1");
  });

  it("needs no breakout container, because there is no column to break out of", () => {
    // IT HAD ONE, and this is where it went. The grid used to widen
    // past the shell's 1152px column at 1600px — a width and equal
    // negative margins of (1536 − 1120) / 2 = 208 — purely so a THIRD
    // card could fit without shrinking the other two.
    //
    // The public front stands on a full-width sheet under its tab row
    // now, exactly as the two portals do. A negative margin measured
    // against a column that no longer exists would pull the grid off
    // the sheet's edge, and the two cards have the room the breakout
    // was buying them anyway.
    const home = read("components/home/home-content.tsx");

    expect(home).not.toContain("min-[1600px]");
    expect(home).not.toMatch(/-mx-\[\d+px\]/);
  });

  it("gives EVERY listing the same grid, at the same breakpoints", () => {
    // The all-products page used to break at `lg` where the landing
    // page broke at `sm`, so a tablet showed one card on one and two
    // on the other. The buyer's market went further and showed three
    // where both others showed two — «لا أريد اختلافًا في شكل بطاقة
    // المنتج في الرئيسية وفي السوق أو أي صفحة تحمل منتجًا معروضًا».
    const home = read("components/home/home-content.tsx");
    const pages = [
      read("app/[locale]/(public)/opportunities/page.tsx"),
      read("app/[locale]/trader/opportunities/page.tsx"),
    ];

    // ASSERTED AGAINST EACH OTHER rather than against a literal, so
    // the three cannot drift apart again.
    //
    // THE WHOLE CLASS, PREFIX AND ALL. The two-column rule carries no
    // breakpoint any more — it is the base — so matching only the
    // prefix would compare `undefined` with `undefined` and pass
    // whatever the three pages said.
    for (const re of [/[\w:]*grid-cols-2/, /[\w:]*grid-cols-3/]) {
      const here = home.match(re)?.[0];
      expect(here).toBeTruthy();
      for (const page of pages) expect(page.match(re)?.[0]).toBe(here);
    }
  });

  it("carries no leftover shrink rule from the three-across attempt", () => {
    // The scale-down existed only to fit three cards into the current
    // container. Left behind, it would shrink the card on exactly the
    // wide screens where it now has MORE room, not less.
    for (const file of [
      "components/opportunities/opportunity-card.tsx",
      "components/opportunities/offer-progress.tsx",
    ]) {
      expect(read(file)).not.toContain("min-[1600px]");
    }
  });

  it("wears the buyer's own two tracks, wide then narrow", () => {
    // «بطاقة عرض تفاصيل المنتج في صفحة الزائر عدّلها مثل عرض تفاصيل
    // المنتج في صفحة المشتري.»
    //
    // IT USED TO BE TWO EQUAL COLUMNS, which was right while this
    // screen had a layout of its own. It has none now — the same
    // component draws both fronts — so the measure is the buyer's:
    // a wide track for what the offer IS, and a 22rem track holding
    // the purchase above the package, which is what gives those two
    // ONE width without anybody matching them by hand.
    expect(DETAIL).toContain("lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]");
    expect(DETAIL).not.toContain("lg:grid-cols-2");
  });

  it("stretches neither column to the other's height", () => {
    // `items-start` because the two tracks hold different amounts and
    // neither should be padded out to match: each card inside a column
    // already meets its neighbour's width, and forcing equal heights
    // is what used to leave a field of empty space beside the text.
    expect(DETAIL).toContain("items-start");
    expect(DETAIL).not.toContain("items-stretch");
    // AND NOTHING IS HELD OPEN BY `h-full`, which was the tool for the
    // equal-height layout that is gone.
    expect(DETAIL.match(/h-full/g)?.length ?? 0).toBe(0);
  });

  it("shows the price in the accessible orange and headings in the petrol blue", () => {
    // `accent` alone measures 2.15:1 on white and fails as text.
    expect(CARD).toContain("text-accent-interactive");
    expect(CARD).toContain("text-primary");
  });

  it("uses no raw colour anywhere — tokens only", () => {
    for (const source of [
      CARD,
      DETAIL,
      read("components/opportunities/offer-progress.tsx"),
    ]) {
      expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});

// ------------------------------------------------------ both locales

describe("Arabic and English are equal partners", () => {
  const KEYS = [
    "marketplace.card.region",
    "marketplace.card.targetQuantity",
    "marketplace.card.remainingQuantity",
    "marketplace.card.minimumOrder",
    "marketplace.card.priceInclTax",
    "marketplace.progress.remaining",
    "marketplace.progress.endsAt",
    "marketplace.detail.registerToBuy",
    "marketplace.detail.visitorNotice",
    "shell.header.signIn",
    "shell.header.switchLocale",
    "shell.footer.about",
    "shell.footer.faq",
    "shell.footer.contact",
    "pages.about.title",
    "pages.faq.title",
    "pages.contact.title",
  ];

  const at = (messages: unknown, dotted: string): unknown =>
    dotted
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)?.[part],
        messages,
      );

  it.each(KEYS)("%s exists and is non-empty in both locales", (key) => {
    for (const messages of [arMessages, enMessages]) {
      const value = at(messages, key);
      expect(typeof value).toBe("string");
      expect((value as string).trim()).not.toBe("");
    }
  });

  it.each(KEYS)(
    "%s is genuinely translated, not the same string twice",
    (key) => {
      // A key that reads identically in both locales is usually an
      // untranslated placeholder.
      expect(at(arMessages, key)).not.toBe(at(enMessages, key));
    },
  );

  it("both locales are shipped", () => {
    expect([...routing.locales]).toEqual(["ar-SA", "en-SA"]);
  });
});

describe("one detail screen, drawn once", () => {
  // «بطاقة عرض تفاصيل المنتج في صفحة الزائر عدّلها مثل عرض تفاصيل
  // المنتج في صفحة المشتري.»
  //
  // THE ANSWER WAS EXTRACTION, NOT A COPY. The obvious way to make the
  // two match was to paste six hundred lines into the second file —
  // which is exactly how the offer CARDS drifted apart before the
  // owner asked for them to be unified. Two files cannot stay
  // identical; one file cannot differ from itself. These cases are
  // what stop the copy from coming back.
  const shared = "components/opportunities/opportunity-detail.tsx";
  // The import carries no extension, so the pages are matched on the
  // module specifier they actually write.
  const sharedImport = "@/components/opportunities/opportunity-detail";
  const visitor = read("app/[locale]/(public)/opportunities/[id]/page.tsx");
  const buyer = read("app/[locale]/trader/opportunities/[id]/page.tsx");

  it("has both fronts render the SAME component", () => {
    for (const [name, page] of [
      ["visitor", visitor],
      ["buyer", buyer],
    ]) {
      expect([name, page.includes("<OpportunityDetail")]).toEqual([name, true]);
      expect([name, page.includes(sharedImport)]).toEqual([name, true]);
    }
  });

  it("leaves neither page drawing a card of its own", () => {
    // THE FOUR SECTIONS LIVE IN ONE FILE. A `data-testid` for a card
    // appearing in a ROUTE again means somebody started a second copy.
    for (const [name, page] of [
      ["visitor", visitor],
      ["buyer", buyer],
    ]) {
      for (const card of [
        "detail-product-card",
        "detail-shipping-card",
        "detail-purchase-card",
        "detail-package-card",
      ]) {
        expect([name, card, page.includes(card)]).toEqual([name, card, false]);
      }
    }
  });

  it("keeps the purchase a SLOT, never a flag inside the cards", () => {
    // The buyer's front fills it with the composer that creates a
    // checkout session; the visitor's fills it with the way in. The
    // component knows neither — which is why no `isVisitor` branch can
    // grow inside it and start hiding what a visitor should see.
    const cards = read(shared);
    expect(cards).toContain("purchase: ReactNode");
    expect(cards).toContain("{purchase}");
    // Scanned with prose removed: the note explaining WHAT the buyer's
    // slot holds names a checkout session, and a guard that cannot
    // tell a sentence from a symbol is a guard nobody can write to.
    const isProse = (line: string) => {
      const head = line.trimStart();
      return head.startsWith("/") || head.startsWith("*");
    };
    const code = cards
      .split(String.fromCharCode(10))
      .filter((line) => !isProse(line))
      .join(String.fromCharCode(10));
    expect(code).not.toContain("session");
    expect(code).not.toContain("isVisitor");
    expect(code).not.toContain("PurchaseComposer");

    expect(buyer).toContain("purchase={");
    expect(visitor).toContain("purchase={");
  });

  it("passes the one field a visitor's contract does not carry, or none", () => {
    // `expectedPreparationDays` is the buyer's alone. It is optional on
    // the component and prints a dash when absent — a missing ROW would
    // read as a platform that forgot to ask.
    const cards = read(shared);
    expect(cards).toContain("expectedPreparationDays?: number");
    expect(cards).toContain(
      "opportunity.expectedPreparationDays === undefined",
    );
  });
});
