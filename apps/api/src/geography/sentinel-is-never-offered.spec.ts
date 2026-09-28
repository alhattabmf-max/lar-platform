import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SENTINEL_CITY_ID, SENTINEL_REGION_ID } from "./sentinel.constants";

/**
 * The Sentinel is never offered to anybody.
 *
 * WHAT IT IS. A single inactive region and city, both at the fixed id
 * `00000000-0000-0000-0000-000000000000` and both named «غير محدد».
 * They exist because `company_locations.city_id` was once NOT NULL and
 * rows that predated cities needed a value.
 *
 * WHY THEY ARE STILL HERE. `city_id` is nullable now, so nothing needs
 * them — but historical records may still point at them, and reference
 * data this platform once wrote is not something a screen change
 * removes. They are hidden, not deleted.
 *
 * FOUR LISTS AND FOUR GUARDS. Being inactive is not enough on its own:
 * an operator could switch one on from the console by accident, and
 * «غير محدد» would appear in every picker on the platform. Every list
 * excludes it BY ID, which no toggle can undo.
 */

const HERE = __dirname;
const read = (file: string) => readFileSync(join(HERE, file), "utf8");

describe("the Sentinel ids are the ones the migration seeded", () => {
  it("is the all-zero uuid, for both", () => {
    expect(SENTINEL_CITY_ID).toBe("00000000-0000-0000-0000-000000000000");
    expect(SENTINEL_REGION_ID).toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("every list excludes it by id, not by its inactive flag", () => {
  const CITIES = read("cities.service.ts");
  const REGIONS = read("regions.service.ts");

  it("the public city list", () => {
    // `listActive` already filters on isActive; the id filter is what
    // survives somebody switching it on.
    expect(CITIES).toContain("id: { not: SENTINEL_CITY_ID }");
  });

  it("the console's city list", () => {
    // `listAll` does NOT filter on isActive — it is the screen that
    // shows inactive rows — so the id filter is the only thing keeping
    // the Sentinel off it.
    expect(CITIES).toContain("where: { id: { not: SENTINEL_CITY_ID } }");
  });

  it("the public region list", () => {
    expect(REGIONS).toContain("id: { not: SENTINEL_REGION_ID }");
  });

  it("the console's region list", () => {
    expect(REGIONS).toContain("where: { id: { not: SENTINEL_REGION_ID } }");
  });

  it("both files reference the shared constants rather than the literal", () => {
    // A hand-typed all-zero uuid in one of these is how the two drift.
    const literal = "00000000-0000-0000-0000-000000000000";
    expect(CITIES).not.toContain(literal);
    expect(REGIONS).not.toContain(literal);
  });
});

describe("no branch may be recorded against it", () => {
  const SELF_SERVE = readFileSync(
    join(HERE, "..", "companies", "companies.service.ts"),
    "utf8",
  );
  const CONSOLE = readFileSync(
    join(HERE, "..", "admin", "companies", "company-branch.service.ts"),
    "utf8",
  );

  it.each([
    ["the company's own form", () => SELF_SERVE],
    ["the console", () => CONSOLE],
  ])("%s refuses the Sentinel region", (_label, source) => {
    expect(source()).toContain("SENTINEL_REGION_ID");
  });

  it.each([
    ["the company's own form", () => SELF_SERVE],
    ["the console", () => CONSOLE],
  ])("%s refuses the Sentinel city", (_label, source) => {
    expect(source()).toContain("SENTINEL_CITY_ID");
  });
});
