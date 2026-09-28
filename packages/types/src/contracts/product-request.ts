/**
 * Supplier product REQUEST contracts.
 *
 * `product.ts` describes what the API sends back. This describes what it
 * accepts — which until 8E.5a existed only as `class-validator` decorators
 * inside the API, so a form had to re-type every bound and was free to
 * drift from it. A contract test asserts these declarations and the DTOs
 * agree.
 *
 * The bounds here are the COLUMN's bounds, not a product decision: a value
 * the column cannot hold must be refused with a message, never rounded or
 * truncated on the way in.
 */

/**
 * Maximum characters for each free-text field.
 *
 * The columns are unbounded `text`, so these are the product's own limits.
 * They exist because "no maximum" is not a limit a form can render, and
 * because a 10 MB product name is a denial-of-service disguised as data.
 *
 * Enforced by rejection. Silent truncation would store a name the supplier
 * did not write and show it back to them as if they had.
 */
export const PRODUCT_TEXT_LIMITS = {
  nameAr: 200,
  nameEn: 200,
  descriptionAr: 5000,
  descriptionEn: 5000,
  salesUnitNameAr: 100,
  salesUnitNameEn: 100,
  packageContentUnitNameAr: 100,
  packageContentUnitNameEn: 100,
} as const;

export const PRODUCT_IDENTIFIER_LIMITS = { supplierSku: 64, gtin: 14 } as const;

