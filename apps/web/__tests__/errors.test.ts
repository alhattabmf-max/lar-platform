import { describe, expect, it } from "vitest";
import { ApiError, isApiError, kindForStatus, mapApiError, networkError } from "@/lib/errors";

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

describe("networkError", () => {
  it("is recognisable and carries no status", () => {
    const error = networkError(new TypeError("Failed to fetch"));

    expect(isApiError(error)).toBe(true);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("network");
    expect(error.status).toBe(0);
  });
});
