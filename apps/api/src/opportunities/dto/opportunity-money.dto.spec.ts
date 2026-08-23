import "reflect-metadata";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  MONEY_COLUMN_MAX,
  MONEY_COLUMN_SCALE,
} from "../../common/validation/is-money-amount.decorator";
import { CreateOpportunityDto } from "./create-opportunity.dto";
import { UpdateOpportunityDto } from "./update-opportunity.dto";

/**
 * What a money field in a request body is allowed to be.
 *
 * The column is `Decimal(12,2)`. Before the Financial Precision Delta the
 * DTO said only `@IsNumber() @IsPositive()`, so `115.155` and `1e21` both
 * passed validation and reached the tax computation — one to be silently
 * rounded by the column, the other to overflow it.
 */

const VALID_CREATE = {
  productId: "11111111-1111-4111-8111-111111111111",
  fulfillmentLocationId: "22222222-2222-4222-8222-222222222222",
  targetQuantity: 100,
  unitPriceAmount: 115.15,
  startAt: "2026-09-01T00:00:00.000Z",
  endAt: "2026-09-20T00:00:00.000Z",
  expectedPreparationDays: 3,
};

function priceErrors(dto: object, cls: typeof CreateOpportunityDto | typeof UpdateOpportunityDto) {
  const instance = plainToInstance(cls, dto);
  return validateSync(instance as object).filter((e) => e.property === "unitPriceAmount");
}

const createWith = (unitPriceAmount: unknown) =>
  priceErrors({ ...VALID_CREATE, unitPriceAmount }, CreateOpportunityDto);

const updateWith = (unitPriceAmount: unknown) =>
  priceErrors({ unitPriceAmount }, UpdateOpportunityDto);

describe("a valid price is accepted", () => {
  it.each([0.01, 0.1, 0.2, 2.61, 115.15, 4.27, 1000, MONEY_COLUMN_MAX])("accepts %s", (price) => {
    expect(createWith(price)).toHaveLength(0);
    expect(updateWith(price)).toHaveLength(0);
  });

  it("accepts a whole number without a decimal part", () => {
    expect(createWith(15)).toHaveLength(0);
  });
});

describe("more precision than the column can hold is refused", () => {
  it.each([115.155, 0.001, 0.005, 1.234, 9.999])("refuses %s", (price) => {
    // Rounding it away silently would charge on a price the supplier
    // never entered.
    expect(createWith(price).length).toBeGreaterThan(0);
    expect(updateWith(price).length).toBeGreaterThan(0);
  });

  it("names the scale in its message", () => {
    const [error] = createWith(115.155);

    expect(JSON.stringify(error.constraints)).toContain(String(MONEY_COLUMN_SCALE));
  });
});

describe("out-of-range and non-finite values are refused", () => {
  it.each([
    ["above the column maximum", MONEY_COLUMN_MAX + 0.01],
    ["scientific notation", 1e21],
    ["a very large double", 1e30],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["zero", 0],
    ["negative", -1],
  ])("refuses %s", (_label, price) => {
    expect(createWith(price).length).toBeGreaterThan(0);
    expect(updateWith(price).length).toBeGreaterThan(0);
  });

  it("refuses a string, so a quoted number cannot slip past", () => {
    expect(createWith("115.15").length).toBeGreaterThan(0);
  });

  it("holds the maximum at exactly what Decimal(12,2) can store", () => {
    expect(MONEY_COLUMN_MAX).toBe(9_999_999_999.99);
  });
});

describe("create and update cannot drift", () => {
  it("applies the same decorator on both, from one definition", () => {
    // A copied rule is one that gets tightened on one side and forgotten
    // on the other, which would make edit a back door into the column.
    const create = readFileSync(join(__dirname, "create-opportunity.dto.ts"), "utf8");
    const update = readFileSync(join(__dirname, "update-opportunity.dto.ts"), "utf8");

    for (const source of [create, update]) {
      expect(source).toContain("@IsMoneyAmount()");
      expect(source).toContain("is-money-amount.decorator");
    }
  });

  it.each([115.155, 1e21, Number.NaN, -1, MONEY_COLUMN_MAX + 0.01])(
    "refuses %s on BOTH create and update",
    (price) => {
      expect(createWith(price).length).toBeGreaterThan(0);
      expect(updateWith(price).length).toBeGreaterThan(0);
    }
  );

  it("still lets update omit the price entirely", () => {
    expect(priceErrors({ descriptionEn: "x" }, UpdateOpportunityDto)).toHaveLength(0);
  });
});
