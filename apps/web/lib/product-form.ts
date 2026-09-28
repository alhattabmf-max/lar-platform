import {
  PACKAGE_CONTENT_GROUP,
  PRODUCT_DECIMAL_FIELDS,
  PRODUCT_IDENTIFIER_LIMITS,
  PRODUCT_TEXT_LIMITS,
  isValidGtin,
  type CreateProductRequest,
  type ProductDecimalField,
  type ProductDetail,
  type ProductTextField,
  type UpdateProductRequest,
} from "@platform/types";

/**
 * The product form, as data.
 *
 * No React here on purpose: every rule below is a pure function over plain
 * values, so the shapes the API actually receives can be asserted directly
 * instead of inferred from a rendered component.
 *
 * VALUES ARE STRINGS. An `<input>` holds a string, and keeping them as
 * strings all the way to the boundary means there is exactly ONE place a
 * number is produced — `toCreateRequest` / `toUpdateRequest`, after
 * validation has already established the string is a storable decimal.
 * Parsing on every keystroke would round `10.0005` into `10.001` while the
 * supplier was still typing it.
 *
 * Nothing here adds, multiplies, converts a unit or re-rounds. The bounds
 * come from `@platform/types`, which is the same declaration the API's DTOs
 * are built from — there is no second copy of a limit in this app.
 */

export type ProductFormField =
  | ProductTextField
  | ProductDecimalField
  | "taxonomyNodeId"
  | "salesUnitId";

/** Every field, as the string an input holds. Empty means "not filled in". */
export interface ProductFormValues {
  taxonomyNodeId: string;
  salesUnitId: string;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  nameAr: string;
  nameEn: string;
  supplierSku: string;
  gtin: string;
  descriptionAr: string;
  descriptionEn: string;
  weightPerUnit: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  packageContentQuantity: string;
  packageContentUnitNameAr: string;
  packageContentUnitNameEn: string;
}

export const PRODUCT_FORM_FIELDS = [
  "taxonomyNodeId",
  "salesUnitId",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "nameAr",
  "nameEn",
  "supplierSku",
  "gtin",
  "descriptionAr",
  "descriptionEn",
  "weightPerUnit",
  "lengthCm",
  "widthCm",
  "heightCm",
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
] as const satisfies readonly (keyof ProductFormValues)[];

/**
 * The order fields appear in the form.
 *
 * Used to decide which error to focus: "first" must mean first on the
 * screen, not first in whatever order an object's keys happen to iterate.
 */
export const PRODUCT_FIELD_ORDER: readonly (keyof ProductFormValues)[] = [
  "nameAr",
  "nameEn",
  "supplierSku",
  "gtin",
  "descriptionAr",
  "descriptionEn",
  "taxonomyNodeId",
  "salesUnitId",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
  "weightPerUnit",
  "lengthCm",
  "widthCm",
  "heightCm",
];

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  taxonomyNodeId: "",
  salesUnitId: "",
  salesUnitNameAr: "",
  salesUnitNameEn: "",
  nameAr: "",
  nameEn: "",
  supplierSku: "",
  gtin: "",
  descriptionAr: "",
  descriptionEn: "",
  weightPerUnit: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  packageContentQuantity: "",
  packageContentUnitNameAr: "",
  packageContentUnitNameEn: "",
};

/**
 * Prefills the form from what the API returned.
 *
 * The decimals arrive as decimal STRINGS at their own scale and are used
 * verbatim — reformatting `12.500` to `12.5` here would make the field look
 * edited before anyone touched it, and the dirty check would then send a
 * value nobody changed.
 */
export function productFormFromDetail(detail: ProductDetail): ProductFormValues {
  return {
    taxonomyNodeId: detail.taxonomyNodeId,
    salesUnitId: detail.salesUnitId ?? "",
    salesUnitNameAr: detail.salesUnitNameAr,
    salesUnitNameEn: detail.salesUnitNameEn,
    nameAr: detail.nameAr,
    nameEn: detail.nameEn,
    supplierSku: detail.supplierSku ?? "",
    gtin: detail.gtin ?? "",
    descriptionAr: detail.descriptionAr ?? "",
    descriptionEn: detail.descriptionEn ?? "",
    weightPerUnit: detail.weightPerUnit,
    lengthCm: detail.lengthCm,
    widthCm: detail.widthCm,
    heightCm: detail.heightCm,
    packageContentQuantity: detail.packageContentQuantity ?? "",
    packageContentUnitNameAr: detail.packageContentUnitNameAr ?? "",
    packageContentUnitNameEn: detail.packageContentUnitNameEn ?? "",
  };
}

// ------------------------------------------------------------ validation

/** An error per field, as a message key plus the values that key needs. */
export interface FieldIssue {
  key: string;
  values?: Record<string, string | number>;
}

