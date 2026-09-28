import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BannerCarousel } from "@/components/banners/banner-carousel";

/**
 * Moving the strip by hand, with no controls painted on the artwork.
 *
 * The arrows and dots are gone: they sat on top of the one thing the
 * strip exists to show, and every promotion had to be designed around
 * two circles and a row of pills that were not part of it. What
 * replaces them is a DRAG — a swipe on a phone, a press-and-pull with a
 * mouse — which costs the picture nothing.
 *
 * Three properties make that safe, and each has a test below:
 *
 *   1. A drag must clear a FLOOR before it counts, because a press is
 *      never perfectly still.
 *   2. A drag must NOT open the banner's destination, or a reader lands
 *      on a page they never saw.
 *   3. Direction follows the READING ORDER, so "next" is the same
 *      gesture in both languages.
 *
 * Keyboard access survives the removal in two screen-reader-only
 * buttons — covered here too, because deleting them would make the
 * strip unusable without a pointer.
 *
 * jsdom implements no PointerEvent constructor, and testing-library
 * silently falls back to a bare `Event` when it is missing — which
 * carries neither `clientX` nor `button`, so every gesture would arrive
 * as a press at x=0 that never moved. The helpers below dispatch a
 * MouseEvent under the pointer event's NAME instead: it carries the two
 * fields the handler actually reads, and React routes it by type.
 */

const LABELS = {
  regionLabel: "Promotions",
  previousLabel: "Previous image",
  nextLabel: "Next image",
  goToTemplate: "Go to image {index}",
};

const slide = (id: string, alt: string, href: string | null = null) => ({
  id,
  imageUrl: `http://localhost:3000/api/v1/banners/${id}/image`,
  alt,
  href,
  external: false,
});

const TWO = [slide("b1", "أول"), slide("b2", "ثاني")];

/** Wider than the 40px floor, and unmistakably a deliberate gesture. */
const FAR = 120;

function strip() {
  return screen.getByTestId("banner-carousel");
}

/** A pointer event carrying the coordinates the handler reads. */
function pointer(
  type: string,
  init: { clientX?: number; button?: number } = {},
) {
  fireEvent(
    strip(),
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientY: 50,
      ...init,
    }),
  );
}

/** One complete gesture: press, travel, release. */
function dragBy(dx: number, from = 300) {
  pointer("pointerdown", { button: 0, clientX: from });
  pointer("pointermove", { clientX: from + dx });
  pointer("pointerup", { button: 0, clientX: from + dx });
}

beforeEach(() => {
  // Reduced motion off, and no auto-advance interfering with what a
  // gesture did — the timer has its own suite.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("nothing is painted on the artwork any more", () => {
  it("shows no arrow and no dot", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    // Not merely hidden: the visible strip has no control in it at all.
    const live = strip().querySelector("[aria-live]") as HTMLElement;
    expect(live.querySelector("button")).toBeNull();
  });

  it("keeps the strip reachable without a pointer", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    // The keyboard path is not a casualty of removing the visuals: the
    // buttons are still in the accessibility tree, occupying no space.
    const next = screen.getByRole("button", { name: "Next image" });
    expect(next).toBeInTheDocument();
    expect(next.closest(".sr-only")).not.toBeNull();
  });

  it("still advances when that hidden control is used", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByAltText("ثاني")).toBeInTheDocument();
  });

  it("gives horizontal gestures to the strip and vertical ones to the page", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    // Without `pan-y` a reader cannot scroll past the banner on a
    // phone, because every vertical swipe is captured here.
    expect(strip().style.touchAction).toBe("pan-y");
  });

  it("stops the browser's own image-drag from stealing the gesture", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    // A native image drag shows a ghost and never reaches pointerup, so
    // the slide would never move.
    const img = screen.getByAltText("أول");
    expect(img).toHaveAttribute("draggable", "false");
    expect(img.className).toContain("select-none");
  });
});

