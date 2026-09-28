/**
 * Supplier product contracts.
 *
 * A product is the supplier's OWN record, so the boundary here is narrower
 * than elsewhere — most of the row belongs to them. What is withheld is the
 * platform's internal machinery: the approval snapshots, the media storage
 * keys, and the taxonomy's internal ids beyond the one they chose.
 */

/**
 * The review lifecycle. Mirrors `ProductApprovalStatus`.
 *
 * Six states, and the two that need action are easy to miss: `REJECTED` needs
 * the supplier to fix and resubmit, and `SUSPENDED` means the platform pulled
 * a live product. `CLOSED` is terminal.
 */
export const PRODUCT_APPROVAL_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "CLOSED",
] as const;

export type ProductApprovalStatus = (typeof PRODUCT_APPROVAL_STATUSES)[number];

/** Statuses where the supplier is the one who must act next. */
export const PRODUCT_ACTION_REQUIRED_STATUSES = ["DRAFT", "REJECTED", "SUSPENDED"] as const;

export function productNeedsSupplierAction(status: ProductApprovalStatus): boolean {
  return (PRODUCT_ACTION_REQUIRED_STATUSES as readonly string[]).includes(status);
}

/** One product in the supplier's catalogue. */
export interface ProductSummary {
  id: string;
  nameAr: string;
  nameEn: string;
  approvalStatus: ProductApprovalStatus;
  /**
   * Why it was rejected, when it was.
   *
   * Written by a reviewer FOR the supplier — this is correspondence, not an
   * internal note, and withholding it would leave someone told they failed
   * without being told why.
   */
  rejectionReason: string | null;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  /**
   * The main image, as a relative API path. Null when the product has none.
   *
   * Built from `productId` and `mediaId` and nothing else — no storage key,
   * no signature, no expiry. The route it points at re-checks ownership
   * against the CURRENT session on every request, so this string is an
   * address, not a capability: possessing it grants nothing.
   *
   * That is why it is not presigned. A presigned URL IS a capability — it
   * works for whoever holds it, for as long as it lives, with no session — and
   * a product image can belong to a draft that was never published.
   */
  thumbnailUrl: string | null;
  /** How many images the product has. Zero means `thumbnailUrl` is null. */
  mediaCount: number;
  /** ISO 8601. Non-null once archived, which is what hides it from the list. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * WHAT A CATALOGUE CARD DRAWS BESIDE THE NAME.
   *
   * These were on the DETAIL alone, and the supplier catalogue drew all
   * of them — so the page listed the products and then fetched the
   * detail of every one, a request per row. A supplier with five hundred
   * products opened one screen with five hundred and two requests.
   *
   * They are columns of the product itself, so carrying them on the
   * summary joins nothing and costs the list nothing. `ProductDetail`
   * inherits them rather than repeating them.
   */
  descriptionAr: string | null;
  descriptionEn: string | null;
  /** Decimal string at scale 3. Not money. */
  weightPerUnit: string;
  /** Decimal strings at scale 2. Not money. */
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  /** Decimal string at scale 3, or null when the unit is not divisible. */
  packageContentQuantity: string | null;
  packageContentUnitNameAr: string | null;
  packageContentUnitNameEn: string | null;
}

export const PRODUCT_SUMMARY_KEYS = [
  "id",
  "nameAr",
  "nameEn",
  "approvalStatus",
  "rejectionReason",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "thumbnailUrl",
  "mediaCount",
  "archivedAt",
  "createdAt",
  "updatedAt",
  "descriptionAr",
  "descriptionEn",
  "weightPerUnit",
  "lengthCm",
  "widthCm",
  "heightCm",
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
] as const satisfies readonly (keyof ProductSummary)[];

