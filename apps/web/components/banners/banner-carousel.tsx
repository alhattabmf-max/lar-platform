"use client";

import { DEFAULT_BANNER_IMAGE_SHAPE } from "@platform/types";

import { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl } from "@/lib/media-url";
import Link from "next/link";

/**
 * The promotional strip: IMAGES ONLY, advancing on their own.
 *
 * No text of any kind is drawn over or under the picture — every word a
 * visitor reads is inside the artwork itself. Nothing internal is
 * rendered: the link target is used as an href and never displayed.
 *
 * A banner with a link is one big clickable image; a banner without one
 * is inert and is NOT wrapped in an anchor, so nothing looks pressable
 * that does not lead anywhere. Which links are permitted is decided
 * upstream by `isRenderableLink` — this component only renders what it
 * is handed.
 *
 * NO VISIBLE CONTROLS
 * -------------------
 * The arrows and dots are gone. They sat on top of the artwork, which is
 * the one thing the strip exists to show, and every promotion had to be
 * designed around two circles and a row of pills that were not part of
 * it. Manual movement is a DRAG now — a swipe on a phone, a press-and-
 * pull with a mouse — which costs the picture nothing.
 *
 * Keyboard access is NOT dropped with them. Two screen-reader-only
 * buttons carry it: they are in the accessibility tree and reachable by
 * Tab, and they occupy no space and paint no pixels. Removing them
 * instead would make the strip unusable without a pointer, which is a
 * different problem from the one being solved.
 *
 * MOVEMENT, AND WHEN IT STOPS
 * ---------------------------
 * The slides advance quietly on a timer, and the timer yields to the
 * person:
 *
 *   - Pointer over the strip pauses it, so an image cannot slide out
 *     from under someone about to click it.
 *   - Focus inside it pauses it, for the same reason with a keyboard.
 *   - A manual move pauses it and it RESUMES eight seconds after the
 *     last one — long enough to read the slide someone chose, short
 *     enough that the strip does not look broken to a reader who has
 *     moved on.
 *   - `prefers-reduced-motion: reduce` disables it outright, and no
 *     manual move brings it back. That is a stated need, not a
 *     preference to weigh.
 *
 * `aria-live` is "off" while it is running: a region that announces
 * itself every few seconds makes a screen reader unusable. It switches
 * to "polite" once paused, which is when a change is the result of
 * something the person just did.
 */
export interface BannerCarouselSlide {
  id: string;
  /** Absolute image URL, already resolved against the API origin. */
  imageUrl: string;
  /** A generic translated description — never a brand or operator string. */
  alt: string;
  /** Internal path or allowlisted https URL, already validated. */
  href: string | null;
  /** True when `href` leaves this site. */
  external: boolean;
}

export interface BannerCarouselProps {
  slides: BannerCarouselSlide[];
  regionLabel: string;
  previousLabel: string;
  nextLabel: string;
  /** "Go to image {index}", carrying an {index} placeholder. */
  goToTemplate: string;
  /** Overridable so a test does not have to wait real seconds. */
  intervalMs?: number;
  /** True in Arabic. Decides which way a drag means "forward". */
  isRtl?: boolean;
}

/** Slow enough to read a promotion, brisk enough to see the next one. */
const DEFAULT_INTERVAL_MS = 6000;

/**
 * How long a manual move holds the rotation before it resumes.
 *
 * Long enough to read the slide someone deliberately chose, short
 * enough that the strip does not look broken to a reader who has moved
 * on. Hover and focus are not on this clock — they hold for exactly as
 * long as the reader is there.
 */
const RESUME_AFTER_MS = 8_000;

/**
 * How far a pointer must travel before it counts as a drag.
 *
 * A press is never perfectly still: fingers roll on a screen and a
 * mouse shifts a pixel or two as the button goes down. Without a floor,
 * every click on a banner would also change the slide, and the reader
 * would land on a destination they never saw. 40px is comfortably more
 * than incidental movement and comfortably less than a deliberate
 * swipe.
 */
const DRAG_THRESHOLD_PX = 40;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}

