import { PRODUCT_DECIMAL_FIELDS, PRODUCT_TEXT_LIMITS } from "@platform/types";
import type { CreateProductRequest, OpportunityLimits } from "@platform/types";

/**
 * TWO FORMS OUT OF ONE, and the difference is a single prop.
 *
 * A PRODUCT is what the supplier keeps: a name, a category, a picture,
 * a selling unit, what is in the carton, and what a carrier needs to
 * move it. It is recorded once and no trader ever sees it.
 *
 * AN OFFER is what the market can see: a price, a quantity, the branch
 * it ships from, and a clock. The same product carries many of them,
 * one after another.
 *
 * They were ONE submission for a while — add a product and it went on
 * sale in the same breath — and that left a supplier no way to record
 * goods without selling them, and no way to offer the same goods a
 * second time. The owner's rule: «يسجّل المورد كل منتجاته وتُحفظ لديه،
 * ثم يُنشئ عرضًا على منتجات مختارة، ويعيد الكرّة على نفس المنتج».
 *
 * WHY ONE VALUES TYPE STILL. The two scopes never share a screen, but
 * they do share every rule, every label and the whole of the layout
 * language — one shape with a scope reads better than two files that
 * drift. `scopeFields()` is the only thing that decides which half of
 * it is being asked for, and validation, the error summary and the
 * request builders all go through it.
 *
 * NOTHING HERE COMPUTES MONEY. The tax split, the total value and the
 * minimum order (the share) are resolved and FROZEN server side at
 * publish. A client-side estimate of any of them would be a second
 * figure that eventually disagrees with what a buyer was charged.
 *
 * THE BOUNDS BELOW WARN; THEY DO NOT DECIDE. Every one is re-checked
 * against live policy at the moment of the request, and this copy may be
 * a minute old.
 */
export interface ListingFormValues {
  nameAr: string;
  nameEn: string;
  taxonomyNodeId: string;
  descriptionAr: string;
  descriptionEn: string;
  salesUnitId: string;
  salesUnitNameAr: string;
  salesUnitNameEn: string;
  unitPriceAmount: string;
  targetQuantity: string;
  fulfillmentLocationId: string;
  offerDurationDays: string;
  expectedPreparationDays: string;
  weightPerUnit: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  packageContentQuantity: string;
  packageContentUnitNameAr: string;
  packageContentUnitNameEn: string;
}

export type ListingField = keyof ListingFormValues;

/**
 * WHICH OF THE THREE THINGS IS BEING WRITTEN.
 *
 * `product` is what the supplier keeps. `offer` is the collective sale:
 * a target to reach, a share each buyer takes, and a clock. `direct` is
 * the fixed-price sale from stock — «المورد يحدد المنتج وسعر الوحدة
 * والكمية ووحدة البيع وأيام التجهيز» — and the difference between it
 * and an offer is one field: it has no duration, because a shelf does
 * not expire.
 */
export type ListingScope = "product" | "offer" | "direct";

/**
 * THE ORDER THE EYE READS, and the order an error summary jumps in.
 *
 * Identity first, then the category, then how it is sold, then the
 * terms, then what a carrier needs. `image` is not in this list because
 * it is not a text field — it has its own error slot.
 */
export const LISTING_FIELD_ORDER: readonly ListingField[] = [
  "nameAr",
  "nameEn",
  "taxonomyNodeId",
  "descriptionAr",
  "descriptionEn",
  "salesUnitNameAr",
  "salesUnitNameEn",
  "unitPriceAmount",
  "targetQuantity",
  "fulfillmentLocationId",
  "offerDurationDays",
  "expectedPreparationDays",
  "weightPerUnit",
  "lengthCm",
  "widthCm",
  "heightCm",
  "packageContentQuantity",
  "packageContentUnitNameAr",
  "packageContentUnitNameEn",
];

/**
 * WHAT BELONGS TO THE THING, not to the selling of it.
 *
 * Weight and the three dimensions are here and NOT with the offer: they
 * describe the packed selling unit, which does not change because the
 * price did. The package content is here for the same reason.
 */
