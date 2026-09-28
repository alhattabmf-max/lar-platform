"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Crosshair, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hasGoogleMapsKey } from "@/lib/google-maps";
import { GoogleLocationPicker } from "./google-location-picker";
// Leaflet's own stylesheet, from the package rather than a CDN — the
// tile panes and controls have no size without it and the map renders
// as a stack of misplaced images.
import "leaflet/dist/leaflet.css";

/**
 * WHERE A BRANCH IS, chosen on a map.
 *
 * WHAT THIS REPLACES. The position used to be a pasted Google Maps
 * link, which the server followed and read. That worked, but it asked
 * a person to leave the platform, find their branch in another app,
 * press share, come back and paste — and it failed in ways nobody
 * could see coming: a shortened link that had expired, a link to a
 * search rather than a place, a link copied from a phone that carried
 * no coordinates at all. Here the person sees the map, drags the pin
 * onto their own gate, and presses confirm.
 *
 * WHAT IS SAVED is the pair of numbers under the pin — the same two
 * columns the link used to be turned into. Nothing about the branch's
 * shape changed; only how a person answers the question.
 *
 * NO KEY, NO ACCOUNT, NO BILL. Leaflet is MIT and the tiles are
 * OpenStreetMap's, so nothing here needs a contract with a map vendor.
 * That is also its one limit, recorded honestly: OSM's public tile
 * service is a volunteer-funded courtesy with a usage policy, and a
 * platform at real traffic should move to its own tile source. The
 * only thing that would change is the URL on line `TILE_URL`.
 *
 * LEAFLET IS LOADED IN THE BROWSER, never on the server: it reaches
 * for `window` at module scope, so it is imported inside an effect
 * rather than at the top of this file.
 */

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "© OpenStreetMap";

/**
 * Riyadh, and the reason it is here rather than a country-wide view: a
 * map opened at a whole country shows a pin nobody can place, and the
 * first thing every user would do is zoom. A branch with no position
 * yet starts on the capital and is dragged from there.
 */
const FALLBACK_CENTRE: Position = { latitude: 24.7136, longitude: 46.6753 };
const FALLBACK_ZOOM = 11;
/** Close enough to see a building, when a position is already known. */
const KNOWN_ZOOM = 16;

export interface Position {
  latitude: number;
  longitude: number;
}

export interface LocationPickerLabels {
  /** The heading over the map. */
  title: string;
  /** Explains what dragging the pin does. */
  hint: string;
  confirm: string;
  cancel: string;
  /** Uses the device's own location, if it is offered and allowed. */
  useMyLocation: string;
  /** Shown while the browser is asking for the device's position. */
  locating: string;
  /** The device refused or could not answer. Not an error worth a dialog. */
  locateFailed: string;
  /** Reads out the pin's own coordinates. */
  coordinates: string;
  /* ---- the Google map's own controls ---- */
  searchPlaceholder: string;
  search: string;
  /** Nothing matched the name that was typed. */
  searchFailed: string;
  /** Google Maps could not load at all — a key, a block, or no network. */
  mapUnavailable: string;
  /** Said above the open map when no Google key is configured. */
  usingOpenStreetMap: string;
}

