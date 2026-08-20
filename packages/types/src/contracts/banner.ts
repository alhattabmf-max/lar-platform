/**
 * Promotional banner contracts.
 *
 * Text fields are PLAIN TEXT and are rendered as React text nodes. They
 * never carry HTML, and no consumer may pass them to
 * `dangerouslySetInnerHTML` (banned repo-wide by a test in apps/web).
 *
 * The public contract exposes no storage object key: images are reached
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
  titleAr: string;
  titleEn: string;
  bodyAr: string | null;
  bodyEn: string | null;
  /** Route to the main image, or null when the banner has no image. */
  imageUrl: string | null;
  /** Route to the thumbnail, or null when the banner has no image. */
  thumbnailUrl: string | null;
  /** Internal path (`/…`) or an allowlisted `https://` URL. Never other schemes. */
  linkUrl: string | null;
}

export const BANNER_ITEM_KEYS = [
  "id",
  "titleAr",
  "titleEn",
  "bodyAr",
  "bodyEn",
  "imageUrl",
  "thumbnailUrl",
  "linkUrl",
] as const satisfies readonly (keyof BannerItem)[];

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

/** Admin view. Carries the schedule and derived state; still no object key. */
export interface BannerAdminItem {
  id: string;
  placement: BannerPlacement;
  titleAr: string;
  titleEn: string;
  bodyAr: string | null;
  bodyEn: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  state: BannerState;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}