export const PRODUCT_SCOPE_FIELDS: readonly ListingField[] = [
  "nameAr",
  "nameEn",
  "taxonomyNodeId",
  "descriptionAr",
  "descriptionEn",
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

/**
 * WHAT BELONGS TO THIS OFFER AND ONLY TO IT.
 *
 * The branch is here rather than with the product because a supplier
 * may ship the same goods from Riyadh this month and Dammam the next,
 * and the branch is what pins the region an order is fulfilled from.
 *
 * The preparation days are here for the same reason: they reach an
 * order's delivery deadline, and that deadline belongs to the sale.
 */
export const OFFER_SCOPE_FIELDS: readonly ListingField[] = [
  "unitPriceAmount",
  "targetQuantity",
  "fulfillmentLocationId",
  "offerDurationDays",
  "expectedPreparationDays",
];

/**
 * WHAT A DIRECT LISTING ASKS: the same four as an offer, minus the
 * duration.
 *
 * `targetQuantity` is the stock on the shelf here and the collective
 * target there — one column, two readings, and the label on the screen
 * is what says which.
 */
export const DIRECT_SCOPE_FIELDS: readonly ListingField[] = [
  "unitPriceAmount",
  "targetQuantity",
  "fulfillmentLocationId",
  "expectedPreparationDays",
];

export function scopeFields(scope: ListingScope): readonly ListingField[] {
  if (scope === "product") return PRODUCT_SCOPE_FIELDS;
  if (scope === "direct") return DIRECT_SCOPE_FIELDS;
  return OFFER_SCOPE_FIELDS;
}

export const EMPTY_LISTING_FORM: ListingFormValues = {
  nameAr: "",
  nameEn: "",
  taxonomyNodeId: "",
  descriptionAr: "",
  descriptionEn: "",
  salesUnitId: "",
  salesUnitNameAr: "",
  salesUnitNameEn: "",
  unitPriceAmount: "",
  targetQuantity: "",
  fulfillmentLocationId: "",
  // SEVEN DAYS, because a week is what a supplier means by "an offer"
  // more often than anything else. Visible and editable — a default
  // nobody saw is a commitment nobody made.
  offerDurationDays: "7",
  // A DEFAULT THAT IS VISIBLE, not silent. This reaches an order's
  // delivery deadline, so the supplier has to see the number they are
  // being held to — but starting from blank on a field almost every
  // offer answers the same way is friction for nothing.
  expectedPreparationDays: "3",
  weightPerUnit: "",
  lengthCm: "",
  widthCm: "",
  heightCm: "",
  packageContentQuantity: "",
  packageContentUnitNameAr: "",
  packageContentUnitNameEn: "",
};

/** A translation key plus whatever the message interpolates. */
export interface ListingFieldError {
  key: string;
  values?: Record<string, string | number>;
}

export type ListingFormErrors = Partial<Record<ListingField | "image", ListingFieldError>>;

const required = (): ListingFieldError => ({ key: "required" });

function textRule(
  value: string,
  limit: number,
  mandatory: boolean
): ListingFieldError | undefined {
  const trimmed = value.trim();
  if (!trimmed) return mandatory ? required() : undefined;
  if (trimmed.length > limit) return { key: "tooLong", values: { max: limit } };
  return undefined;
}

/**
 * A decimal the column can actually hold.
 *
 * SCALE IS CHECKED, not rounded away. Silently dropping a third decimal
 * would store a weight the supplier did not type, and on price it would
 * charge on a number they never entered.
 */
function decimalRule(
  value: string,
  { scale, max }: { scale: number; max: number },
  mandatory: boolean
): ListingFieldError | undefined {
  const trimmed = value.trim();
  if (!trimmed) return mandatory ? required() : undefined;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { key: "notANumber" };
  if (parsed <= 0) return { key: "notPositive" };
  if (parsed > max) return { key: "tooLarge", values: { max } };

  const decimals = trimmed.includes(".") ? trimmed.split(".")[1].length : 0;
  if (decimals > scale) return { key: "tooPrecise", values: { scale } };

  return undefined;
}

function integerRule(value: string, mandatory: boolean): ListingFieldError | undefined {
  const trimmed = value.trim();
  if (!trimmed) return mandatory ? required() : undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed)) return { key: "notAnInteger" };
  if (parsed <= 0) return { key: "notPositive" };
  return undefined;
}

/**
 * Everything wrong with the form, as keys rather than sentences.
 *
 * ONLY THE SCOPE'S OWN FIELDS ARE ASKED FOR. The other half of the
 * values object is untouched — it is not on the screen, so an error on
 * it would be an error nobody can clear.
 *
 * The catalogue turns the keys into text where the reader's language is
 * known. A sentence built here would be one language, and an error
 * message is the last place a platform may drop into English.
 */
