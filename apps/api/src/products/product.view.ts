import { Prisma } from "@prisma/client";
import {
  productMediaImagePath,
  type ProductApprovalStatus,
  type ProductDetail,
  type ProductMediaView,
  type ProductSummary,
} from "@platform/types";

/**
 * Projection for a supplier's own products.
 *
 * A product is largely the supplier's own record, so this withholds less than
 * the order or settlement projections. What it does withhold is the platform's
 * machinery: the approval SNAPSHOTS (frozen copies published opportunities are
 * built from, each carrying storage keys) and the media storage keys
 * themselves.
 *
 * Dimensions and weight are decimals but NOT money — they are physical
 * measurements at their own precision, and they cross the wire as strings for
 * the same reason money does: a 0.005 kg difference that decides a shipping
 * tier must not come from a float.
 */

/**
 * Ownership, as a WHERE clause.
 *
 * `Product.companyId` is the supplier's. Expressed as a filter, an unknown id
 * and another company's product both produce no row — one 404, nothing
 * distinguishable by probing.
 */
export function ownedProductWhere(companyId: string): Prisma.ProductWhereInput {
  return { companyId };
}

/** Media ordered exactly as it is displayed: main first, then by sort order. */
const MEDIA_ORDER = [
  { isMain: "desc" },
  { sortOrder: "asc" },
  // Terminating in the primary key, so two images sharing a sort order cannot
  // swap places between requests.
  { id: "asc" },
] satisfies Prisma.ProductMediaOrderByWithRelationInput[];

export const PRODUCT_SUMMARY_SELECT = {
  id: true,
  nameAr: true,
  nameEn: true,
  approvalStatus: true,
  rejectionReason: true,
  salesUnitNameAr: true,
  salesUnitNameEn: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  media: { select: { id: true }, orderBy: MEDIA_ORDER },
} satisfies Prisma.ProductSelect;

export const PRODUCT_DETAIL_SELECT = {
  ...PRODUCT_SUMMARY_SELECT,
  descriptionAr: true,
  descriptionEn: true,
  taxonomyNodeId: true,
  // The SOFT reference, so an edit form can pre-select the picker the
  // supplier chose from. Nothing reads it for business logic.
  salesUnitId: true,
  weightPerUnit: true,
  lengthCm: true,
  widthCm: true,
  heightCm: true,
  packageContentQuantity: true,
  packageContentUnitNameAr: true,
  packageContentUnitNameEn: true,
  media: {
    // `objectKey` and `thumbnailObjectKey` are NOT selected. The delivery
    // route resolves them server-side from the ids below, so nothing about
    // where a file is stored needs to cross the wire.
    select: { id: true, contentType: true, sizeBytes: true, isMain: true, sortOrder: true },
    orderBy: MEDIA_ORDER,
  },
} satisfies Prisma.ProductSelect;

export type ProductSummaryRow = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_SUMMARY_SELECT;
}>;
export type ProductDetailRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_DETAIL_SELECT }>;

const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toProductSummary(row: ProductSummaryRow): ProductSummary {
  const main = row.media[0];

  return {
    id: row.id,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    approvalStatus: row.approvalStatus as ProductApprovalStatus,
    // Correspondence written by a reviewer FOR the supplier. Withholding it
    // leaves someone told they failed without being told why.
    rejectionReason: row.rejectionReason,
    salesUnitNameAr: row.salesUnitNameAr,
    salesUnitNameEn: row.salesUnitNameEn,
    // A route built from ids, not a storage key and not a presigned URL. Null
    // and zero agree, so a UI cannot render a broken image for an empty
    // product.
    thumbnailUrl: main ? productMediaImagePath(row.id, main.id, "thumb") : null,
    mediaCount: row.media.length,
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMedia(productId: string, media: ProductDetailRow["media"][number]): ProductMediaView {
  return {
    id: media.id,
    url: productMediaImagePath(productId, media.id, "main"),
    thumbnailUrl: productMediaImagePath(productId, media.id, "thumb"),
    contentType: media.contentType,
    sizeBytes: media.sizeBytes,
    // The supplier SETS both through the media endpoints and needs the current
    // state to change it sensibly.
    isMain: media.isMain,
    sortOrder: media.sortOrder,
  };
}

export function toProductDetail(row: ProductDetailRow): ProductDetail {
  return {
    ...toProductSummary(row),
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    taxonomyNodeId: row.taxonomyNodeId,
    salesUnitId: row.salesUnitId,
    // Physical measurements at their stored precision. Not money, but decimal
    // strings for the same reason: a float would change the value.
    weightPerUnit: row.weightPerUnit.toFixed(3),
    lengthCm: row.lengthCm.toFixed(2),
    widthCm: row.widthCm.toFixed(2),
    heightCm: row.heightCm.toFixed(2),
    packageContentQuantity: row.packageContentQuantity
      ? row.packageContentQuantity.toFixed(3)
      : null,
    packageContentUnitNameAr: row.packageContentUnitNameAr,
    packageContentUnitNameEn: row.packageContentUnitNameEn,
    media: row.media.map((media) => toMedia(row.id, media)),
  };
}