/** GTIN-8/12/13/14: preserve leading zeroes and validate GS1's check digit. */
export function isValidGtin(value: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  let sum = 0;
  for (let i = value.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(value[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(value[value.length - 1]);
}

export type ProductTextField = keyof typeof PRODUCT_TEXT_LIMITS;

/**
 * Scale and maximum for each numeric field, from its column definition.
 *
 * `weightPerUnit` and `packageContentQuantity` are `Decimal(10,3)`;
 * the three dimensions are `Decimal(10,2)`. A `Decimal(p,s)` holds
 * `p - s` integer digits, so the maxima below are all nines.
 *
 * None of these is money. They cross the wire as REQUEST numbers because
 * that is what the DTOs accept — but they are bounded to exactly what the
 * column stores, so a number that survives validation is a number the
 * database will hold unchanged.
 */
export const PRODUCT_DECIMAL_FIELDS = {
  weightPerUnit: { scale: 3, max: 9_999_999.999 },
  packageContentQuantity: { scale: 3, max: 9_999_999.999 },
  lengthCm: { scale: 2, max: 99_999_999.99 },
  widthCm: { scale: 2, max: 99_999_999.99 },
  heightCm: { scale: 2, max: 99_999_999.99 },
} as const;

export type ProductDecimalField = keyof typeof PRODUCT_DECIMAL_FIELDS;

/**
 * Creating a product.
 *
 * `salesUnitId` is a SOFT reference — an autocomplete source. The two
 * `salesUnitName*` fields are the source of truth and are required
 * whether or not an id is supplied; every snapshot, opportunity and order
 * reads the names and nothing reads the id.
 *
 * The package-content trio is all-or-nothing: either all three are
 * present, or the group is absent entirely. `null` is NOT accepted on
 * create — there is nothing yet to clear.
 */
export interface CreateProductRequest {
  taxonomyNodeId: string;
  supplierSku?: string;
  gtin?: string;
  salesUnitId?: string;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  nameAr: string;
  nameEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
  weightPerUnit: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  packageContentQuantity?: number;
  packageContentUnitNameAr?: string;
  packageContentUnitNameEn?: string;
}

export const CREATE_PRODUCT_REQUEST_KEYS = [
  "taxonomyNodeId",
  "supplierSku",
  "gtin",
  "salesUnitId",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "nameAr",
  "nameEn",
  "descriptionAr",
  "descriptionEn",
  "weightPerUnit",
  "lengthCm",
  "widthCm",
  "heightCm",
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
] as const satisfies readonly (keyof CreateProductRequest)[];

/** Fields a create request must carry. */
export const CREATE_PRODUCT_REQUIRED_KEYS = [
  "taxonomyNodeId",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "nameAr",
  "nameEn",
  "weightPerUnit",
  "lengthCm",
  "widthCm",
  "heightCm",
] as const satisfies readonly (keyof CreateProductRequest)[];

/**
 * Editing a product.
 *
 * THREE STATES PER FIELD, and the difference matters:
 *
 *   omitted (`undefined`)  leave it exactly as it is
 *   a value               set it
 *   `null`                CLEAR it
 *
 * Only the fields that are genuinely optional on the row accept `null`.
 * A required column has nothing to clear to, so sending `null` for
 * `nameAr` is a validation error rather than a way to empty it.
 *
 * The package-content trio clears as a UNIT: all three `null` together
 * removes the group. Any mix of `null` and a value across the three is
 * refused before anything is written, because a quantity with no unit is
 * not a package description — it is a half-erased one.
 */
export interface UpdateProductRequest {
  taxonomyNodeId?: string;
  supplierSku?: string | null;
  gtin?: string | null;
  /** `null` clears the soft reference; the NAMES are unaffected. */
  salesUnitId?: string | null;
  salesUnitNameAr?: string;
  salesUnitNameEn?: string;
  nameAr?: string;
  nameEn?: string;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  weightPerUnit?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  packageContentQuantity?: number | null;
  packageContentUnitNameAr?: string | null;
  packageContentUnitNameEn?: string | null;
}

export const UPDATE_PRODUCT_REQUEST_KEYS = [
  "taxonomyNodeId",
  "supplierSku",
  "gtin",
  "salesUnitId",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "nameAr",
  "nameEn",
  "descriptionAr",
  "descriptionEn",
  "weightPerUnit",
  "lengthCm",
  "widthCm",
  "heightCm",
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
] as const satisfies readonly (keyof UpdateProductRequest)[];

/** The fields an update may clear by sending `null`. */
export const CLEARABLE_PRODUCT_FIELDS = [
  "supplierSku",
  "gtin",
  "salesUnitId",
  "descriptionAr",
  "descriptionEn",
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
] as const satisfies readonly (keyof UpdateProductRequest)[];

/** The three that must be set together and cleared together. */
export const PACKAGE_CONTENT_GROUP = [
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
] as const satisfies readonly (keyof UpdateProductRequest)[];

// ------------------------------------------------- technical check codes

/**
 * Why a product could not be auto-approved.
 *
 * A CLOSED vocabulary. `runProductTechnicalChecks` used to return English
 * sentences that were joined and sent as the error message — developer
 * text, in one language, that no client could map to a field.
 *
 * Each code names one check. `PRODUCT_TECHNICAL_CHECK_FIELDS` below maps
 * it to the form field it belongs to, so a UI can put the error where the
 * reader is looking rather than at the bottom of the page.
 */
export const PRODUCT_TECHNICAL_CHECK_CODES = [
  "NAME_AR_REQUIRED",
  "NAME_EN_REQUIRED",
  "SALES_UNIT_NAME_AR_REQUIRED",
  "SALES_UNIT_NAME_EN_REQUIRED",
  "PACKAGE_CONTENT_GROUP_INCOMPLETE",
  "PACKAGE_CONTENT_QUANTITY_NOT_POSITIVE",
  "WEIGHT_NOT_POSITIVE",
  "LENGTH_NOT_POSITIVE",
  "WIDTH_NOT_POSITIVE",
  "HEIGHT_NOT_POSITIVE",
  "MAIN_IMAGE_REQUIRED",
] as const;

export type ProductTechnicalCheckCode = (typeof PRODUCT_TECHNICAL_CHECK_CODES)[number];

/**
 * Which part of the form each failure belongs to.
 *
 * `media` is not a form field — it is the image panel — so it is named
 * as its own section rather than forced into the field vocabulary.
 */
export const PRODUCT_TECHNICAL_CHECK_FIELDS = {
  NAME_AR_REQUIRED: "nameAr",
  NAME_EN_REQUIRED: "nameEn",
  SALES_UNIT_NAME_AR_REQUIRED: "salesUnitNameAr",
  SALES_UNIT_NAME_EN_REQUIRED: "salesUnitNameEn",
  PACKAGE_CONTENT_GROUP_INCOMPLETE: "packageContentQuantity",
  PACKAGE_CONTENT_QUANTITY_NOT_POSITIVE: "packageContentQuantity",
  WEIGHT_NOT_POSITIVE: "weightPerUnit",
  LENGTH_NOT_POSITIVE: "lengthCm",
  WIDTH_NOT_POSITIVE: "widthCm",
  HEIGHT_NOT_POSITIVE: "heightCm",
  MAIN_IMAGE_REQUIRED: "media",
} as const satisfies Record<ProductTechnicalCheckCode, string>;

/** True when `value` is one of the closed check codes. */
export function isProductTechnicalCheckCode(
  value: unknown
): value is ProductTechnicalCheckCode {
  return (
    typeof value === "string" &&
    (PRODUCT_TECHNICAL_CHECK_CODES as readonly string[]).includes(value)
  );
}

/**
 * Reads `details.failedChecks` from an error body, or returns null.
 *
 * Deliberately narrow. It accepts the field ONLY when the body carries
 * the matching error code, the value is an array, and EVERY entry is in
 * the closed vocabulary above. Anything else — a different code, an
 * object, one unrecognised string — yields null, and the caller falls
 * back to its generic message.
 *
 * That is what keeps `details` from becoming a general-purpose channel
 * into the UI: this function is the only door, and it only opens for one
 * known shape.
 */
export function readFailedChecks(body: unknown): ProductTechnicalCheckCode[] | null {
  if (typeof body !== "object" || body === null) return null;

  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;

  const { code, details } = error as { code?: unknown; details?: unknown };
  if (code !== "PRODUCT_TECHNICAL_CHECK_FAILED") return null;

  if (typeof details !== "object" || details === null) return null;
  const failedChecks = (details as { failedChecks?: unknown }).failedChecks;

  if (!Array.isArray(failedChecks) || failedChecks.length === 0) return null;
  if (!failedChecks.every(isProductTechnicalCheckCode)) return null;

  return failedChecks;
}