export function validateListingForm(
  values: ListingFormValues,
  options: { scope: ListingScope; limits?: OpportunityLimits; hasImage?: boolean }
): ListingFormErrors {
  const errors: ListingFormErrors = {};
  const set = (field: ListingField | "image", error?: ListingFieldError) => {
    if (error) errors[field] = error;
  };

  if (options.scope === "product") {
    set("nameAr", textRule(values.nameAr, PRODUCT_TEXT_LIMITS.nameAr, true));
    set("nameEn", textRule(values.nameEn, PRODUCT_TEXT_LIMITS.nameEn, true));
    set("descriptionAr", textRule(values.descriptionAr, PRODUCT_TEXT_LIMITS.descriptionAr, false));
    set("descriptionEn", textRule(values.descriptionEn, PRODUCT_TEXT_LIMITS.descriptionEn, false));
    set(
      "salesUnitNameAr",
      textRule(values.salesUnitNameAr, PRODUCT_TEXT_LIMITS.salesUnitNameAr, true)
    );
    set(
      "salesUnitNameEn",
      textRule(values.salesUnitNameEn, PRODUCT_TEXT_LIMITS.salesUnitNameEn, true)
    );

    if (!values.taxonomyNodeId) set("taxonomyNodeId", required());

    // THE IMAGE IS NOT OPTIONAL. Approval refuses a product with no main
    // image, so accepting the form without one would only move the
    // rejection later and lose everything typed.
    if (!options.hasImage) set("image", required());

    set(
      "weightPerUnit",
      decimalRule(values.weightPerUnit, PRODUCT_DECIMAL_FIELDS.weightPerUnit, true)
    );
    set("lengthCm", decimalRule(values.lengthCm, PRODUCT_DECIMAL_FIELDS.lengthCm, true));
    set("widthCm", decimalRule(values.widthCm, PRODUCT_DECIMAL_FIELDS.widthCm, true));
    set("heightCm", decimalRule(values.heightCm, PRODUCT_DECIMAL_FIELDS.heightCm, true));

    // REQUIRED, on the owner's instruction. It was an optional group of
    // three, folded away; a buyer needs to know what is in a carton, and
    // "all three or none" is a rule that only exists because it could be
    // none.
    set(
      "packageContentQuantity",
      decimalRule(
        values.packageContentQuantity,
        PRODUCT_DECIMAL_FIELDS.packageContentQuantity,
        true
      )
    );
    set(
      "packageContentUnitNameAr",
      textRule(values.packageContentUnitNameAr, PRODUCT_TEXT_LIMITS.packageContentUnitNameAr, true)
    );
    set(
      "packageContentUnitNameEn",
      textRule(values.packageContentUnitNameEn, PRODUCT_TEXT_LIMITS.packageContentUnitNameEn, true)
    );

    return errors;
  }

  // ---------------------------------------------------------- the offer

  if (!values.fulfillmentLocationId) set("fulfillmentLocationId", required());

  set(
    "unitPriceAmount",
    decimalRule(values.unitPriceAmount, { scale: 2, max: 9_999_999_999.99 }, true)
  );
  set("targetQuantity", integerRule(values.targetQuantity, true));
  set("expectedPreparationDays", integerRule(values.expectedPreparationDays, true));

  // HOW LONG, not from when to when. The window is stamped at
  // publication — start is the moment the offer goes on sale — so the
  // only thing to check here is the length.
  //
  // A DIRECT LISTING IS NOT ASKED. «لا مدة انتهاء»: a shelf has no
  // window, the API refuses one, and a field nobody can answer would
  // be an error nobody can clear.
  if (options.scope !== "direct") {
    set("offerDurationDays", integerRule(values.offerDurationDays, true));
  }

  if (options.scope !== "direct" && options.limits && !errors.offerDurationDays) {
    const hours = Number(values.offerDurationDays) * 24;
    if (hours < options.limits.minDurationHours) {
      set("offerDurationDays", {
        key: "tooShort",
        values: { hours: options.limits.minDurationHours },
      });
    } else if (hours > options.limits.maxDurationDays * 24) {
      set("offerDurationDays", {
        key: "tooLong",
        values: { days: options.limits.maxDurationDays },
      });
    }
  }

  if (options.limits && !errors.targetQuantity) {
    const quantity = Number(values.targetQuantity);
    if (quantity < options.limits.minTargetQuantity) {
      set("targetQuantity", { key: "belowMin", values: { min: options.limits.minTargetQuantity } });
    } else if (quantity > options.limits.maxTargetQuantity) {
      set("targetQuantity", { key: "aboveMax", values: { max: options.limits.maxTargetQuantity } });
    }
  }

  return errors;
}