/**
 * The detail adds what the supplier entered.
 *
 * Dimensions and weight are `Decimal(10,2)`/`(10,3)` and are NOT money — they
 * are physical measurements, and they cross the wire as decimal strings at
 * their own precision so a 0.005 kg difference in a shipping tier calculation
 * cannot come from a float. `packageContentQuantity` is `Decimal(10,3)`.
 *
 * `taxonomyNodeId` is included because the supplier chose it and needs it to
 * edit; the taxonomy's internal tree is not.
 *
 * Approval SNAPSHOTS are absent entirely. They are the frozen copies published
 * opportunities are built from, they carry storage keys, and a supplier editing
 * a product has no use for them.
 */
export interface ProductDetail extends ProductSummary {
  taxonomyNodeId: string;
  /**
   * The SOFT sales-unit reference, or null.
   *
   * Included so an edit form can pre-select the picker the supplier chose
   * from. Without it a form can prefill the two NAMES but not the
   * selection, and saving would silently drop the reference.
   *
   * Nothing reads this id for business logic — `salesUnitName*` are the
   * source of truth for every snapshot, opportunity and order. It is an
   * autocomplete source, and null is a perfectly normal value.
   */
  salesUnitId: string | null;
  /** Every image in display order, each with its own delivery paths. */
  media: ProductMediaView[];
}

/**
 * One image: metadata, plus two relative API paths.
 *
 * No `objectKey`, no `thumbnailObjectKey`, no bucket, no ETag. The URLs are
 * derived from the route's own ids and the variant — `.../media/:mediaId/image`
 * and the same with `?variant=thumb` — so nothing about where the file is
 * stored crosses the wire.
 *
 * Neither URL is presigned and neither is proof of anything. The delivery
 * route re-checks, in its own query, that the media belongs to this product
 * and the product to the session's company. A guessed path answers 404
 * exactly as an unknown one does.
 *
 * `isMain` and `sortOrder` are included because the supplier SETS them
 * through the existing media endpoints and needs the current state to change
 * it sensibly.
 */
export interface ProductMediaView {
  id: string;
  /** Relative API path to the full image. */
  url: string;
  /** Relative API path to the thumbnail. */
  thumbnailUrl: string;
  contentType: string;
  sizeBytes: number;
  isMain: boolean;
  sortOrder: number;
}

export const PRODUCT_MEDIA_VIEW_KEYS = [
  "id",
  "url",
  "thumbnailUrl",
  "contentType",
  "sizeBytes",
  "isMain",
  "sortOrder",
] as const satisfies readonly (keyof ProductMediaView)[];

/**
 * Builds the delivery path for one product image.
 *
 * Shared so the API and any client derive the SAME string, and so the shape of
 * the path lives beside the contract that carries it. It takes ids and a
 * variant — there is no argument through which a storage key could enter.
 */
export function productMediaImagePath(
  productId: string,
  mediaId: string,
  variant: "main" | "thumb" = "main"
): string {
  const base = `/api/v1/companies/me/products/${productId}/media/${mediaId}/image`;
  return variant === "thumb" ? `${base}?variant=thumb` : base;
}

export const PRODUCT_DETAIL_KEYS = [
  ...PRODUCT_SUMMARY_KEYS,
  "taxonomyNodeId",
  "salesUnitId",
  "media",
] as const satisfies readonly (keyof ProductDetail)[];

/**
 * The same image, addressed from the admin console.
 *
 * A SECOND PATH FOR THE SAME BYTES, and it has to be: the supplier's
 * route is `companies/me/...`, and «me» there is the SESSION'S company.
 * An administrator has no company, so that route can never serve them —
 * it would 404 on every image on the platform. The admin route resolves
 * the media by its own two ids behind the admin session guard.
 *
 * Neither path is proof of anything. Each re-checks, in its own query,
 * that the media belongs to this product — and the admin one additionally
 * that the caller holds an admin session. A guessed path answers 404.
 */
export function adminProductMediaImagePath(
  productId: string,
  mediaId: string,
  variant: "main" | "thumb" = "main"
): string {
  const base = `/api/v1/admin/products/${productId}/media/${mediaId}/image`;
  return variant === "thumb" ? `${base}?variant=thumb` : base;
}
