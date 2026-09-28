import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BannerCarousel } from "@/components/banners/banner-carousel";

/**
 * What the promotional strip does after someone presses an arrow.
 *
 * IT PAUSES, IT NO LONGER STOPS. Stopping outright meant one stray
 * click left the strip frozen for the rest of the visit, with nothing
 * to say why and no way to start it again. Pausing respects the
 * interruption — nobody wants the picture changing out from under the
 * arrow they just pressed — and then hands control back.
 *
 * Three things hold it, and they are NOT the same clock:
 *
 *   a manual move   releases on its own, 8 seconds after the LAST one
 *   hover / focus   releases when the reader leaves, never on a timer
 *   reduced motion  never releases at all
 *
 * Time is faked here because the alternative is a test that waits eight
 * real seconds, and a suite nobody will run is a suite that protects
 * nothing.
 */

const SLIDES = [
  {
    id: "a",
    imageUrl: "/a.png",
    alt: "بنر إعلاني",
    href: null,
    external: false,
  },
  {
    id: "b",
    imageUrl: "/b.png",
    alt: "بنر إعلاني",
    href: null,
    external: false,
  },
  {
    id: "c",
    imageUrl: "/c.png",
    alt: "بنر إعلاني",
    href: null,
    external: false,
  },
];

const LABELS = {
  regionLabel: "لافتات",
  previousLabel: "السابق",
  nextLabel: "التالي",
  goToTemplate: "اذهب إلى {index}",
};

/**
 * The visible slide, read from the image the strip is showing.
 *
 * THE ORIGIN IS STRIPPED, and these cases are about TIMING — which
 * slide is on screen after how long — not about URLs. The carousel
 * absolutises its own `src` now: the API sends image fields as paths
 * on its own origin, and a relative `src` resolves against the WEB
 * origin and 404s, so a component that renders a picture guarantees
 * that itself rather than trusting whoever passed it one. That
 * guarantee is asserted in `images-reach-the-api`; here it would only
 * be noise in front of the fixture names.
 */
function currentSrc(): string {
  const src = screen.getByRole("img").getAttribute("src") ?? "";
  return src.replace(/^https?:\/\/[^/]+/, "");
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderStrip(intervalMs = 1000) {
  return render(
    <BannerCarousel slides={SLIDES} {...LABELS} intervalMs={intervalMs} />,
  );
}

describe("the strip advances on its own", () => {
  it("moves to the next slide after the interval", () => {
    renderStrip();
    expect(currentSrc()).toBe("/a.png");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(currentSrc()).toBe("/b.png");
  });

  it("does not advance when there is only one slide", () => {
    render(
      <BannerCarousel slides={[SLIDES[0]]} {...LABELS} intervalMs={1000} />,
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(currentSrc()).toBe("/a.png");
  });
});

describe("a manual move pauses, then RESUMES", () => {
  it("stops advancing immediately after an arrow is pressed", () => {
    renderStrip();

    act(() => {
      screen.getByRole("button", { name: LABELS.nextLabel }).click();
    });
    expect(currentSrc()).toBe("/b.png");

    // Well past the rotation interval, and it has not moved on: nobody
    // wants the picture changing out from under the arrow they pressed.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(currentSrc()).toBe("/b.png");
  });

  it("resumes 8 seconds after the last manual move", () => {
    renderStrip();

    act(() => {
      screen.getByRole("button", { name: LABELS.nextLabel }).click();
    });

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    // The pause has lifted; the next interval tick moves it along.
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(currentSrc()).toBe("/c.png");
  });

  it("RESTARTS the wait on a second press, rather than resuming from the first", () => {
    renderStrip();

    act(() => {
      screen.getByRole("button", { name: LABELS.nextLabel }).click();
    });
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    // Six seconds in, a second press. If the wait ran from the FIRST
    // press, two more seconds would release it.
    act(() => {
      screen.getByRole("button", { name: LABELS.nextLabel }).click();
    });
    expect(currentSrc()).toBe("/c.png");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(currentSrc()).toBe("/c.png");
  });

  it("pauses for a dot press too, not only an arrow", () => {
    renderStrip();

    act(() => {
      screen.getByRole("button", { name: "اذهب إلى 3" }).click();
    });
    expect(currentSrc()).toBe("/c.png");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(currentSrc()).toBe("/c.png");
  });
});

describe("hover and focus are not on that clock", () => {
  it("holds for as long as the pointer is there, past the 8 seconds", () => {
    renderStrip();
    const region = screen.getByRole("region", { name: LABELS.regionLabel });

    act(() => {
      region.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    // Far longer than the manual-move pause: a reader who is still
    // hovering has not finished reading.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(currentSrc()).toBe("/a.png");
  });

  it("releases the moment the pointer leaves", () => {
    renderStrip();
    const region = screen.getByRole("region", { name: LABELS.regionLabel });

    act(() => {
      region.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(currentSrc()).toBe("/a.png");

    act(() => {
      region.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(currentSrc()).toBe("/b.png");
  });
});

describe("reduced motion is absolute", () => {
  it("never advances, and never resumes after a manual move", () => {
    setReducedMotion(true);
    renderStrip();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(currentSrc()).toBe("/a.png");

    // Pressing an arrow still moves the reader where they asked to go —
    // it is the automatic rotation that stays off, permanently.
    act(() => {
      screen.getByRole("button", { name: LABELS.nextLabel }).click();
    });
    expect(currentSrc()).toBe("/b.png");

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(currentSrc()).toBe("/b.png");
  });
});
