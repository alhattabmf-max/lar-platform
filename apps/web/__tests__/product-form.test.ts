import { describe, expect, it } from "vitest";
import {
  PACKAGE_CONTENT_GROUP,
  PRODUCT_DECIMAL_FIELDS,
  PRODUCT_TECHNICAL_CHECK_CODES,
  PRODUCT_TEXT_LIMITS,
  UPDATE_PRODUCT_REQUEST_KEYS,
  type ProductDetail,
} from "@platform/types";
import {
  EMPTY_PRODUCT_FORM,
  PRODUCT_FIELD_ORDER,
  firstErrorField,
  hasErrors,
  isDirty,
  productFormFromDetail,
  toCreateRequest,
  toUpdateRequest,
  validateProductForm,
  type ProductFormValues,
} from "@/lib/product-form";
import { checkTarget, firstCheckTarget, orderChecks } from "@/lib/product-checks";

/**
 * The product form's rules, as data.
 *
 * The component renders these; this file proves them. A form asserted only
 * through the DOM tends to test the labels.
 */

const NODE = "11111111-1111-4111-8111-111111111111";
const UNIT = "22222222-2222-4222-8222-222222222222";

const FILLED: ProductFormValues = {
  taxonomyNodeId: NODE,
  salesUnitId: UNIT,
  salesUnitNameAr: "كرتون",
  salesUnitNameEn: "Carton",
  nameAr: "زيت زيتون",
  nameEn: "Olive oil",
  descriptionAr: "وصف",
  descriptionEn: "Description",
  weightPerUnit: "12.5",
  lengthCm: "30",
  widthCm: "20",
  heightCm: "15",
  packageContentQuantity: "",
  packageContentUnitNameAr: "",
  packageContentUnitNameEn: "",
};

const WITH_PACKAGE: ProductFormValues = {
  ...FILLED,
  packageContentQuantity: "6",
  packageContentUnitNameAr: "علبة",
  packageContentUnitNameEn: "Box",
};

// ------------------------------------------------------------ validation

describe("validation mirrors the DTO, from the same shared constants", () => {
  it("passes a complete form", () => {
    expect(validateProductForm(FILLED)).toEqual({});
    expect(hasErrors(validateProductForm(FILLED))).toBe(false);
  });

  it("reports EVERY problem at once, not the first", () => {
    // A form that reveals one problem per submit makes someone submit
    // five times to learn five things.
    const errors = validateProductForm(EMPTY_PRODUCT_FORM);

    expect(Object.keys(errors).sort()).toEqual(
      [
        "taxonomyNodeId",
        "nameAr",
        "nameEn",
        "salesUnitNameAr",
        "salesUnitNameEn",
        "weightPerUnit",
        "lengthCm",
        "widthCm",
        "heightCm",
      ].sort()
    );
  });

  it("refuses whitespace-only required text", () => {
    expect(validateProductForm({ ...FILLED, nameAr: "   " }).nameAr).toEqual({ key: "required" });
  });

  it.each(Object.keys(PRODUCT_TEXT_LIMITS) as (keyof typeof PRODUCT_TEXT_LIMITS)[])(
    "bounds %s at its shared limit",
    (field) => {
      const limit = PRODUCT_TEXT_LIMITS[field];
      const base = field.startsWith("packageContent") ? WITH_PACKAGE : FILLED;

      expect(validateProductForm({ ...base, [field]: "a".repeat(limit) })[field]).toBeUndefined();
      expect(validateProductForm({ ...base, [field]: "a".repeat(limit + 1) })[field]).toEqual({
        key: "tooLong",
        values: { max: limit },
      });
    }
  );

  it.each(["weightPerUnit", "lengthCm", "widthCm", "heightCm"] as const)(
    "bounds %s to its column's scale and maximum",
    (field) => {
      const { scale, max } = PRODUCT_DECIMAL_FIELDS[field];

      expect(validateProductForm({ ...FILLED, [field]: String(max) })[field]).toBeUndefined();
      expect(validateProductForm({ ...FILLED, [field]: `1.${"0".repeat(scale)}5` })[field]).toEqual(
        { key: "tooPrecise", values: { scale } }
      );
      expect(
        validateProductForm({ ...FILLED, [field]: String(max + 10 ** -scale) })[field]
      ).toEqual({ key: "tooLarge", values: { max } });
    }
  );

  it.each(["1e3", "1E3", "12,50", "+5", "5.", ".5", "abc", "-1", "٥", "5 5"])(
    "refuses %s as a number, before anything parses it",
    (bad) => {
      // `Number("1e3")` is 1000 and `Number("")` is 0 — a parse-first
      // check would store a value the supplier did not type.
      expect(validateProductForm({ ...FILLED, weightPerUnit: bad }).weightPerUnit).toBeTruthy();
    }
  );

  it("accepts a value with stray surrounding whitespace", () => {
    // Trimmed, like every text field — a pasted value with a leading
    // space is not a different number, and rejecting it would be a
    // puzzle rather than a rule.
    expect(validateProductForm({ ...FILLED, weightPerUnit: " 5 " }).weightPerUnit).toBeUndefined();
    expect(toCreateRequest({ ...FILLED, weightPerUnit: " 5 " }).weightPerUnit).toBe(5);
  });

  it("refuses zero, which is not a shippable weight", () => {
    expect(validateProductForm({ ...FILLED, weightPerUnit: "0" }).weightPerUnit).toEqual({
      key: "mustBePositive",
    });
  });

  it("requires a category, with no default standing in for one", () => {
    expect(validateProductForm({ ...FILLED, taxonomyNodeId: "" }).taxonomyNodeId).toEqual({
      key: "required",
    });
  });
});