describe("a drag has to mean it", () => {
  it("ignores a press that barely moves", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    // Fingers roll and a mouse shifts a pixel or two as the button goes
    // down. Without a floor, every click would also change the slide.
    dragBy(12);

    expect(screen.getByAltText("أول")).toBeInTheDocument();
  });

  it("ignores a press with no movement at all", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    pointer("pointerdown", { button: 0, clientX: 300 });
    pointer("pointerup", { button: 0, clientX: 300 });

    expect(screen.getByAltText("أول")).toBeInTheDocument();
  });

  it("moves once the gesture clears the floor", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    dragBy(-FAR);

    expect(screen.getByAltText("ثاني")).toBeInTheDocument();
  });

  it("does not start on a right-click", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    pointer("pointerdown", { button: 2, clientX: 300 });
    pointer("pointerup", { button: 2, clientX: 300 - FAR });

    // Opening a context menu is not someone trying to move the strip.
    expect(screen.getByAltText("أول")).toBeInTheDocument();
  });

  it("forgets a gesture the browser cancels", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    pointer("pointerdown", { button: 0, clientX: 300 });
    pointer("pointercancel");
    pointer("pointerup", { button: 0, clientX: 300 - FAR });

    // A cancelled pointer — a system gesture taking over, say — is not
    // a release the reader made.
    expect(screen.getByAltText("أول")).toBeInTheDocument();
  });

  it("does nothing at all when there is only one banner", () => {
    render(<BannerCarousel slides={[slide("b1", "وحيد")]} {...LABELS} />);

    dragBy(-FAR);

    expect(screen.getByAltText("وحيد")).toBeInTheDocument();
  });
});

describe("forward follows the reading direction", () => {
  it("in English, dragging LEFT brings in the next slide", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} isRtl={false} />);

    // The next slide lies to the right, so it is pulled leftwards in.
    dragBy(-FAR);
    expect(screen.getByAltText("ثاني")).toBeInTheDocument();
  });

  it("in English, dragging RIGHT goes back", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} isRtl={false} />);

    dragBy(FAR);
    // Two slides, wrapping backwards from the first.
    expect(screen.getByAltText("ثاني")).toBeInTheDocument();

    dragBy(FAR);
    expect(screen.getByAltText("أول")).toBeInTheDocument();
  });

  it("in Arabic, dragging RIGHT brings in the next slide", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} isRtl />);

    // The order is mirrored, so the same INTENT is the opposite motion.
    dragBy(FAR);
    expect(screen.getByAltText("ثاني")).toBeInTheDocument();
  });

  it("in Arabic, dragging LEFT goes back", () => {
    render(<BannerCarousel slides={TWO} {...LABELS} isRtl />);

    dragBy(-FAR);
    expect(screen.getByAltText("ثاني")).toBeInTheDocument();

    dragBy(-FAR);
    expect(screen.getByAltText("أول")).toBeInTheDocument();
  });
});

describe("a drag never opens the banner", () => {
  const LINKED = [
    slide("b1", "أول", "/ar-SA/opportunities/o1"),
    slide("b2", "ثاني", "/ar-SA/opportunities/o2"),
  ];

  it("swallows the click a completed drag produces", () => {
    render(<BannerCarousel slides={LINKED} {...LABELS} />);

    dragBy(-FAR);

    // The browser fires `click` after `pointerup` at the same spot. Left
    // alone it would follow the link, landing the reader on a
    // destination they never chose to open.
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link").dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
  });

  it("lets a real click through", () => {
    render(<BannerCarousel slides={LINKED} {...LABELS} />);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link").dispatchEvent(click);

    // Nothing was dragged, so the banner opens as it always did.
    expect(click.defaultPrevented).toBe(false);
  });

  it("swallows ONE click, not every click after a drag", () => {
    render(<BannerCarousel slides={LINKED} {...LABELS} />);

    dragBy(-FAR);

    const swallowed = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    screen.getByRole("link").dispatchEvent(swallowed);
    expect(swallowed.defaultPrevented).toBe(true);

    // The next press is a fresh intention. A strip that stayed inert
    // after one swipe would be worse than one with arrows.
    const next = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link").dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });

  it("lets a click through after a press too short to count", () => {
    render(<BannerCarousel slides={LINKED} {...LABELS} />);

    // A finger that rolls 12px is a tap, and a tap on a banner opens it.
    dragBy(12);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByRole("link").dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });
});

describe("reduced motion is not overridden by a gesture", () => {
  it("still lets the reader move the strip by hand", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    render(<BannerCarousel slides={TWO} {...LABELS} />);

    // The setting is about MOTION THE PAGE STARTS. A reader who drags
    // deliberately still expects the slide to change; refusing would be
    // reading the preference as "this strip does nothing".
    dragBy(-FAR);
    expect(screen.getByAltText("ثاني")).toBeInTheDocument();
  });
});
