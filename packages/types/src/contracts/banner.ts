/**
 * Promotional banner contracts.
 *
 * A BANNER IS ARTWORK AND NOTHING ELSE. Every word a visitor reads is
 * drawn inside the image, so this contract carries no title, no body
 * and no description — there is no operator-written string here to
 * render, and therefore none to escape. The accessible description is a
 * translated constant in the web app rather than a hidden field someone
 * is asked to fill in.
 *
 * ONE ARTWORK PER LANGUAGE, chosen by the caller's locale, and never
 * substituted: an Arabic reader is not shown English artwork when the
 * Arabic one is missing. A banner without both images cannot go live at
 * all, so the case does not arise in public.
 *
 * The contract exposes no storage object key: images are reached
 * through `GET /api/v1/banners/:id/image`, which resolves the key
 * server-side. `imageUrl` below is that route, already built.
 */

export const BANNER_PLACEMENTS = ["PUBLIC_HOME", "PUBLIC_OPPORTUNITIES"] as const;
export type BannerPlacement = (typeof BANNER_PLACEMENTS)[number];

export const BANNER_IMAGE_VARIANTS = ["main", "thumb"] as const;
export type BannerImageVariant = (typeof BANNER_IMAGE_VARIANTS)[number];

/**
 * What an anonymous visitor receives. Only banners that are LIVE right
 * now appear at all, so there is deliberately no status, no schedule,
 * and no admin metadata here — a caller cannot learn that a draft or a
 * scheduled banner exists.
 */
export interface BannerItem {
  id: string;
  /**
   * Route to the artwork FOR THE REQUESTED LOCALE, already built.
   *
   * Never null in practice: a banner cannot be live without both
   * languages present, so anything this list returns has an image.
   */
  imageUrl: string;
  /** Route to that same artwork's thumbnail. */
  thumbnailUrl: string;
  /** Internal path (`/…`) or an allowlisted `https://` URL. Never other schemes. */
  linkUrl: string | null;
}

export const BANNER_ITEM_KEYS = [
  "id",
  "imageUrl",
  "thumbnailUrl",
  "linkUrl",
] as const satisfies readonly (keyof BannerItem)[];

/**
 * The languages a banner carries artwork for.
 *
 * The same locale codes the rest of the product uses, so nothing has to
 * translate between an enum name and a locale at any boundary.
 */
export const BANNER_IMAGE_LOCALES = ["ar-SA", "en-SA"] as const;
export type BannerImageLocale = (typeof BANNER_IMAGE_LOCALES)[number];

