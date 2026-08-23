import type { ProductTechnicalCheckCode } from "@platform/types";

export interface ProductTechnicalCheckInput {
  nameAr: string;
  nameEn: string;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  packageContentQuantity: number | null;
  packageContentUnitNameAr: string | null;
  packageContentUnitNameEn: string | null;
  weightPerUnit: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  hasMainImage: boolean;
}

/**
 * Deliberately NOT a judgment call about product quality/category —
 * only completeness, format, and numeric sanity. Anything a DTO's own
 * class-validator decorators already guarantee (non-empty strings,
 * positive numbers) is re-checked here too, defensively, since this
 * function is the actual gate for auto-approval and must never trust
 * that the caller already validated its input.
 *
 * Returns CODES from the closed `PRODUCT_TECHNICAL_CHECK_CODES`
 * vocabulary, not sentences. It used to return English strings that the
 * caller joined into an error message — developer text, in one language,
 * that no client could map back to a field. A code can be translated and
 * placed on the input it belongs to; a sentence can only be printed.
 */
export function runProductTechnicalChecks(
  input: ProductTechnicalCheckInput
): ProductTechnicalCheckCode[] {
  const failures: ProductTechnicalCheckCode[] = [];

  if (!input.nameAr?.trim()) failures.push("NAME_AR_REQUIRED");
  if (!input.nameEn?.trim()) failures.push("NAME_EN_REQUIRED");
  if (!input.salesUnitNameAr?.trim()) failures.push("SALES_UNIT_NAME_AR_REQUIRED");
  if (!input.salesUnitNameEn?.trim()) failures.push("SALES_UNIT_NAME_EN_REQUIRED");

  const packageFields = [
    input.packageContentQuantity,
    input.packageContentUnitNameAr,
    input.packageContentUnitNameEn,
  ];
  const packageFieldsProvided = packageFields.filter((f) => f !== null && f !== undefined).length;
  if (packageFieldsProvided !== 0 && packageFieldsProvided !== 3) {
    failures.push("PACKAGE_CONTENT_GROUP_INCOMPLETE");
  }
  if (
    input.packageContentQuantity !== null &&
    input.packageContentQuantity !== undefined &&
    input.packageContentQuantity <= 0
  ) {
    failures.push("PACKAGE_CONTENT_QUANTITY_NOT_POSITIVE");
  }

  if (!(input.weightPerUnit > 0)) failures.push("WEIGHT_NOT_POSITIVE");
  if (!(input.lengthCm > 0)) failures.push("LENGTH_NOT_POSITIVE");
  if (!(input.widthCm > 0)) failures.push("WIDTH_NOT_POSITIVE");
  if (!(input.heightCm > 0)) failures.push("HEIGHT_NOT_POSITIVE");

  if (!input.hasMainImage) failures.push("MAIN_IMAGE_REQUIRED");

  return failures;
}
