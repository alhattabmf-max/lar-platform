import type { Product, ProductMedia } from "@prisma/client";

export interface ProductSnapshotPayload {
  nameAr: string;
  nameEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  taxonomyNodeId: string;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  packageContentQuantity: string | null;
  packageContentUnitNameAr: string | null;
  packageContentUnitNameEn: string | null;
  weightPerUnit: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  media: Array<{ objectKey: string; thumbnailObjectKey: string; isMain: boolean; sortOrder: number }>;
}

/**
 * salesUnitNameAr/En and packageContent* are read from the PRODUCT
 * row itself (the current draft/live values at the moment of
 * approval) — never from Product.salesUnitId, which is a soft
 * UI-suggestion reference only. This is the ONLY place a new
 * snapshot's shape is defined; both submit()'s auto-approval path and
 * update()'s auto-re-approval path, plus AdminProductsService's
 * manual approve(), all call this same builder so the JSON shape can
 * never diverge between them.
 */
export function buildProductSnapshotPayload(
  product: Pick<
    Product,
    | "nameAr"
    | "nameEn"
    | "descriptionAr"
    | "descriptionEn"
    | "taxonomyNodeId"
    | "salesUnitNameAr"
    | "salesUnitNameEn"
    | "packageContentQuantity"
    | "packageContentUnitNameAr"
    | "packageContentUnitNameEn"
    | "weightPerUnit"
    | "lengthCm"
    | "widthCm"
    | "heightCm"
  >,
  media: Pick<ProductMedia, "objectKey" | "thumbnailObjectKey" | "isMain" | "sortOrder">[]
): ProductSnapshotPayload {
  return {
    nameAr: product.nameAr,
    nameEn: product.nameEn,
    descriptionAr: product.descriptionAr,
    descriptionEn: product.descriptionEn,
    taxonomyNodeId: product.taxonomyNodeId,
    salesUnitNameAr: product.salesUnitNameAr,
    salesUnitNameEn: product.salesUnitNameEn,
    packageContentQuantity: product.packageContentQuantity?.toString() ?? null,
    packageContentUnitNameAr: product.packageContentUnitNameAr,
    packageContentUnitNameEn: product.packageContentUnitNameEn,
    weightPerUnit: product.weightPerUnit.toString(),
    lengthCm: product.lengthCm.toString(),
    widthCm: product.widthCm.toString(),
    heightCm: product.heightCm.toString(),
    media: media.map((m) => ({
      objectKey: m.objectKey,
      thumbnailObjectKey: m.thumbnailObjectKey,
      isMain: m.isMain,
      sortOrder: m.sortOrder,
    })),
  };
}

/**
 * Historical-compatibility reader for OLD-shape snapshots (pre-7A,
 * only had salesUnitId — no salesUnitNameAr/En, no packageContent
 * fields). Never mutates the stored snapshot (it is append-only and
 * immutable at the DB level) — this is purely a read-time shape
 * detector so callers can tell which shape they got back.
 */
export function isLegacySnapshotShape(snapshot: unknown): snapshot is { salesUnitId: string } {
  if (typeof snapshot !== "object" || snapshot === null) return false;
  const obj = snapshot as Record<string, unknown>;
  return typeof obj.salesUnitId === "string" && typeof obj.salesUnitNameAr !== "string";
}