describe("the package-content group is one unit", () => {
  it("accepts all three empty", () => {
    expect(validateProductForm(FILLED)).toEqual({});
  });

  it("accepts all three filled", () => {
    expect(validateProductForm(WITH_PACKAGE)).toEqual({});
  });

  it.each(PACKAGE_CONTENT_GROUP)("flags the gaps when only %s is filled", (filledField) => {
    const values = { ...FILLED, [filledField]: filledField === "packageContentQuantity" ? "6" : "علبة" };
    const errors = validateProductForm(values);

    const missing = PACKAGE_CONTENT_GROUP.filter((f) => f !== filledField);
    for (const field of missing) {
      expect([field, errors[field]]).toEqual([field, { key: "packageGroupIncomplete" }]);
    }
    // The one that IS filled is not flagged — the reader is told what to
    // complete, not that everything is wrong.
    expect(errors[filledField]).toBeUndefined();
  });

  it("validates the quantity only once the group is complete", () => {
    expect(
      validateProductForm({ ...WITH_PACKAGE, packageContentQuantity: "1.0005" })
        .packageContentQuantity
    ).toEqual({ key: "tooPrecise", values: { scale: 3 } });
  });
});

describe("first error means first on the screen", () => {
  it("follows the display order, not object key order", () => {
    const errors = validateProductForm(EMPTY_PRODUCT_FORM);

    expect(firstErrorField(errors)).toBe("nameAr");
    expect(PRODUCT_FIELD_ORDER.indexOf("nameAr")).toBe(0);
  });

  it("picks the category when the names are filled", () => {
    expect(firstErrorField(validateProductForm({ ...EMPTY_PRODUCT_FORM, nameAr: "أ", nameEn: "A" })))
      .toBe("taxonomyNodeId");
  });

  it("returns null when nothing is wrong", () => {
    expect(firstErrorField({})).toBeNull();
  });
});

// -------------------------------------------------------------- create

describe("the create body", () => {
  it("sends exactly the filled fields, converted once", () => {
    expect(toCreateRequest(FILLED)).toEqual({
      taxonomyNodeId: NODE,
      salesUnitId: UNIT,
      salesUnitNameAr: "كرتون",
      salesUnitNameEn: "Carton",
      nameAr: "زيت زيتون",
      nameEn: "Olive oil",
      descriptionAr: "وصف",
      descriptionEn: "Description",
      weightPerUnit: 12.5,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 15,
    });
  });

  it("converts to JSON numbers exactly once, at the boundary", () => {
    const body = toCreateRequest({ ...FILLED, weightPerUnit: "12.500" });

    expect(typeof body.weightPerUnit).toBe("number");
    // No rounding, no re-scaling, no unit conversion: the digits that
    // went in are the value that comes out.
    expect(body.weightPerUnit).toBe(12.5);
    expect(body.lengthCm).toBe(30);
  });

  it("NEVER sends null — there is nothing to clear on a new row", () => {
    const body = toCreateRequest({ ...EMPTY_PRODUCT_FORM, ...FILLED, descriptionAr: "", descriptionEn: "", salesUnitId: "" });

    expect(JSON.stringify(body)).not.toContain("null");
    expect("descriptionAr" in body).toBe(false);
    expect("salesUnitId" in body).toBe(false);
  });

  it("omits the package group when it is empty, and sends all three when filled", () => {
    expect("packageContentQuantity" in toCreateRequest(FILLED)).toBe(false);

    const body = toCreateRequest(WITH_PACKAGE);
    expect(body.packageContentQuantity).toBe(6);
    expect(body.packageContentUnitNameAr).toBe("علبة");
    expect(body.packageContentUnitNameEn).toBe("Box");
  });

  it("trims text on the way out", () => {
    expect(toCreateRequest({ ...FILLED, nameAr: "  زيت  " }).nameAr).toBe("زيت");
  });
});

