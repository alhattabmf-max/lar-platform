import {
  MONEY_SCALE,
  type SupplierOpportunityDetail,
  type SupplierOpportunityReasonCode,
} from "@platform/types";

/**
 * The opportunity form, as data.
 *
 * Same shape as `product-form.ts` and for the same reasons: values are the
 * strings an input holds, every rule is a pure function, and a number is
 * produced exactly ONCE — at the request boundary, after validation has
 * established the string is a storable amount.
 *
 * `unitPriceAmount` is MONEY. It arrives from the API as a decimal string
 * at scale 2 and is sent back as a JSON number because that is what
 * `CreateOpportunityDto` accepts — bounded by `IsMoneyAmount` to exactly
 * what `Decimal(12,2)` holds. Nothing here adds, multiplies or totals it:
 * the tax split and the total value are computed and FROZEN server-side at
 * publish, and a client that recomputed either would produce a second
 * figure that eventually disagrees with what traders were charged.
 */

export interface OpportunityFormValues {
  productId: string;
  fulfillmentLocationId: string;
  targetQuantity: string;
  unitPriceAmount: string;
  startAt: string;
  endAt: string;
  expectedPreparationDays: string;
  descriptionAr: string;
  descriptionEn: string;
}

export const OPPORTUNITY_FORM_FIELDS = [
  "productId",
  "fulfillmentLocationId",
  "targetQuantity",
  "unitPriceAmount",
  "startAt",
  "endAt",
  "expectedPreparationDays",
  "descriptionAr",
  "descriptionEn",
] as const satisfies readonly (keyof OpportunityFormValues)[];

/** The order fields appear, so "first error" means first on the screen. */
export const OPPORTUNITY_FIELD_ORDER: readonly (keyof OpportunityFormValues)[] = [
  "productId",
  "fulfillmentLocationId",
  "unitPriceAmount",
  "targetQuantity",
  "startAt",
  "endAt",
  "expectedPreparationDays",
  "descriptionAr",
  "descriptionEn",
];

export const EMPTY_OPPORTUNITY_FORM: OpportunityFormValues = {
  productId: "",
  fulfillmentLocationId: "",
  targetQuantity: "",
  unitPriceAmount: "",
  startAt: "",
  endAt: "",
  expectedPreparationDays: "",
  descriptionAr: "",
  descriptionEn: "",
};

/** Largest value the price's own `Decimal(12,2)` column can hold. */
export const OPPORTUNITY_PRICE_MAX = 9_999_999_999.99;
/** `Opportunity.targetQuantity` is an `Int`, bounded by settings the client cannot read. */
export const OPPORTUNITY_QUANTITY_MAX = 10_000_000;
export const OPPORTUNITY_DESCRIPTION_MAX = 5000;

/**
 * `datetime-local` gives `YYYY-MM-DDTHH:mm`; the API wants ISO 8601.
 *
 * Converted at the boundary, not stored converted — the input must hold
 * exactly what the browser put in it, or the field fights the reader.
 */
function toIso(value: string): string {
  return new Date(value).toISOString();
}

/** ISO 8601 back to what a `datetime-local` input accepts, in the business zone. */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  // The stored instant, rendered in Asia/Riyadh — the zone every deadline
  // in this product is enforced in. Using the browser's zone would show a
  // supplier abroad a different closing time from the one that applies.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function opportunityFormFromDetail(
  detail: SupplierOpportunityDetail
): OpportunityFormValues {
  return {
    productId: detail.productId,
    fulfillmentLocationId: detail.fulfillmentLocationId,
    targetQuantity: String(detail.targetQuantity),
    // The decimal string, verbatim. Reformatting it would make the field
    // look edited before anyone touched it.
    unitPriceAmount: detail.unitPriceAmount,
    startAt: toLocalInput(detail.startAt),
    endAt: toLocalInput(detail.endAt),
    expectedPreparationDays: String(detail.expectedPreparationDays),
    descriptionAr: detail.descriptionAr ?? "",
    descriptionEn: detail.descriptionEn ?? "",
  };
}

