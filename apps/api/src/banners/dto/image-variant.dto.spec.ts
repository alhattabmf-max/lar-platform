import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { ImageVariant, ImageVariantQueryDto, wantsThumbnail } from "./image-variant.dto";

/**
 * Exercises the DTO exactly as the global ValidationPipe does
 * (`whitelist`, `forbidNonWhitelisted`, `transform` are configured in
 * configure-app.ts), so a rejection here is the same rejection the HTTP
 * layer produces — a 400.
 */
function validateQuery(raw: unknown) {
  // Mirrors configure-app.ts exactly: { whitelist, transform,
  // forbidNonWhitelisted }. `enableImplicitConversion` is deliberately
  // NOT set there, and setting it here would test a more permissive
  // pipeline than the one that actually runs — it coerces objects to
  // strings, which would mask a rejection production does perform.
  const instance = plainToInstance(ImageVariantQueryDto, raw);
  return {
    instance,
    errors: validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }),
  };
}

describe("accepted values", () => {
  it("defaults to main when omitted", () => {
    const { instance, errors } = validateQuery({});

    expect(errors).toHaveLength(0);
    expect(instance.variant).toBeUndefined();
    expect(wantsThumbnail(instance)).toBe(false);
  });

  it("accepts main", () => {
    const { instance, errors } = validateQuery({ variant: "main" });

    expect(errors).toHaveLength(0);
    expect(instance.variant).toBe(ImageVariant.main);
    expect(wantsThumbnail(instance)).toBe(false);
  });

  it("accepts thumb", () => {
    const { instance, errors } = validateQuery({ variant: "thumb" });

    expect(errors).toHaveLength(0);
    expect(instance.variant).toBe(ImageVariant.thumb);
    expect(wantsThumbnail(instance)).toBe(true);
  });
});

describe("rejected values", () => {
  it.each([
    ["unknown word", "huge"],
    ["empty string", ""],
    ["wrong case", "Main"],
    ["wrong case thumb", "THUMB"],
    ["whitespace padded", " thumb "],
    ["numeric", "1"],
    ["path traversal attempt", "../main"],
    ["object key attempt", "banners/b1/main.jpg"],
    ["null string", "null"],
  ])("rejects %s rather than falling back to main", (_label, variant) => {
    const { errors } = validateQuery({ variant });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints?.isEnum).toContain('"main" or "thumb"');
  });

  it("rejects a repeated query parameter, which arrives as an array", () => {
    // ?variant=main&variant=thumb
    const { errors } = validateQuery({ variant: ["main", "thumb"] });

    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects an array even when every member is individually valid", () => {
    expect(validateQuery({ variant: ["main"] }).errors.length).toBeGreaterThan(0);
    expect(validateQuery({ variant: ["thumb", "thumb"] }).errors.length).toBeGreaterThan(0);
  });

  it("rejects a nested object, which qs produces for ?variant[x]=main", () => {
    expect(validateQuery({ variant: { x: "main" } }).errors.length).toBeGreaterThan(0);
  });

  it("rejects an unknown sibling property under forbidNonWhitelisted", () => {
    const { errors } = validateQuery({ variant: "main", objectKey: "banners/b1/main.jpg" });

    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("wantsThumbnail", () => {
  it("treats only an explicit thumb as the thumbnail", () => {
    expect(wantsThumbnail({ variant: ImageVariant.thumb })).toBe(true);
    expect(wantsThumbnail({ variant: ImageVariant.main })).toBe(false);
    expect(wantsThumbnail({})).toBe(false);
  });
});