export type ProductFormErrors = Partial<Record<keyof ProductFormValues, FieldIssue>>;

const REQUIRED_TEXT = ["nameAr", "nameEn", "salesUnitNameAr", "salesUnitNameEn"] as const;
const REQUIRED_DECIMALS = ["weightPerUnit", "lengthCm", "widthCm", "heightCm"] as const;

/**
 * A decimal, checked as TEXT before anything parses it.
 *
 * Anchored, so `1e3`, `12,50`, `+5`, `1.` and a trailing space are all
 * refused rather than partially matched. `Number("1e3")` is 1000 and
 * `Number(" 5 ")` is 5 — both would sail through a parse-first check and
 * store a value the supplier did not type.
 */
const DECIMAL_TEXT = /^\d+(\.\d+)?$/;

function validateDecimal(raw: string, field: ProductDecimalField): FieldIssue | null {
  const value = raw.trim();
  const { scale, max } = PRODUCT_DECIMAL_FIELDS[field];

  if (!DECIMAL_TEXT.test(value)) return { key: "invalidNumber" };

  const fraction = value.split(".")[1];
  if (fraction !== undefined && fraction.length > scale) {
    return { key: "tooPrecise", values: { scale } };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { key: "invalidNumber" };
  if (parsed <= 0) return { key: "mustBePositive" };
  if (parsed > max) return { key: "tooLarge", values: { max } };

  return null;
}

function validateText(raw: string, field: ProductTextField, required: boolean): FieldIssue | null {
  const value = raw.trim();

  if (required && value.length === 0) return { key: "required" };
  if (value.length > PRODUCT_TEXT_LIMITS[field]) {
    return { key: "tooLong", values: { max: PRODUCT_TEXT_LIMITS[field] } };
  }
  return null;
}

/**
 * Everything wrong with the form, all at once.
 *
 * Returns every issue rather than stopping at the first, because a form
 * that reveals one problem per submit makes someone submit five times to
 * learn five things.
 *
 * These mirror the DTO's own rules from the SAME shared constants. The
 * server stays the authority — this exists so the common cases are caught
 * without a round trip, and so an error can be attached to the field it
 * belongs to, which the API's response cannot express.
 */
export function validateProductForm(values: ProductFormValues): ProductFormErrors {
  const errors: ProductFormErrors = {};

  if (!values.taxonomyNodeId) errors.taxonomyNodeId = { key: "required" };

  for (const field of REQUIRED_TEXT) {
    const issue = validateText(values[field], field, true);
    if (issue) errors[field] = issue;
  }

  for (const field of ["descriptionAr", "descriptionEn"] as const) {
    const issue = validateText(values[field], field, false);
    if (issue) errors[field] = issue;
  }

  if (values.supplierSku.trim().length > PRODUCT_IDENTIFIER_LIMITS.supplierSku) {
    errors.supplierSku = { key: "tooLong", values: { max: PRODUCT_IDENTIFIER_LIMITS.supplierSku } };
  }
  if (values.gtin.trim() && !isValidGtin(values.gtin.trim())) {
    errors.gtin = { key: "invalidGtin" };
  }

  for (const field of REQUIRED_DECIMALS) {
    const issue = validateDecimal(values[field], field);
    if (issue) errors[field] = issue;
  }

  // ---- the package-content group -------------------------------------

  const filled = PACKAGE_CONTENT_GROUP.filter((field) => values[field].trim().length > 0);

  if (filled.length > 0 && filled.length < PACKAGE_CONTENT_GROUP.length) {
    // Partly filled is neither "has a package description" nor "has
    // none". Every empty member of the group is flagged, so the reader
    // sees which ones to complete rather than one error about the group.
    for (const field of PACKAGE_CONTENT_GROUP) {
      if (values[field].trim().length === 0) errors[field] = { key: "packageGroupIncomplete" };
    }
  }

  if (filled.length === PACKAGE_CONTENT_GROUP.length) {
    const quantity = validateDecimal(values.packageContentQuantity, "packageContentQuantity");
    if (quantity) errors.packageContentQuantity = quantity;

    for (const field of ["packageContentUnitNameAr", "packageContentUnitNameEn"] as const) {
      const issue = validateText(values[field], field, true);
      if (issue) errors[field] = issue;
    }
  }

  return errors;
}

/** The first field with an error, in the order the form displays them. */
export function firstErrorField(errors: ProductFormErrors): keyof ProductFormValues | null {
  return PRODUCT_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

export function hasErrors(errors: ProductFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

// --------------------------------------------------------- the boundary

/**
 * The ONE place a form string becomes a JSON number.
 *
 * Called only after `validateProductForm` has established the string is a
 * storable decimal, so this cannot round or reinterpret anything: the digits
 * that go in are the digits that come out.
 */
function toNumber(value: string): number {
  return Number(value.trim());
}

const text = (value: string): string => value.trim();

/**
 * The create body.
 *
 * NEVER sends `null`. There is nothing to clear on a row that does not
 * exist, and the create contract does not accept it — an empty optional is
 * simply omitted.
 */
export function toCreateRequest(values: ProductFormValues): CreateProductRequest {
  const body: CreateProductRequest = {
    taxonomyNodeId: values.taxonomyNodeId,
    salesUnitNameAr: text(values.salesUnitNameAr),
    salesUnitNameEn: text(values.salesUnitNameEn),
    nameAr: text(values.nameAr),
    nameEn: text(values.nameEn),
    weightPerUnit: toNumber(values.weightPerUnit),
    lengthCm: toNumber(values.lengthCm),
    widthCm: toNumber(values.widthCm),
    heightCm: toNumber(values.heightCm),
  };

  if (values.salesUnitId) body.salesUnitId = values.salesUnitId;
  if (text(values.descriptionAr)) body.descriptionAr = text(values.descriptionAr);
  if (text(values.descriptionEn)) body.descriptionEn = text(values.descriptionEn);
  if (text(values.supplierSku)) body.supplierSku = text(values.supplierSku);
  if (text(values.gtin)) body.gtin = text(values.gtin);

  // All three or none — `validateProductForm` has already refused any
  // other combination.
  if (text(values.packageContentQuantity)) {
    body.packageContentQuantity = toNumber(values.packageContentQuantity);
    body.packageContentUnitNameAr = text(values.packageContentUnitNameAr);
    body.packageContentUnitNameEn = text(values.packageContentUnitNameEn);
  }

  return body;
}

/**
 * The update body: ONLY what changed.
 *
 * Three outcomes per field, matching what the API does with each:
 *
 *   unchanged        omitted entirely   -> the column is not touched
 *   changed to a value   sent as a value
 *   emptied          sent as `null`     -> the column is cleared
 *
 * Sending every field on every save would work, but it would also rewrite
 * columns nobody edited — and on an APPROVED product each write re-runs the
 * technical checks and writes a new snapshot, so a no-op save would not be
 * one.
 *
 * The package group is all-or-nothing on the way out too: emptying it sends
 * three nulls together, which is the only shape the API accepts as a clear.
 */
export function toUpdateRequest(
  values: ProductFormValues,
  initial: ProductFormValues
): UpdateProductRequest {
  const body: UpdateProductRequest = {};

  const changed = (field: keyof ProductFormValues) =>
    text(values[field]) !== text(initial[field]);

  // Required text and the taxonomy: a value or nothing. These columns are
  // NOT NULL, so they have nothing to clear to.
  for (const field of ["nameAr", "nameEn", "salesUnitNameAr", "salesUnitNameEn"] as const) {
    if (changed(field)) body[field] = text(values[field]);
  }
  if (changed("taxonomyNodeId")) body.taxonomyNodeId = values.taxonomyNodeId;

  // Clearable single fields: emptied means `null`.
  if (changed("salesUnitId")) {
    body.salesUnitId = values.salesUnitId ? values.salesUnitId : null;
  }
  for (const field of ["descriptionAr", "descriptionEn"] as const) {
    if (changed(field)) body[field] = text(values[field]) ? text(values[field]) : null;
  }
  for (const field of ["supplierSku", "gtin"] as const) {
    if (changed(field)) body[field] = text(values[field]) || null;
  }

  // Decimals: a number, or omitted. Compared as the strings they were
  // shown as, so `12.500` from the API is not "changed" into `12.5`.
  for (const field of ["weightPerUnit", "lengthCm", "widthCm", "heightCm"] as const) {
    if (changed(field)) body[field] = toNumber(values[field]);
  }

  // The package group, as a unit.
  const groupChanged = PACKAGE_CONTENT_GROUP.some((field) => changed(field));
  if (groupChanged) {
    const filled = text(values.packageContentQuantity).length > 0;

    if (filled) {
      body.packageContentQuantity = toNumber(values.packageContentQuantity);
      body.packageContentUnitNameAr = text(values.packageContentUnitNameAr);
      body.packageContentUnitNameEn = text(values.packageContentUnitNameEn);
    } else {
      // Cleared: all three together, which is the only clear the API
      // accepts. A mixed clear is refused by validation before here.
      body.packageContentQuantity = null;
      body.packageContentUnitNameAr = null;
      body.packageContentUnitNameEn = null;
    }
  }

  return body;
}

/** True when anything at all differs from what was loaded. */
export function isDirty(values: ProductFormValues, initial: ProductFormValues): boolean {
  return PRODUCT_FORM_FIELDS.some((field) => text(values[field]) !== text(initial[field]));
}
