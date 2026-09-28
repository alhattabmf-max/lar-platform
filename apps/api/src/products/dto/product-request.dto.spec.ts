import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  CLEARABLE_PRODUCT_FIELDS,
  CREATE_PRODUCT_REQUEST_KEYS,
  CREATE_PRODUCT_REQUIRED_KEYS,
  PACKAGE_CONTENT_GROUP,
  PRODUCT_DECIMAL_FIELDS,
  PRODUCT_TEXT_LIMITS,
  UPDATE_PRODUCT_REQUEST_KEYS,
  type CreateProductRequest,
} from "@platform/types";
import { CreateProductDto } from "./create-product.dto";
import { UpdateProductDto } from "./update-product.dto";

/**
 * The request DTOs, against the shared contracts a form validates on.
 *
 * Before 8E.5a the request shape existed only as decorators here, so a
 * client had to re-type every bound — and `@IsNumber() @IsPositive()` was
 * the whole numeric rule, which accepted `10.0005` for a `Decimal(10,3)`
 * column and `1e21` for a column that tops out at 9,999,999.999.
 */

const NODE = "11111111-1111-4111-8111-111111111111";
const UNIT = "22222222-2222-4222-8222-222222222222";

const VALID_CREATE: CreateProductRequest = {
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
};

function errorsFor(
  cls: typeof CreateProductDto | typeof UpdateProductDto,
  body: Record<string, unknown>,
  field?: string
) {
  const found = validateSync(plainToInstance(cls, body) as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return field ? found.filter((e) => e.property === field) : found;
}

const createField = (field: string, value: unknown) =>
  errorsFor(CreateProductDto, { ...VALID_CREATE, [field]: value }, field);

const updateField = (field: string, value: unknown) =>
  errorsFor(UpdateProductDto, { [field]: value }, field);

// ------------------------------------------------- contract agreement

describe("the DTOs and the shared request contracts agree", () => {
  const declared = (cls: object) =>
    Object.keys(plainToInstance(cls as never, {
      ...VALID_CREATE,
      packageContentQuantity: 6,
      packageContentUnitNameAr: "علبة",
      packageContentUnitNameEn: "Box",
    }) as object);

  it("declares exactly the create contract's keys", () => {
    expect(declared(CreateProductDto).sort()).toEqual([...CREATE_PRODUCT_REQUEST_KEYS].sort());
  });

  it("declares exactly the update contract's keys", () => {
    expect(declared(UpdateProductDto).sort()).toEqual([...UPDATE_PRODUCT_REQUEST_KEYS].sort());
  });

  it("rejects any property outside the contract", () => {
    // `forbidNonWhitelisted` is global, so an unknown field is a 400
    // rather than a silently dropped one — a form that posts a stray key
    // fails loudly instead of appearing to save it.
    expect(
      errorsFor(CreateProductDto, { ...VALID_CREATE, sku: "ABC-123" }).length
    ).toBeGreaterThan(0);
    expect(errorsFor(UpdateProductDto, { attributes: {} }).length).toBeGreaterThan(0);
  });

  it("accepts supplier identifiers but rejects an invalid GTIN check digit", () => {
    expect(errorsFor(CreateProductDto, { ...VALID_CREATE, supplierSku: "SUP-001", gtin: "12345670" })).toHaveLength(0);
    expect(errorsFor(CreateProductDto, { ...VALID_CREATE, gtin: "12345671" }).length).toBeGreaterThan(0);
    expect(errorsFor(UpdateProductDto, { gtin: null })).toHaveLength(0);
  });

  it("requires every field the contract marks required", () => {
    for (const field of CREATE_PRODUCT_REQUIRED_KEYS) {
      const body = { ...VALID_CREATE } as Record<string, unknown>;
      delete body[field];
      expect([field, errorsFor(CreateProductDto, body, field).length > 0]).toEqual([field, true]);
    }
  });

  it("makes every update field optional", () => {
    expect(errorsFor(UpdateProductDto, {})).toHaveLength(0);
  });

  it("accepts a fully valid create", () => {
    expect(errorsFor(CreateProductDto, VALID_CREATE as never)).toHaveLength(0);
  });
});

// ------------------------------------------------------------- decimals

describe("numeric fields are bounded to their column", () => {
  const NUMERIC = Object.keys(PRODUCT_DECIMAL_FIELDS) as (keyof typeof PRODUCT_DECIMAL_FIELDS)[];

  it.each(NUMERIC)("%s accepts a value at its exact maximum", (field) => {
    const { max } = PRODUCT_DECIMAL_FIELDS[field];
    expect(updateField(field, max)).toHaveLength(0);
  });

  it.each(NUMERIC)("%s refuses one step above its maximum", (field) => {
    const { max, scale } = PRODUCT_DECIMAL_FIELDS[field];
    const step = 10 ** -scale;
    expect(updateField(field, Number((max + step).toFixed(scale))).length).toBeGreaterThan(0);
  });

  it.each(NUMERIC)("%s refuses more decimals than the column holds", (field) => {
    const { scale } = PRODUCT_DECIMAL_FIELDS[field];
    const tooPrecise = Number(`1.${"0".repeat(scale)}5`);
    expect(updateField(field, tooPrecise).length).toBeGreaterThan(0);
  });

  it.each(NUMERIC)("%s accepts exactly its scale", (field) => {
    const { scale } = PRODUCT_DECIMAL_FIELDS[field];
    expect(updateField(field, Number(`1.${"1".repeat(scale)}`))).toHaveLength(0);
  });

  it.each(NUMERIC)("%s refuses NaN, Infinity, scientific notation and negatives", (field) => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e21, -1, 0]) {
      expect([field, bad, updateField(field, bad).length > 0]).toEqual([field, bad, true]);
    }
  });

  it.each(NUMERIC)("%s refuses a quoted number", (field) => {
    expect(updateField(field, "12.5").length).toBeGreaterThan(0);
  });

  it("uses the same bounds on create and update, from one definition", () => {
    for (const field of NUMERIC) {
      const { scale } = PRODUCT_DECIMAL_FIELDS[field];
      const tooPrecise = Number(`1.${"0".repeat(scale)}5`);
      expect([field, createField(field, tooPrecise).length > 0]).toEqual([field, true]);
      expect([field, updateField(field, tooPrecise).length > 0]).toEqual([field, true]);
    }
  });

  it("pins the maxima to the real column definitions", () => {
    expect(PRODUCT_DECIMAL_FIELDS.weightPerUnit).toEqual({ scale: 3, max: 9_999_999.999 });
    expect(PRODUCT_DECIMAL_FIELDS.packageContentQuantity).toEqual({ scale: 3, max: 9_999_999.999 });
    expect(PRODUCT_DECIMAL_FIELDS.lengthCm).toEqual({ scale: 2, max: 99_999_999.99 });
  });
});