export function isBannerImageLocale(
  value: unknown,
): value is BannerImageLocale {
  return (
    typeof value === "string" &&
    (BANNER_IMAGE_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * Derived lifecycle state. There is no status column — the state is
 * computed from `isActive` plus the schedule window, so the two can
 * never disagree.
 *
 *   DRAFT      isActive = false
 *   SCHEDULED  active, startsAt in the future
 *   LIVE       active, window open  → the only publicly visible state
 *   EXPIRED    active, endsAt has passed
 */
export const BANNER_STATES = ["DRAFT", "SCHEDULED", "LIVE", "EXPIRED"] as const;
export type BannerState = (typeof BANNER_STATES)[number];

/**
 * Admin view. Carries the schedule and derived state; still no object
 * key.
 *
 * `images` reports WHICH LANGUAGES have artwork, so the screen can show
 * one upload control per language and say plainly which is still
 * missing. It is a list of locales rather than URLs: the admin preview
 * route is built from the banner id and the locale, and a stored URL
 * would be a second place for that route to be written down.
 */
export interface BannerAdminItem {
  id: string;
  placement: BannerPlacement;
  /** Locales that have a complete artwork row. Empty on a fresh banner. */
  images: BannerImageLocale[];
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  state: BannerState;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** True when every language has artwork — the precondition for going live. */
export function hasEveryBannerImage(
  locales: readonly BannerImageLocale[],
): boolean {
  return BANNER_IMAGE_LOCALES.every((locale) => locales.includes(locale));
}

/**
 * The SHAPE a banner image must have.
 *
 * A promotional strip is a wide band. A portrait photograph dropped
 * into it is either squashed or cropped to a sliver, and neither is
 * something an operator chose — so the shape is checked rather than
 * absorbed.
 *
 * These are the DEFAULTS. The live values are part of the
 * administrator-configurable banner policy and are read from it, never
 * copied into a component: a limit repeated in the browser is a limit
 * that disagrees with the server the first time anyone changes it.
 *
 * `aspectRatio` is width ÷ height, so 5 means 5:1.
 */
export interface BannerImageShape {
  minWidth: number;
  minHeight: number;
  /** What the design is drawn for; used for the crop preview frame. */
  preferredAspectRatio: number;
  /** Narrowest accepted, e.g. 3 for 3:1. */
  minAspectRatio: number;
  /** Widest accepted, e.g. 6 for 6:1. */
  maxAspectRatio: number;
}

export const DEFAULT_BANNER_IMAGE_SHAPE: BannerImageShape = {
  minWidth: 1500,
  minHeight: 300,
  preferredAspectRatio: 5,
  minAspectRatio: 3,
  maxAspectRatio: 6,
};

/** Why an image was refused, so the caller can say which rule it broke. */
export type BannerShapeRejection =
  | { reason: "TOO_SMALL"; width: number; height: number }
  | { reason: "TOO_TALL"; width: number; height: number; ratio: number }
  | { reason: "TOO_WIDE"; width: number; height: number; ratio: number };

/**
 * Checks a decoded image against the shape policy.
 *
 * Shared by the browser and the server deliberately: the browser check
 * exists to fail fast and show a useful message before megabytes are
 * uploaded, and the server check is the one that actually decides. Two
 * implementations of one rule is how they drift, and the drift is only
 * ever discovered as "the site accepted it and then rejected it".
 */
export function checkBannerImageShape(
  width: number,
  height: number,
  shape: BannerImageShape,
): BannerShapeRejection | null {
  if (width < shape.minWidth || height < shape.minHeight) {
    return { reason: "TOO_SMALL", width, height };
  }

  const ratio = width / height;
  if (ratio < shape.minAspectRatio)
    return { reason: "TOO_TALL", width, height, ratio };
  if (ratio > shape.maxAspectRatio)
    return { reason: "TOO_WIDE", width, height, ratio };

  return null;
}

/** e.g. "5:1" — one place formats a ratio, so both sides read alike. */
export function formatAspectRatio(ratio: number): string {
  return `${Math.round(ratio * 100) / 100}:1`;
}

/**
 * A refusal, in words a person can act on.
 *
 * Names the image's ACTUAL dimensions and what was required, because
 * "invalid image" tells an operator nothing about what to do next —
 * they cannot tell whether to crop, re-export, or pick another file.
 *
 * English only: this is the API's developer-facing message, and the
 * browser produces its own translated wording from the same rejection.
 */
export function describeBannerShapeRejection(
  rejection: BannerShapeRejection,
  shape: BannerImageShape,
): string {
  const actual = `${rejection.width}x${rejection.height}`;

  if (rejection.reason === "TOO_SMALL") {
    return (
      `Banner image is ${actual}, smaller than the required minimum of ` +
      `${shape.minWidth}x${shape.minHeight}`
    );
  }

  const band =
    `${formatAspectRatio(shape.minAspectRatio)} to ` +
    `${formatAspectRatio(shape.maxAspectRatio)}`;
  const direction = rejection.reason === "TOO_TALL" ? "too tall" : "too wide";

  return (
    `Banner image is ${actual}, an aspect ratio of ` +
    `${formatAspectRatio(rejection.ratio)} — ${direction} for a banner. ` +
    `Accepted range is ${band}, and ${formatAspectRatio(shape.preferredAspectRatio)} is preferred`
  );
}

/** True when the value is a usable shape block. */
export function isBannerImageShape(value: unknown): value is BannerImageShape {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  const positive = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && n > 0;
  if (!positive(v.minWidth) || !positive(v.minHeight)) return false;
  if (!positive(v.minAspectRatio) || !positive(v.maxAspectRatio)) return false;
  if (!positive(v.preferredAspectRatio)) return false;

  const min = v.minAspectRatio as number;
  const max = v.maxAspectRatio as number;
  const preferred = v.preferredAspectRatio as number;

  // An inverted band would refuse every image; a preferred ratio
  // outside its own band is a contradiction.
  return min <= max && preferred >= min && preferred <= max;
}

/**
 * The settings key the banner policy lives under.
 *
 * Shared so the API registers it and the admin screen reads it by the
 * same literal. A key typed into the browser is how a portal ends up
 * reading something nothing writes.
 */
export const BANNER_POLICY_SETTING_KEY = "promotional_banner_policy";
