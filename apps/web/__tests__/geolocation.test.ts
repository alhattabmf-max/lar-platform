import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  GEOLOCATION_MESSAGE_KEY,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  RETRYABLE_FAILURES,
  hasUsableCoordinates,
  isGeolocationSupported,
  isSecureContextForGeolocation,
  parseManualCoordinates,
  requestCurrentPosition,
  type GeolocationFailure,
} from "@/lib/geolocation";

function stubGeolocation(impl: {
  getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback) => void;
}) {
  vi.stubGlobal("navigator", { geolocation: impl } as unknown as Navigator);
}

function secure(value: boolean) {
  vi.stubGlobal("window", { isSecureContext: value } as unknown as Window);
}

beforeEach(() => {
  secure(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("capability detection", () => {
  it("reports unsupported when the API is absent", () => {
    vi.stubGlobal("navigator", {} as Navigator);
    expect(isGeolocationSupported()).toBe(false);
  });

  it("reports supported when present", () => {
    stubGeolocation({ getCurrentPosition: () => {} });
    expect(isGeolocationSupported()).toBe(true);
  });

  it("treats a non-secure context as unusable", () => {
    secure(false);
    expect(isSecureContextForGeolocation()).toBe(false);
  });
});

describe("failure matrix", () => {
  it("returns UNSUPPORTED without calling anything", async () => {
    vi.stubGlobal("navigator", {} as Navigator);

    await expect(requestCurrentPosition()).resolves.toEqual({
      ok: false,
      failure: "UNSUPPORTED",
    });
  });

  it("returns INSECURE_CONTEXT before invoking the API", async () => {
    const getCurrentPosition = vi.fn();
    stubGeolocation({ getCurrentPosition });
    secure(false);

    await expect(requestCurrentPosition()).resolves.toEqual({
      ok: false,
      failure: "INSECURE_CONTEXT",
    });
    // Checked up front, because some browsers never invoke either
    // callback in an insecure context.
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it.each([
    [1, "PERMISSION_DENIED"],
    [2, "POSITION_UNAVAILABLE"],
    [3, "TIMEOUT"],
    [99, "UNKNOWN"],
  ])("maps PositionError code %i to %s", async (code, expected) => {
    stubGeolocation({
      getCurrentPosition: (_ok, fail) => fail({ code } as GeolocationPositionError),
    });

    await expect(requestCurrentPosition()).resolves.toEqual({ ok: false, failure: expected });
  });

  it("never rejects, whatever the browser does", async () => {
    stubGeolocation({
      getCurrentPosition: (_ok, fail) => fail({ code: 1 } as GeolocationPositionError),
    });

    await expect(requestCurrentPosition()).resolves.toBeDefined();
  });

  it("has a message key for every failure", () => {
    const failures: GeolocationFailure[] = [
      "UNSUPPORTED",
      "INSECURE_CONTEXT",
      "PERMISSION_DENIED",
      "POSITION_UNAVAILABLE",
      "TIMEOUT",
      "UNKNOWN",
    ];

    for (const failure of failures) {
      expect(GEOLOCATION_MESSAGE_KEY[failure]).toMatch(/^register\.location\.errors\./);
    }
  });

  it("does not offer retry for a denied permission", () => {
    // The browser will not re-prompt, so a retry button would produce
    // an instant identical refusal.
    expect(RETRYABLE_FAILURES.has("PERMISSION_DENIED")).toBe(false);
    expect(RETRYABLE_FAILURES.has("UNSUPPORTED")).toBe(false);
    expect(RETRYABLE_FAILURES.has("INSECURE_CONTEXT")).toBe(false);
    expect(RETRYABLE_FAILURES.has("TIMEOUT")).toBe(true);
    expect(RETRYABLE_FAILURES.has("POSITION_UNAVAILABLE")).toBe(true);
  });
});

describe("success", () => {
  it("returns the coordinates and the reported accuracy", async () => {
    stubGeolocation({
      getCurrentPosition: (ok) =>
        ok({
          coords: { latitude: 24.7136, longitude: 46.6753, accuracy: 12.5 },
        } as GeolocationPosition),
    });

    await expect(requestCurrentPosition()).resolves.toEqual({
      ok: true,
      coordinates: { latitude: 24.7136, longitude: 46.6753, accuracyMetres: 12.5 },
    });
  });

  it("nulls a non-finite accuracy rather than reporting a bogus figure", async () => {
    stubGeolocation({
      getCurrentPosition: (ok) =>
        ok({
          coords: { latitude: 24.7, longitude: 46.6, accuracy: Number.NaN },
        } as GeolocationPosition),
    });

    const result = await requestCurrentPosition();
    expect(result.ok && result.coordinates.accuracyMetres).toBeNull();
  });
});

describe("manual entry", () => {
  it("accepts valid coordinates", () => {
    expect(parseManualCoordinates("24.7136", "46.6753")).toEqual({
      latitude: 24.7136,
      longitude: 46.6753,
      accuracyMetres: null,
    });
  });

  it("reports no accuracy for typed values, rather than inventing one", () => {
    expect(parseManualCoordinates("0", "0")!.accuracyMetres).toBeNull();
  });

  it("accepts the exact bounds", () => {
    expect(parseManualCoordinates(String(LATITUDE_RANGE.min), String(LONGITUDE_RANGE.min))).not.toBeNull();
    expect(parseManualCoordinates(String(LATITUDE_RANGE.max), String(LONGITUDE_RANGE.max))).not.toBeNull();
  });

  it.each([
    ["latitude too high", "91", "0"],
    ["latitude too low", "-91", "0"],
    ["longitude too high", "0", "181"],
    ["longitude too low", "0", "-181"],
    ["empty latitude", "", "46"],
    ["empty longitude", "24", ""],
    ["both empty", "", ""],
    ["not a number", "abc", "46"],
    ["infinity", "Infinity", "46"],
    ["NaN", "NaN", "46"],
  ])("rejects %s", (_label, lat, lng) => {
    expect(parseManualCoordinates(lat, lng)).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseManualCoordinates("  24.7  ", "  46.6  ")).not.toBeNull();
  });
});

describe("the submission gate", () => {
  it("is false without coordinates, true with them", () => {
    expect(hasUsableCoordinates(null)).toBe(false);
    expect(hasUsableCoordinates({ latitude: 0, longitude: 0, accuracyMetres: null })).toBe(true);
  });

  it("offers no default or sentinel pair anywhere in the module", async () => {
    // A fabricated position would never be corrected downstream:
    // MAP_PROVIDER_MODE=manual means the server resolves nothing.
    const source = await import("@/lib/geolocation");
    const exported = Object.keys(source);

    expect(exported).not.toContain("DEFAULT_COORDINATES");
    expect(exported).not.toContain("SENTINEL_COORDINATES");
    expect(exported).not.toContain("FALLBACK_COORDINATES");
  });
});