// ---------------------------------------------------------------- text

describe("text fields are bounded and never silently trimmed to fit", () => {
  const TEXT = Object.keys(PRODUCT_TEXT_LIMITS) as (keyof typeof PRODUCT_TEXT_LIMITS)[];

  it.each(TEXT)("%s accepts a value at its exact limit", (field) => {
    expect(updateField(field, "a".repeat(PRODUCT_TEXT_LIMITS[field]))).toHaveLength(0);
  });

  it.each(TEXT)("%s refuses one character over", (field) => {
    // Rejected, not truncated: storing a name the supplier did not write
    // and showing it back as if they had is worse than refusing it.
    expect(updateField(field, "a".repeat(PRODUCT_TEXT_LIMITS[field] + 1)).length).toBeGreaterThan(0);
  });

  it("refuses empty and whitespace-only values for required text", () => {
    for (const field of ["nameAr", "nameEn", "salesUnitNameAr", "salesUnitNameEn"]) {
      for (const blank of ["", "   ", "\t\n"]) {
        expect([field, blank, updateField(field, blank).length > 0]).toEqual([field, blank, true]);
      }
    }
  });

  it("trims before measuring, and stores the trimmed value", () => {
    const instance = plainToInstance(CreateProductDto, {
      ...VALID_CREATE,
      nameAr: "  زيت زيتون  ",
    });

    expect(validateSync(instance as object)).toHaveLength(0);
    expect((instance as CreateProductDto).nameAr).toBe("زيت زيتون");
  });

  it("allows an empty description, which is a real value", () => {
    // Descriptions carry no MinLength — "" is a legitimate description.
    expect(updateField("descriptionAr", "")).toHaveLength(0);
  });

  it("pins the agreed limits", () => {
    expect(PRODUCT_TEXT_LIMITS).toEqual({
      nameAr: 200,
      nameEn: 200,
      descriptionAr: 5000,
      descriptionEn: 5000,
      salesUnitNameAr: 100,
      salesUnitNameEn: 100,
      packageContentUnitNameAr: 100,
      packageContentUnitNameEn: 100,
    });
  });
});