export function BannerCarousel({
  slides,
  regionLabel,
  previousLabel,
  nextLabel,
  goToTemplate,
  intervalMs = DEFAULT_INTERVAL_MS,
  isRtl = false,
}: BannerCarouselProps) {
  const [index, setIndex] = useState(0);
  const [interacting, setInteracting] = useState(false);
  /**
   * A manual move PAUSES the rotation; it does not stop it forever.
   *
   * The state is the TIMESTAMP of the last manual move rather than a
   * flag, because "resume 8 seconds after the last one" needs to know
   * when the last one was. Storing a boolean and a separate timer would
   * be two things to keep in step.
   */
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Where a drag began, and whether it ever passed the threshold.
   *
   * A ref, not state: it changes on every pointer move and nothing on
   * screen depends on it, so re-rendering the strip mid-drag would be
   * work for no one.
   */
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  /**
   * Set for one tick after a drag ends, to swallow the click the
   * browser fires next.
   *
   * A drag that started on a linked banner ends with a `click` on that
   * anchor — the pointer went down and up inside it, which is all a
   * click is. Without this, every swipe would also open the banner's
   * destination.
   */
  const swallowClick = useRef(false);

  // The pause lifts on its own, once nothing has been pressed for a
  // while. Hover and focus are NOT on this clock: they hold the strip
  // for exactly as long as the reader is there, and release the moment
  // they leave.
  useEffect(() => {
    if (pausedAt === null) return;
    const lift = setTimeout(() => setPausedAt(null), RESUME_AFTER_MS);
    return () => clearTimeout(lift);
  }, [pausedAt]);

  const many = slides.length > 1;
  const running = many && !interacting && pausedAt === null && !reducedMotion;

  useEffect(() => {
    if (!running) return;
    timer.current = setInterval(
      () => setIndex((current) => (current + 1) % slides.length),
      intervalMs,
    );
    return () => {
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
    };
  }, [running, slides.length, intervalMs]);

  /** A manual move: go there, and hold the rotation for a while. */
  const goTo = useCallback((next: number) => {
    // A fresh timestamp on every move, so moving twice restarts the
    // wait rather than resuming eight seconds after the FIRST one.
    setPausedAt(Date.now());
    setIndex(next);
  }, []);

  const step = useCallback(
    (delta: number) => {
      setPausedAt(Date.now());
      setIndex((current) => (current + delta + slides.length) % slides.length);
    },
    [slides.length],
  );

  function onPointerDown(event: React.PointerEvent) {
    // Only a primary press starts a drag: a right-click or a middle
    // click is not someone trying to move the strip.
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, moved: false };
  }

  function onPointerMove(event: React.PointerEvent) {
    const start = drag.current;
    if (!start) return;
    if (Math.abs(event.clientX - start.x) >= DRAG_THRESHOLD_PX)
      start.moved = true;
  }

  function onPointerUp(event: React.PointerEvent) {
    const start = drag.current;
    drag.current = null;
    if (!start || !many) return;

    const dx = event.clientX - start.x;
    if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;

    // Swallow the click this drag is about to produce, so a swipe never
    // opens the banner's destination.
    swallowClick.current = true;

    // WHICH WAY IS FORWARD depends on the reading direction. In English
    // the next slide lies to the right, so dragging LEFT brings it in.
    // In Arabic the order is mirrored and dragging RIGHT does.
    const forward = isRtl ? dx > 0 : dx < 0;
    step(forward ? 1 : -1);
  }

  function onPointerCancel() {
    drag.current = null;
  }

  function onClickCapture(event: React.MouseEvent) {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  if (slides.length === 0) return null;

  const current = slides[Math.min(index, slides.length - 1)];

  // A FIXED FRAME, at the ratio the upload policy prefers.
  //
  // `object-cover` needs a height to cover; on an auto-height image it
  // does nothing, and the strip took whatever shape each file happened
  // to be — so slides of different proportions made the page jump as
  // the carousel advanced. The frame also means an image that is within
  // the accepted band but not exactly 5:1 is cropped rather than
  // stretched, which is why the admin screen previews the same crop.
  //
  // The ratio is read from the shared shape, not written here, so the
  // frame and the rule an operator is held to are one number.
  const image = (
    <div
      className="w-full overflow-hidden rounded-lg"
      style={{
        aspectRatio: String(DEFAULT_BANNER_IMAGE_SHAPE.preferredAspectRatio),
      }}
      data-testid="banner-frame"
    >
      <img
        // ITS OWN GUARANTEE, not its caller's. `banner-slot` does
        // absolutise these, but a component that renders an image
        // should not need to know that. `mediaUrl` returns an
        // absolute URL unchanged, so asking again costs nothing.
        src={mediaUrl(current.imageUrl)}
        alt={current.alt}
        // EAGER, BECAUSE THIS IS THE PAGE'S FIRST PICTURE.
        //
        // `loading="lazy"` tells the browser the image is probably
        // below the fold and may wait. This one is never below the
        // fold — it is the widest thing on the home page and the first
        // thing a visitor looks at — so the hint was deferring the
        // very pixel the page is judged by, and the frame sat empty
        // while everything under it painted.
        //
        // AND IT IS ASKED FOR FIRST. `fetchPriority` moves it ahead of
        // the scripts queued beside it, which is the whole difference
        // between a banner that is there on arrival and one that
        // appears a beat later.
        loading="eager"
        fetchPriority="high"
        decoding="async"
        // A drag on an image would otherwise become the browser's own
        // image-drag, which shows a ghost and never reaches pointerup.
        draggable={false}
        className="h-full w-full select-none object-cover"
      />
    </div>
  );

  return (
    <section
      aria-label={regionLabel}
      aria-roledescription="carousel"
      className="relative"
      data-testid="banner-carousel"
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocus={() => setInteracting(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setInteracting(false);
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClickCapture={onClickCapture}
      // Horizontal swipes belong to the strip; vertical ones stay with
      // the page, so a reader can still scroll past it on a phone.
      style={{ touchAction: "pan-y" }}
    >
      <div aria-live={running ? "off" : "polite"} aria-atomic="true">
        {current.href === null ? (
          // Inert on purpose: no anchor, no pointer cursor, nothing that
          // suggests a destination that does not exist.
          image
        ) : current.external ? (
          <a
            href={current.href}
            rel="noopener noreferrer nofollow"
            draggable={false}
            className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {image}
          </a>
        ) : (
          <Link
            href={current.href}
            draggable={false}
            className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {image}
          </Link>
        )}
      </div>

      {/*
        THE KEYBOARD PATH, and nothing on screen.

        `sr-only` keeps these in the accessibility tree and in the tab
        order while painting nothing, so the artwork is uncovered and
        the strip is still operable without a pointer. Dropping them
        with the visible arrows would have traded one problem for a
        worse one.
      */}
      {many ? (
        <div className="sr-only">
          <button
            type="button"
            aria-label={previousLabel}
            onClick={() => step(-1)}
          >
            {previousLabel}
          </button>
          <button type="button" aria-label={nextLabel} onClick={() => step(1)}>
            {nextLabel}
          </button>
          {slides.map((slide, position) => (
            <button
              key={slide.id}
              type="button"
              aria-label={goToTemplate.replace("{index}", String(position + 1))}
              aria-current={position === index}
              onClick={() => goTo(position)}
            >
              {position + 1}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