/**
 * Six decimal places is roughly a tenth of a metre — past the accuracy
 * of anything that produced the number, and exactly what the column
 * stores (`Decimal(9,6)`). Rounding here means the value sent is the
 * value kept, so a re-opened picker sits on the same spot.
 */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * WHICH MAP — decided here, once, for every caller.
 *
 * GOOGLE MAPS IS WHAT THE OWNER APPROVED, and it is what this renders
 * the moment `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set. Until then the
 * OpenStreetMap picker below stands in, with a line saying so — a
 * platform whose branch form stops working because a key has not been
 * issued yet is worse than one drawing a different map for a week.
 *
 * The two produce the SAME thing: a pair of numbers under a pin.
 */
export function LocationPicker(props: {
  initial: Position | null;
  labels: LocationPickerLabels;
  onConfirm: (position: Position) => void;
  onCancel: () => void;
}) {
  const locale = useLocale();

  if (hasGoogleMapsKey) {
    return (
      <GoogleLocationPicker
        {...props}
        language={locale.startsWith("ar") ? "ar" : "en"}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p
        className="rounded-md border border-warning bg-warning-surface px-3 py-2 text-xs text-warning-text"
        data-testid="picker-no-google-key"
      >
        {props.labels.usingOpenStreetMap}
      </p>
      <OpenStreetMapPicker {...props} />
    </div>
  );
}

function OpenStreetMapPicker({
  initial,
  labels,
  onConfirm,
  onCancel,
}: {
  /** Where to open. Null starts on the fallback centre. */
  initial: Position | null;
  labels: LocationPickerLabels;
  onConfirm: (position: Position) => void;
  onCancel: () => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<unknown>(null);
  const markerRef = useRef<unknown>(null);

  const [position, setPosition] = useState<Position>(initial ?? FALLBACK_CENTRE);
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !holder.current) return;

      const start = initial ?? FALLBACK_CENTRE;
      const map = L.map(holder.current, {
        center: [start.latitude, start.longitude],
        zoom: initial ? KNOWN_ZOOM : FALLBACK_ZOOM,
        // The map is one control among several in a dialog; a wheel
        // that zooms it while somebody meant to scroll the page is a
        // hijack. Ctrl+wheel and the buttons still zoom.
        scrollWheelZoom: false,
      });

      L.tileLayer(TILE_URL, {
        attribution: TILE_ATTRIBUTION,
        maxZoom: 19,
      }).addTo(map);

      /**
       * THE PIN IS DRAWN, not fetched. Leaflet's default marker is a
       * pair of PNGs it resolves against a CDN path, which would put
       * an external image request in the middle of a form; this is a
       * div styled by the platform's own tokens, so it also matches
       * everything around it.
       */
      const icon = L.divIcon({
        className: "",
        html:
          '<span style="display:block;width:28px;height:28px;border-radius:9999px 9999px 9999px 2px;' +
          "transform:rotate(-45deg);background:var(--color-primary);" +
          'border:3px solid var(--color-surface);box-shadow:0 2px 6px rgba(0,0,0,.35)"></span>',
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });

      const marker = L.marker([start.latitude, start.longitude], {
        draggable: true,
        icon,
        keyboard: true,
      }).addTo(map);

      const read = () => {
        const point = marker.getLatLng();
        setPosition({
          latitude: round(point.lat),
          longitude: round(point.lng),
        });
      };

      marker.on("dragend", read);
      // TAPPING THE MAP MOVES THE PIN. Dragging a small target on a
      // phone is the harder gesture, and the two should not disagree.
      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        marker.setLatLng(event.latlng);
        read();
      });

      // The import above is awaited, so the picker can be closed while
      // it is still resolving. Nothing below may touch state after that.
      if (cancelled) {
        map.remove();
        return;
      }

      mapRef.current = map;
      markerRef.current = marker;
      setReady(true);

      // The dialog animates open, so the map is measured before its
      // holder has its final size unless it is told to look again.
      const settle = window.setTimeout(() => map.invalidateSize(), 60);

      cleanup = () => {
        window.clearTimeout(settle);
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // DELIBERATELY BUILT ONCE, with `initial` left out of the list:
    // it is where the map OPENS, and re-centring while somebody is
    // dragging would take the pin off the place they just chose.
  }, []);

  /**
   * THE DEVICE'S OWN POSITION, offered rather than taken. It is a
   * convenience for somebody standing at the branch, it asks the
   * browser's own permission prompt, and a refusal is not an error —
   * the pin is still there to drag.
   */
  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setLocateFailed(true);
      return;
    }
    setLocating(true);
    setLocateFailed(false);
    navigator.geolocation.getCurrentPosition(
      (found) => {
        setLocating(false);
        const next = {
          latitude: round(found.coords.latitude),
          longitude: round(found.coords.longitude),
        };
        setPosition(next);
        const map = mapRef.current as
          | { setView: (c: [number, number], z: number) => void }
          | null;
        const marker = markerRef.current as
          | { setLatLng: (c: [number, number]) => void }
          | null;
        marker?.setLatLng([next.latitude, next.longitude]);
        map?.setView([next.latitude, next.longitude], KNOWN_ZOOM);
      },
      () => {
        setLocating(false);
        setLocateFailed(true);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  return (
    <div className="flex flex-col gap-3" data-testid="location-picker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-content">
          <MapPin className="size-4 text-primary" aria-hidden />
          {labels.title}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={locate}
          disabled={locating}
          data-testid="picker-locate"
        >
          {locating ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Crosshair className="size-4" aria-hidden />
          )}
          {locating ? labels.locating : labels.useMyLocation}
        </Button>
      </div>

      <p className="text-xs text-content-muted">{labels.hint}</p>

      {/*
        A FIXED HEIGHT, because a map with none collapses to nothing:
        Leaflet measures its holder and the holder has no content of
        its own to give it a size.
      */}
      <div
        ref={holder}
        className="h-72 w-full overflow-hidden rounded-md border border-line bg-background sm:h-80"
        // The map is a graphic that is operated, and Leaflet builds
        // its own focusable controls inside.
        role="application"
        aria-label={labels.title}
        data-testid="picker-map"
      />

      {locateFailed ? (
        <p className="text-xs text-content-muted" data-testid="picker-locate-failed">
          {labels.locateFailed}
        </p>
      ) : null}

      <p className="text-xs text-content-muted">
        {labels.coordinates}{" "}
        <bdi className="font-mono" data-testid="picker-coordinates">
          {position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}
        </bdi>
      </p>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => onConfirm(position)}
          disabled={!ready}
          data-testid="picker-confirm"
        >
          {labels.confirm}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          data-testid="picker-cancel"
        >
          {labels.cancel}
        </Button>
      </div>
    </div>
  );
}