export function hasListingErrors(errors: ListingFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** For moving focus to the first problem rather than the last. */
export function firstListingErrorField(
  errors: ListingFormErrors
): ListingField | "image" | undefined {
  if (errors.image) return "image";
  return LISTING_FIELD_ORDER.find((field) => errors[field]);
}

// --------------------------------------------------------- the boundary

/**
 * The ONE place a form string becomes a JSON number.
 *
 * Reached only after validation has established the string is a
 * storable decimal, so this cannot round or reinterpret anything: the
 * digits that go in are the digits that come out.
 */
const num = (value: string): number => Number(value.trim());

/** Trimmed, or absent — never the empty string. */
const text = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

/**
 * The catalogue row, as `POST /companies/me/products` takes it.
 *
 * NEVER SENDS `null`. There is nothing to clear on a row that does not
 * exist yet, and the create contract does not accept it — an empty
 * optional is simply omitted.
 */
export function toProductRequest(values: ListingFormValues): CreateProductRequest {
  const body: CreateProductRequest = {
    taxonomyNodeId: values.taxonomyNodeId,
    nameAr: values.nameAr.trim(),
    nameEn: values.nameEn.trim(),
    salesUnitNameAr: values.salesUnitNameAr.trim(),
    salesUnitNameEn: values.salesUnitNameEn.trim(),
    weightPerUnit: num(values.weightPerUnit),
    lengthCm: num(values.lengthCm),
    widthCm: num(values.widthCm),
    heightCm: num(values.heightCm),
    // All three together — validation refuses any other combination.
    packageContentQuantity: num(values.packageContentQuantity),
    packageContentUnitNameAr: values.packageContentUnitNameAr.trim(),
    packageContentUnitNameEn: values.packageContentUnitNameEn.trim(),
  };

  const salesUnitId = text(values.salesUnitId);
  if (salesUnitId) body.salesUnitId = salesUnitId;

  const descriptionAr = text(values.descriptionAr);
  if (descriptionAr) body.descriptionAr = descriptionAr;
  const descriptionEn = text(values.descriptionEn);
  if (descriptionEn) body.descriptionEn = descriptionEn;

  return body;
}

export interface CreateOfferBody {
  productId: string;
  /**
   * OMITTED FOR A GROUP OFFER, which is what the API defaults to — so a
   * request written before there were two paths still means what it
   * meant. Sent explicitly for a direct sale.
   */
  saleMode?: "GROUP" | "DIRECT";
  fulfillmentLocationId: string;
  targetQuantity: number;
  unitPriceAmount: number;
  /**
   * THE WINDOW, and only a group offer has one. The API refuses either
   * of these on a direct listing rather than ignoring it — a supplier
   * who sent a closing date would otherwise believe they had set one.
   */
  startAt?: string;
  endAt?: string;
  expectedPreparationDays: number;
}

/** A day, in milliseconds. Named, because `86_400_000` in an expression is a riddle. */
const DAY_MS = 86_400_000;

/**
 * The offer row, as `POST /companies/me/opportunities` takes it.
 *
 * THE SUPPLIER ANSWERED A DURATION, and the columns are two instants —
 * every sweep, every order deadline and the whole lifecycle hang off
 * them. So the pair is derived here: now, and now plus the days. There
 * is no start field on the form and there should not be one; an offer
 * starts when it goes on sale.
 *
 * THIS PAIR IS PROVISIONAL. Publication re-stamps both from the moment
 * it actually succeeds, carrying the same distance across — so an offer
 * blocked for a week and published today runs its full period from
 * today rather than opening already part-expired. `now` is a parameter
 * for the same reason a clock is never read twice in one calculation:
 * a test can hold it still.
 */
export function toOfferRequest(
  values: ListingFormValues,
  productId: string,
  now: Date = new Date()
): CreateOfferBody {
  const days = num(values.offerDurationDays);

  return {
    productId,
    fulfillmentLocationId: values.fulfillmentLocationId,
    targetQuantity: num(values.targetQuantity),
    unitPriceAmount: num(values.unitPriceAmount),
    startAt: now.toISOString(),
    endAt: new Date(now.getTime() + days * DAY_MS).toISOString(),
    expectedPreparationDays: num(values.expectedPreparationDays),
  };
}

/**
 * The direct listing, as `POST /companies/me/opportunities` takes it.
 *
 * THE SAME ENDPOINT AND THE SAME ROW — one discriminator apart. What is
 * missing is the whole difference: no `startAt`, no `endAt`, because
 * «لا مدة انتهاء» and the API refuses a window on this mode.
 *
 * `targetQuantity` IS THE STOCK here. The column serves both readings
 * and was deliberately not renamed; what says which is the label on the
 * screen and this comment.
 */
export function toDirectRequest(
  values: ListingFormValues,
  productId: string
): CreateOfferBody {
  return {
    productId,
    saleMode: "DIRECT",
    fulfillmentLocationId: values.fulfillmentLocationId,
    targetQuantity: num(values.targetQuantity),
    unitPriceAmount: num(values.unitPriceAmount),
    expectedPreparationDays: num(values.expectedPreparationDays),
  };
}