// -------------------------------------------------------------- update

describe("the update body carries only what changed", () => {
  it("is empty when nothing was touched", () => {
    expect(toUpdateRequest(FILLED, FILLED)).toEqual({});
  });

  it("sends one field when one field changed", () => {
    // Sending everything would rewrite columns nobody edited — and on an
    // APPROVED product every write re-runs the technical checks and
    // writes a new snapshot, so a no-op save would not be one.
    expect(toUpdateRequest({ ...FILLED, nameAr: "جديد" }, FILLED)).toEqual({ nameAr: "جديد" });
  });

  it("treats an unchanged decimal STRING as unchanged", () => {
    // `12.500` from the API must not become `12.5` and count as an edit.
    const initial = { ...FILLED, weightPerUnit: "12.500" };
    expect(toUpdateRequest(initial, initial)).toEqual({});
  });

  it("sends a changed decimal as a number", () => {
    expect(toUpdateRequest({ ...FILLED, lengthCm: "31" }, FILLED)).toEqual({ lengthCm: 31 });
  });

  it("declares only keys the update contract knows", () => {
    const body = toUpdateRequest(
      { ...WITH_PACKAGE, nameAr: "ج", descriptionEn: "", salesUnitId: "" },
      FILLED
    );

    for (const key of Object.keys(body)) {
      expect([key, (UPDATE_PRODUCT_REQUEST_KEYS as readonly string[]).includes(key)]).toEqual([
        key,
        true,
      ]);
    }
  });
});

describe("clearing sends null; omitting sends nothing", () => {
  it("clears a description that was emptied", () => {
    expect(toUpdateRequest({ ...FILLED, descriptionAr: "" }, FILLED)).toEqual({
      descriptionAr: null,
    });
  });

  it("clears the sales-unit reference while leaving the names alone", () => {
    const body = toUpdateRequest({ ...FILLED, salesUnitId: "" }, FILLED);

    expect(body).toEqual({ salesUnitId: null });
    expect("salesUnitNameAr" in body).toBe(false);
  });

  it("never sends null for a required field", () => {
    // Those columns are NOT NULL — there is nothing to clear them to, and
    // the API refuses null on them.
    const body = toUpdateRequest({ ...FILLED, nameAr: "", salesUnitNameAr: "" }, FILLED);

    expect(body.nameAr).toBe("");
    expect(body.salesUnitNameAr).toBe("");
    expect(body.nameAr).not.toBeNull();
    // Validation refuses this before it is ever sent.
    expect(validateProductForm({ ...FILLED, nameAr: "" }).nameAr).toEqual({ key: "required" });
  });

  it("clears the package group as three nulls together", () => {
    expect(
      toUpdateRequest(
        { ...WITH_PACKAGE, packageContentQuantity: "", packageContentUnitNameAr: "", packageContentUnitNameEn: "" },
        WITH_PACKAGE
      )
    ).toEqual({
      packageContentQuantity: null,
      packageContentUnitNameAr: null,
      packageContentUnitNameEn: null,
    });
  });

  it("sends all three when any one of them changes", () => {
    // The API's own invariant: the group is written as a unit.
    const body = toUpdateRequest({ ...WITH_PACKAGE, packageContentQuantity: "12" }, WITH_PACKAGE);

    expect(body).toEqual({
      packageContentQuantity: 12,
      packageContentUnitNameAr: "علبة",
      packageContentUnitNameEn: "Box",
    });
  });

  it("never emits a mixed clear", () => {
    // Validation refuses a partial group before submit, so the builder
    // can only ever produce three values or three nulls.
    const nulls = toUpdateRequest(
      { ...WITH_PACKAGE, packageContentQuantity: "", packageContentUnitNameAr: "", packageContentUnitNameEn: "" },
      WITH_PACKAGE
    );
    const values = Object.values(nulls);
    expect(values.every((v) => v === null) || values.every((v) => v !== null)).toBe(true);
  });
});