// ------------------------------------------------ clear vs omit vs set

describe("update distinguishes omitted, set and cleared", () => {
  it("accepts null on every clearable field", () => {
    for (const field of CLEARABLE_PRODUCT_FIELDS) {
      expect([field, updateField(field, null)]).toEqual([field, []]);
    }
  });

  it("refuses null on every field that is NOT clearable", () => {
    // `@IsOptional()` would have accepted these — and Prisma would then
    // try to write null into a NOT NULL column and fail as a 500.
    const clearable = new Set<string>(CLEARABLE_PRODUCT_FIELDS);
    const notClearable = UPDATE_PRODUCT_REQUEST_KEYS.filter((k) => !clearable.has(k));

    expect(notClearable.length).toBeGreaterThan(0);
    for (const field of notClearable) {
      expect([field, updateField(field, null).length > 0]).toEqual([field, true]);
    }
  });

  it("leaves an omitted field undefined, never null", () => {
    // This is the distinction Prisma acts on: `undefined` means "leave
    // the column alone", `null` means "set it to null". class-transformer
    // materialises every declared property, so the key may exist — what
    // must never happen is an omitted field arriving as null.
    const instance = plainToInstance(UpdateProductDto, { nameAr: "جديد" });

    expect(instance.nameAr).toBe("جديد");
    expect(instance.descriptionAr).toBeUndefined();
    expect(instance.descriptionAr).not.toBeNull();
    expect(instance.packageContentQuantity).toBeUndefined();
  });

  it("keeps an explicit null on the instance, so Prisma can write it", () => {
    const instance = plainToInstance(UpdateProductDto, { descriptionAr: null }) as Record<
      string,
      unknown
    >;

    expect("descriptionAr" in instance).toBe(true);
    expect(instance.descriptionAr).toBeNull();
  });

  it("still validates a clearable field when a VALUE is sent", () => {
    expect(updateField("descriptionAr", "a".repeat(5001)).length).toBeGreaterThan(0);
    expect(updateField("packageContentQuantity", 1.0005).length).toBeGreaterThan(0);
    expect(updateField("salesUnitId", "not-a-uuid").length).toBeGreaterThan(0);
  });

  it("does not offer clearing on create", () => {
    // There is nothing to clear on a row that does not exist yet, and the
    // contract says so.
    const create = plainToInstance(CreateProductDto, VALID_CREATE);
    expect(create.descriptionAr).toBe("وصف");
  });
});

describe("the package-content group is set together and cleared together", () => {
  it("names the same three fields as the contract", () => {
    expect([...PACKAGE_CONTENT_GROUP]).toEqual([
      "packageContentQuantity",
      "packageContentUnitNameAr",
      "packageContentUnitNameEn",
    ]);
  });

  it("accepts all three as values", () => {
    expect(
      errorsFor(UpdateProductDto, {
        packageContentQuantity: 6,
        packageContentUnitNameAr: "علبة",
        packageContentUnitNameEn: "Box",
      })
    ).toHaveLength(0);
  });

  it("accepts all three as null — the DTO's job is shape, not the invariant", () => {
    // The all-or-nothing rule needs the row's current state, so it lives
    // in the service. The DTO only proves null is a legal shape here.
    expect(
      errorsFor(UpdateProductDto, {
        packageContentQuantity: null,
        packageContentUnitNameAr: null,
        packageContentUnitNameEn: null,
      })
    ).toHaveLength(0);
  });
});
