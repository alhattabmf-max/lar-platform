"use client";

/**
 * Browser geolocation for registration.
 *
 * Coordinates feed fulfilment logistics, so a plausible-but-wrong value
 * is worse than no value. There is deliberately NO sentinel, NO city
 * centroid, and NO default pair anywhere in this module: if the browser
 * cannot supply a position and the user does not type one, registration
 * simply cannot be submitted.
 *
 * `MAP_PROVIDER_MODE=manual` means the server performs no coordinate
 * resolution either — nothing downstream would correct a fabricated
 * value, which is precisely why none is offered.
 */

export type GeolocationFailure =
  /** The browser has no Geolocation API at all. */
  | "UNSUPPORTED"
  /** Not a secure context. Browsers block geolocation outside https (localhost excepted). */
  | "INSECURE_CONTEXT"
  /** The user or the browser refused. The site cannot re-prompt. */
  | "PERMISSION_DENIED"
  /** The device could not determine a position. */
  | "POSITION_UNAVAILABLE"
  /** The attempt exceeded its time budget. */
  | "TIMEOUT"
  | "UNKNOWN";

export interface Coordinates {
  latitude: number;
  longitude: number;
  /** Reported accuracy in metres, so the user can judge the fix. */
  accuracyMetres: number | null;
}

export type GeolocationResult =
  | { ok: true; coordinates: Coordinates }
  | { ok: false; failure: GeolocationFailure };

const TIMEOUT_MS = 10_000;

/** i18n key for each failure. Exhaustive by construction. */
export const GEOLOCATION_MESSAGE_KEY: Record<GeolocationFailure, string> = {
  UNSUPPORTED: "register.location.errors.unsupported",
  INSECURE_CONTEXT: "register.location.errors.insecureContext",
  PERMISSION_DENIED: "register.location.errors.permissionDenied",
  POSITION_UNAVAILABLE: "register.location.errors.positionUnavailable",
  TIMEOUT: "register.location.errors.timeout",
  UNKNOWN: "register.location.errors.unknown",
};

/**
 * Failures that are worth another try. A denied permission is not:
 * the browser will not re-prompt, so offering "retry" would produce an
 * instant identical refusal and read as a broken button.
 */
export const RETRYABLE_FAILURES: ReadonlySet<GeolocationFailure> = new Set([
  "POSITION_UNAVAILABLE",
  "TIMEOUT",
  "UNKNOWN",
]);

export function isGeolocationSupported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export function isSecureContextForGeolocation(): boolean {
  if (typeof window === "undefined") return false;
  // `isSecureContext` already treats localhost as secure, which is what
  // makes local development work over plain http.
  return window.isSecureContext === true;
}

function classify(error: GeolocationPositionError): GeolocationFailure {
  switch (error.code) {
    case 1:
      return "PERMISSION_DENIED";
    case 2:
      return "POSITION_UNAVAILABLE";
    case 3:
      return "TIMEOUT";
    default:
      return "UNKNOWN";
  }
}

/**
 * Requests the current position.
 *
 * Never rejects — every outcome is a value, so a caller cannot forget
 * to handle a failure mode and leave the form in a spinner.
 */
export async function requestCurrentPosition(): Promise<GeolocationResult> {
  if (!isGeolocationSupported()) {
    return { ok: false, failure: "UNSUPPORTED" };
  }
  if (!isSecureContextForGeolocation()) {
    // Checked before calling, because in an insecure context some
    // browsers reject silently and others never invoke either callback.
    return { ok: false, failure: "INSECURE_CONTEXT" };
  }

  return new Promise<GeolocationResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          ok: true,
          coordinates: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMetres: Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : null,
          },
        }),
      (error) => resolve({ ok: false, failure: classify(error) }),
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 0 }
    );
  });
}

export const LATITUDE_RANGE = { min: -90, max: 90 } as const;
export const LONGITUDE_RANGE = { min: -180, max: 180 } as const;

/**
 * Validates manually entered coordinates.
 *
 * Mirrors the server's `@IsLatitude()` / `@IsLongitude()`, which remain
 * the authority — this exists so the user sees the problem before
 * submitting, not so the server can trust the client.
 */
export function parseManualCoordinates(
  latitudeRaw: string,
  longitudeRaw: string
): Coordinates | null {
  const latitude = Number(latitudeRaw.trim());
  const longitude = Number(longitudeRaw.trim());

  if (latitudeRaw.trim() === "" || longitudeRaw.trim() === "") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < LATITUDE_RANGE.min || latitude > LATITUDE_RANGE.max) return null;
  if (longitude < LONGITUDE_RANGE.min || longitude > LONGITUDE_RANGE.max) return null;

  // Manually typed values carry no accuracy figure, and inventing one
  // would misrepresent how the position was obtained.
  return { latitude, longitude, accuracyMetres: null };
}

/** The only gate on submission: real coordinates, from either path. */
export function hasUsableCoordinates(value: Coordinates | null): value is Coordinates {
  return value !== null;
}
