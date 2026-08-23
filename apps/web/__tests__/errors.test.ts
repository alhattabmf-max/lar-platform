import { describe, expect, it } from "vitest";
import { ApiError, isApiError, kindForStatus, mapApiError, networkError } from "@/lib/errors";
import { toUserFacingError } from "@/lib/error-messages";

describe("kindForStatus", () => {
  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "notFound"],
    [409, "conflict"],
    [422, "validation"],
    [400, "validation"],
    [429, "rateLimited"],
    [500, "server"],
    [502, "server"],
    [418, "unknown"],
  ])("%i -> %s", (status, expected) => {
    expect(kindForStatus(status)).toBe(expected);
  });
});

describe("mapApiError", () => {
  it("prefers the envelope code over the status-derived fallback", () => {
    const error = mapApiError(403, {
      error: { code: "SUPPLIER_NOT_VERIFIED", message: "x" },
      requestId: "req-1",
      timestamp: "t",
    });

    expect(error.code).toBe("SUPPLIER_NOT_VERIFIED");
    expect(error.kind).toBe("forbidden");
  });

  it("falls back to the header request id when the body has none", () => {
    const error = mapApiError(500, null, "req-header");

    expect(error.requestId).toBe("req-header");
    expect(error.code).toBe("INTERNAL_ERROR");
  });

  it("tolerates a malformed body without throwing while handling an error", () => {
    for (const body of [null, undefined, "text", 42, [], { error: "not an object" }]) {
      expect(() => mapApiError(500, body)).not.toThrow();
    }
  });

  it("never surfaces envelope details on the error object", () => {
    const error = mapApiError(422, {
      error: { code: "VALIDATION_FAILED", message: "x", details: { path: "INTERNAL_PATH" } },
      requestId: "req-2",
      timestamp: "t",
    });

    expect(JSON.stringify({ ...error })).not.toContain("INTERNAL_PATH");
    expect(error).not.toHaveProperty("details");
  });

  it("builds a stable translation key from the code", () => {
    expect(mapApiError(404, null).translationKey).toBe("errors.codes.NOT_FOUND");
  });
});

describe("failedChecks — the one narrow door into details", () => {
  const envelope = (details: unknown, code = "PRODUCT_TECHNICAL_CHECK_FAILED") => ({
    error: { code, message: "Product cannot be auto-approved yet", details },
    requestId: "req-9",
    timestamp: "t",
  });

  it("reads the codes when the code and the shape both match", () => {
    const error = mapApiError(
      400,
      envelope({ failedChecks: ["NAME_AR_REQUIRED", "MAIN_IMAGE_REQUIRED"] })
    );

    expect(error.failedChecks).toEqual(["NAME_AR_REQUIRED", "MAIN_IMAGE_REQUIRED"]);
  });

  it.each([
    ["a different error code", envelope({ failedChecks: ["NAME_AR_REQUIRED"] }, "VALIDATION_FAILED")],
    ["details as a string", envelope("boom")],
    ["failedChecks as an object", envelope({ failedChecks: { a: 1 } })],
    ["an empty array", envelope({ failedChecks: [] })],
    ["one unrecognised code", envelope({ failedChecks: ["NAME_AR_REQUIRED", "MADE_UP"] })],
    ["a raw English sentence", envelope({ failedChecks: ["nameAr is required"] })],
    ["no details", { error: { code: "PRODUCT_TECHNICAL_CHECK_FAILED", message: "x" }, requestId: "r" }],
  ])("stays null for %s", (_label, body) => {
    expect(mapApiError(400, body).failedChecks).toBeNull();
  });

  it("exposes nothing else from details, even alongside valid codes", () => {
    // The sibling key is not read, and `details` itself is still absent
    // from the error object entirely.
    const error = mapApiError(
      400,
      envelope({ failedChecks: ["NAME_AR_REQUIRED"], internalPath: "/srv/app/products.ts" })
    );

    expect(error.failedChecks).toEqual(["NAME_AR_REQUIRED"]);
    expect(error).not.toHaveProperty("details");
    expect(JSON.stringify({ ...error })).not.toContain("/srv/app");
  });

  it("still renders through the closed message map, not the API's text", () => {
    const error = mapApiError(400, envelope({ failedChecks: ["NAME_AR_REQUIRED"] }));

    expect(error.translationKey).toBe("errors.codes.PRODUCT_TECHNICAL_CHECK_FAILED");
    expect(toUserFacingError(error).messageKey).toBe(
      "errors.codes.PRODUCT_TECHNICAL_CHECK_FAILED"
    );
    // The developer-facing English never becomes the user's message.
    expect(toUserFacingError(error)).not.toHaveProperty("message");
  });
});

describe("networkError", () => {
  it("is recognisable and carries no status", () => {
    const error = networkError(new TypeError("Failed to fetch"));

    expect(isApiError(error)).toBe(true);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("network");
    expect(error.status).toBe(0);
  });
});