// -------------------------------------------------------------- prefill

describe("prefilling from the API's detail", () => {
  const detail = {
    id: "p-1",
    nameAr: "زيت",
    nameEn: "Oil",
    approvalStatus: "APPROVED",
    rejectionReason: null,
    salesUnitNameAr: "كرتون",
    salesUnitNameEn: "Carton",
    thumbnailUrl: null,
    mediaCount: 0,
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    descriptionAr: null,
    descriptionEn: "Desc",
    taxonomyNodeId: NODE,
    salesUnitId: UNIT,
    weightPerUnit: "12.500",
    lengthCm: "30.00",
    widthCm: "20.00",
    heightCm: "15.00",
    packageContentQuantity: null,
    packageContentUnitNameAr: null,
    packageContentUnitNameEn: null,
    media: [],
  } satisfies ProductDetail;

  it("fills every field, mapping null to an empty input", () => {
    const values = productFormFromDetail(detail);

    expect(values.taxonomyNodeId).toBe(NODE);
    expect(values.salesUnitId).toBe(UNIT);
    expect(values.descriptionAr).toBe("");
    expect(values.descriptionEn).toBe("Desc");
    expect(values.packageContentQuantity).toBe("");
  });

  it("keeps decimals exactly as the API sent them", () => {
    // Reformatting `12.500` to `12.5` would make the field look edited
    // before anyone touched it, and the dirty check would then send a
    // value nobody changed.
    const values = productFormFromDetail(detail);

    expect(values.weightPerUnit).toBe("12.500");
    expect(values.lengthCm).toBe("30.00");
    expect(isDirty(values, values)).toBe(false);
    expect(toUpdateRequest(values, values)).toEqual({});
  });

  it("pre-selects the sales unit so the picker is not blank", () => {
    expect(productFormFromDetail(detail).salesUnitId).toBe(UNIT);
    expect(productFormFromDetail({ ...detail, salesUnitId: null }).salesUnitId).toBe("");
  });
});

describe("dirty tracking", () => {
  it("is false for an untouched form and true after any change", () => {
    expect(isDirty(FILLED, FILLED)).toBe(false);
    expect(isDirty({ ...FILLED, nameAr: "x" }, FILLED)).toBe(true);
  });

  it("ignores a whitespace-only difference", () => {
    expect(isDirty({ ...FILLED, nameAr: "  زيت زيتون  " }, FILLED)).toBe(false);
  });
});

// ----------------------------------------------------- technical checks

describe("failed checks map onto the form", () => {
  it("maps all eleven codes to a field or the media panel", () => {
    expect(PRODUCT_TECHNICAL_CHECK_CODES).toHaveLength(11);

    for (const code of PRODUCT_TECHNICAL_CHECK_CODES) {
      const target = checkTarget(code);
      if (target.kind === "field") {
        expect([code, PRODUCT_FIELD_ORDER.includes(target.field)]).toEqual([code, true]);
      } else {
        expect([code, target.kind]).toEqual([code, "media"]);
      }
    }
  });

  it("routes MAIN_IMAGE_REQUIRED to the image panel, not a field", () => {
    // Its fix is not typing, so focusing an input would silently do
    // nothing.
    expect(checkTarget("MAIN_IMAGE_REQUIRED")).toEqual({ kind: "media" });
  });

  it("orders codes by where their target appears on the page", () => {
    expect(orderChecks(["MAIN_IMAGE_REQUIRED", "HEIGHT_NOT_POSITIVE", "NAME_AR_REQUIRED"])).toEqual([
      "NAME_AR_REQUIRED",
      "HEIGHT_NOT_POSITIVE",
      // The image panel sits below every field.
      "MAIN_IMAGE_REQUIRED",
    ]);
  });

  it("focuses the first target, and nothing when there are none", () => {
    expect(firstCheckTarget(["MAIN_IMAGE_REQUIRED", "NAME_EN_REQUIRED"])).toEqual({
      kind: "field",
      field: "nameEn",
    });
    expect(firstCheckTarget([])).toBeNull();
  });

  it("has a translation for every code in both locales", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const read = (file: string) =>
      JSON.parse(readFileSync(join(__dirname, "..", "messages", file), "utf8"));

    for (const locale of ["ar-SA.json", "en-SA.json"]) {
      const checks = read(locale).supplier.products.checks;
      expect(Object.keys(checks).sort()).toEqual([...PRODUCT_TECHNICAL_CHECK_CODES].sort());
    }
  });
});
