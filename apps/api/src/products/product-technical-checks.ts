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
 */
export function runProductTechnicalChecks(input: ProductTechnicalCheckInput): string[] {
  const errors: string[] = [];

  if (!input.nameAr?.trim()) errors.push("nameAr is required");
  if (!input.nameEn?.trim()) errors.push("nameEn is required");
  if (!input.salesUnitNameAr?.trim()) errors.push("salesUnitNameAr is required");
  if (!input.salesUnitNameEn?.trim()) errors.push("salesUnitNameEn is required");

  const packageFields = [
    input.packageContentQuantity,
    input.packageContentUnitNameAr,
    input.packageContentUnitNameEn,
  ];
  const packageFieldsProvided = packageFields.filter((f) => f !== null && f !== undefined).length;
  if (packageFieldsProvided !== 0 && packageFieldsProvided !== 3) {
    errors.push("package content fields must all be provided together, or not at all");
  }
  if (
    input.packageContentQuantity !== null &&
    input.packageContentQuantity !== undefined &&
    input.packageContentQuantity <= 0
  ) {
    errors.push("packageContentQuantity must be positive");
  }

  if (!(input.weightPerUnit > 0)) errors.push("weightPerUnit must be positive");
  if (!(input.lengthCm > 0)) errors.push("lengthCm must be positive");
  if (!(input.widthCm > 0)) errors.push("widthCm must be positive");
  if (!(input.heightCm > 0)) errors.push("heightCm must be positive");

  if (!input.hasMainImage) errors.push("at least one main product image is required");

  return errors;
}
