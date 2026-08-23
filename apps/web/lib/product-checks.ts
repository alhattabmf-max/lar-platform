import {
  PRODUCT_TECHNICAL_CHECK_FIELDS,
  type ProductTechnicalCheckCode,
} from "@platform/types";
import { PRODUCT_FIELD_ORDER, type ProductFormValues } from "./product-form";

/**
 * Turning a failed technical check into something on the screen.
 *
 * The API answers `PRODUCT_TECHNICAL_CHECK_FAILED` with a list of codes from
 * a closed vocabulary — never the English sentences it used to send, and
 * never anything else from `details`, which `ApiError` does not expose.
 *
 * Each code maps to a form field, or to `media`, which is the image panel
 * rather than an input. That distinction is why this returns a tagged
 * target instead of a plain field name: focusing a field that does not
 * exist would silently do nothing, and "add a main image" is the one
 * failure whose fix is not typing.
 */
export type CheckTarget =
  | { kind: "field"; field: keyof ProductFormValues }
  | { kind: "media" };

const FORM_FIELDS = new Set<string>(PRODUCT_FIELD_ORDER);

export function checkTarget(code: ProductTechnicalCheckCode): CheckTarget {
  const target = PRODUCT_TECHNICAL_CHECK_FIELDS[code];
  return FORM_FIELDS.has(target)
    ? { kind: "field", field: target as keyof ProductFormValues }
    : { kind: "media" };
}

/**
 * The codes, ordered as the form displays their targets.
 *
 * "First error" has to mean first on the screen. `MAIN_IMAGE_REQUIRED`
 * sorts last because the image panel sits below the fields — its position
 * is a fact about the page, stated here rather than assumed at the call
 * site.
 */
export function orderChecks(
  codes: readonly ProductTechnicalCheckCode[]
): ProductTechnicalCheckCode[] {
  const position = (code: ProductTechnicalCheckCode): number => {
    const target = checkTarget(code);
    if (target.kind === "media") return Number.MAX_SAFE_INTEGER;
    const index = PRODUCT_FIELD_ORDER.indexOf(target.field);
    return index === -1 ? Number.MAX_SAFE_INTEGER - 1 : index;
  };

  return [...codes].sort((a, b) => position(a) - position(b));
}

/** Where focus should go for a set of failures, or null if there are none. */
export function firstCheckTarget(
  codes: readonly ProductTechnicalCheckCode[]
): CheckTarget | null {
  const ordered = orderChecks(codes);
  return ordered.length > 0 ? checkTarget(ordered[0]) : null;
}