// ------------------------------------------------------------ validation

export interface FieldIssue {
  key: string;
  values?: Record<string, string | number>;
}

export type OpportunityFormErrors = Partial<Record<keyof OpportunityFormValues, FieldIssue>>;

/** Anchored: `1e3`, `12,50`, `+5` and a trailing dot are refused, not partly matched. */
const MONEY_TEXT = /^\d+(\.\d+)?$/;
const INTEGER_TEXT = /^\d+$/;

function validateMoney(raw: string): FieldIssue | null {
  const value = raw.trim();
  if (!MONEY_TEXT.test(value)) return { key: "invalidNumber" };

  const fraction = value.split(".")[1];
  if (fraction !== undefined && fraction.length > MONEY_SCALE) {
    return { key: "tooPrecise", values: { scale: MONEY_SCALE } };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { key: "invalidNumber" };
  if (parsed <= 0) return { key: "mustBePositive" };
  if (parsed > OPPORTUNITY_PRICE_MAX) {
    return { key: "tooLarge", values: { max: OPPORTUNITY_PRICE_MAX } };
  }
  return null;
}

function validateInteger(raw: string, max: number): FieldIssue | null {
  const value = raw.trim();
  if (!INTEGER_TEXT.test(value)) return { key: "invalidInteger" };

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return { key: "invalidInteger" };
  if (parsed <= 0) return { key: "mustBePositive" };
  if (parsed > max) return { key: "tooLarge", values: { max } };
  return null;
}

/**
 * Everything wrong with the form, all at once.
 *
 * Deliberately does NOT check the duration bounds or the quantity range.
 * `minDurationHours`, `maxDurationDays`, `minTargetQuantity` and
 * `maxTargetQuantity` are admin-configured in `OpportunitySettingsService`
 * and no endpoint exposes them — a number stated here would be one this app
 * invented. The server refuses and says which bound was missed.
 *
 * What IS checked here is the one ordering rule that needs no setting:
 * the window has to end after it starts.
 */
export function validateOpportunityForm(
  values: OpportunityFormValues
): OpportunityFormErrors {
  const errors: OpportunityFormErrors = {};

  if (!values.productId) errors.productId = { key: "required" };
  if (!values.fulfillmentLocationId) errors.fulfillmentLocationId = { key: "required" };

  const price = validateMoney(values.unitPriceAmount);
  if (price) errors.unitPriceAmount = price;

  const quantity = validateInteger(values.targetQuantity, OPPORTUNITY_QUANTITY_MAX);
  if (quantity) errors.targetQuantity = quantity;

  const days = validateInteger(values.expectedPreparationDays, 365);
  if (days) errors.expectedPreparationDays = days;

  if (!values.startAt) errors.startAt = { key: "required" };
  if (!values.endAt) errors.endAt = { key: "required" };

  if (values.startAt && values.endAt) {
    const start = new Date(values.startAt).getTime();
    const end = new Date(values.endAt).getTime();

    if (Number.isNaN(start)) errors.startAt = { key: "invalidDate" };
    else if (Number.isNaN(end)) errors.endAt = { key: "invalidDate" };
    else if (end <= start) errors.endAt = { key: "endBeforeStart" };
  }

  for (const field of ["descriptionAr", "descriptionEn"] as const) {
    if (values[field].trim().length > OPPORTUNITY_DESCRIPTION_MAX) {
      errors[field] = { key: "tooLong", values: { max: OPPORTUNITY_DESCRIPTION_MAX } };
    }
  }

  return errors;
}

export function firstOpportunityErrorField(
  errors: OpportunityFormErrors
): keyof OpportunityFormValues | null {
  return OPPORTUNITY_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

export function hasOpportunityErrors(errors: OpportunityFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

// --------------------------------------------------------- the boundary

/** The ONE place a form string becomes a JSON number. */
const num = (value: string): number => Number(value.trim());
const text = (value: string): string => value.trim();

export interface CreateOpportunityBody {
  productId: string;
  fulfillmentLocationId: string;
  targetQuantity: number;
  unitPriceAmount: number;
  startAt: string;
  endAt: string;
  expectedPreparationDays: number;
  descriptionAr?: string;
  descriptionEn?: string;
}

export function toCreateOpportunityBody(
  values: OpportunityFormValues
): CreateOpportunityBody {
  const body: CreateOpportunityBody = {
    productId: values.productId,
    fulfillmentLocationId: values.fulfillmentLocationId,
    targetQuantity: num(values.targetQuantity),
    unitPriceAmount: num(values.unitPriceAmount),
    startAt: toIso(values.startAt),
    endAt: toIso(values.endAt),
    expectedPreparationDays: num(values.expectedPreparationDays),
  };

  // `UpdateOpportunityDto` accepts no null, so an empty optional is
  // omitted rather than cleared. Clearing a description is not something
  // this endpoint offers.
  if (text(values.descriptionAr)) body.descriptionAr = text(values.descriptionAr);
  if (text(values.descriptionEn)) body.descriptionEn = text(values.descriptionEn);

  return body;
}

export type UpdateOpportunityBody = Partial<CreateOpportunityBody>;

/**
 * The update body: only what changed.
 *
 * Dates are compared as the LOCAL input strings they were shown as, so a
 * value the reader never touched cannot be re-sent as a fractionally
 * different instant after a round trip through `toIso`.
 */
export function toUpdateOpportunityBody(
  values: OpportunityFormValues,
  initial: OpportunityFormValues
): UpdateOpportunityBody {
  const body: UpdateOpportunityBody = {};
  const changed = (field: keyof OpportunityFormValues) =>
    text(values[field]) !== text(initial[field]);

  if (changed("productId")) body.productId = values.productId;
  if (changed("fulfillmentLocationId")) {
    body.fulfillmentLocationId = values.fulfillmentLocationId;
  }
  if (changed("targetQuantity")) body.targetQuantity = num(values.targetQuantity);
  if (changed("unitPriceAmount")) body.unitPriceAmount = num(values.unitPriceAmount);
  if (changed("expectedPreparationDays")) {
    body.expectedPreparationDays = num(values.expectedPreparationDays);
  }
  if (changed("startAt")) body.startAt = toIso(values.startAt);
  if (changed("endAt")) body.endAt = toIso(values.endAt);
  if (changed("descriptionAr")) body.descriptionAr = text(values.descriptionAr);
  if (changed("descriptionEn")) body.descriptionEn = text(values.descriptionEn);

  return body;
}

export function isOpportunityDirty(
  values: OpportunityFormValues,
  initial: OpportunityFormValues
): boolean {
  return OPPORTUNITY_FORM_FIELDS.some((field) => text(values[field]) !== text(initial[field]));
}

/**
 * Which form field a blocking reason points at, or null.
 *
 * Six of the ten `ACTION_REQUIRED` reasons are fixed by editing the
 * listing; the other four are fixed elsewhere — a product's approval, the
 * company's verification, its payout details, or the platform's own tax
 * configuration. Returning null for those is what stops the form claiming
 * a field can fix something it cannot.
 */
export function reasonField(
  code: SupplierOpportunityReasonCode
): keyof OpportunityFormValues | null {
  switch (code) {
    case "LOCATION_INACTIVE":
    case "LOCATION_CITY_INACTIVE":
      return "fulfillmentLocationId";
    case "PURCHASE_QUANTITY_NOT_COMPATIBLE":
      return "targetQuantity";
    case "PRODUCT_ARCHIVED":
    case "PRODUCT_SUSPENDED":
    case "PRODUCT_CLOSED":
      return "productId";
    default:
      // PRODUCT_NOT_APPROVED, SUPPLIER_NOT_VERIFIED,
      // SUPPLIER_NOT_FINANCIALLY_READY, TAX_RATE_NOT_CONFIGURED.
      return null;
  }
}
