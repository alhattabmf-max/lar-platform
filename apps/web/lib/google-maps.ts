/**
 * THE GOOGLE MAPS SCRIPT, LOADED ONCE.
 *
 * WHY THIS IS HAND-ROLLED. It is a script tag and a promise, and this
 * application keeps its dependency list to what it genuinely cannot
 * write — a loader package would be a version to track for twenty
 * lines of work.
 *
 * LOADED ONCE PER PAGE, not once per picker. Google's script defines
 * globals and throws if it is included twice, so the promise is cached
 * at module scope: every caller after the first awaits the same load.
 *
 * WHAT IT NEEDS FROM THE OPERATOR — none of which this repository can
 * supply, because all of it belongs to the owner's Google Cloud
 * account:
 *
 *   1. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in the web app's environment.
 *      It is PUBLIC by necessity — a browser map key is visible in the
 *      page — which is why point 3 matters.
 *   2. The **Maps JavaScript API** and the **Geocoding API** enabled on
 *      that key's project, with billing attached. Places is NOT needed:
 *      the search box below uses the Geocoder, which is part of core
 *      Maps, so there is one less API to enable and one less
 *      deprecation to track.
 *   3. An **HTTP referrer restriction** on the key, limited to the
 *      platform's own domains. Without it a public key can be used by
 *      anyone, on the owner's bill.
 *
 * WITHOUT A KEY the picker falls back to the OpenStreetMap map rather
 * than showing a broken box — see `location-picker.tsx`.
 */

export const GOOGLE_MAPS_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export const hasGoogleMapsKey = GOOGLE_MAPS_KEY !== "";

/** The one in-flight or settled load for this page. */
let pending: Promise<void> | null = null;

/**
 * Resolves once `window.google.maps` is usable.
 *
 * REJECTS RATHER THAN HANGS. A blocked script, a bad key or an
 * offline browser must produce an error the picker can show, not a
 * spinner that never stops.
 */
export function loadGoogleMaps(language: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("google-maps: browser only"));
  }
  if (!hasGoogleMapsKey) {
    return Promise.reject(new Error("google-maps: no API key configured"));
  }
  const existing = (window as unknown as { google?: { maps?: unknown } }).google;
  if (existing?.maps) return Promise.resolve();
  if (pending) return pending;

  pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: GOOGLE_MAPS_KEY,
      // `marker` carries the advanced marker; `geocoding` is what the
      // search box uses instead of Places.
      libraries: "marker,geocoding",
      // Arabic or English, matching whichever the reader chose.
      language,
      // Place names, road names and the map's own labels follow Saudi
      // Arabia rather than the browser's guess at a country.
      region: "SA",
      loading: "async",
      v: "weekly",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Cleared so a later attempt can retry rather than await a
      // promise that will never settle again.
      pending = null;
      reject(new Error("google-maps: script failed to load"));
    };
    document.head.appendChild(script);
  });

  return pending;
}
