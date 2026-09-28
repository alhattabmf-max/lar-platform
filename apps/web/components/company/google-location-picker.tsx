"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crosshair, Loader2, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { loadGoogleMaps } from "@/lib/google-maps";
import type { LocationPickerLabels, Position } from "./location-picker";

/**
 * WHERE A BRANCH IS, chosen on GOOGLE MAPS.
 *
 * WHAT IT DOES, all four of the things the owner asked for:
 *
 *   · SEARCH BY PLACE NAME — through the GEOCODER rather than Places.
 *     Geocoding is part of core Maps, so the operator has one fewer
 *     API to enable and none of the Places-widget deprecations to
 *     track, and it answers a plain «مستودع الرياض» perfectly well.
 *   · WHEEL ZOOM — `gestureHandling: "greedy"`, so the wheel zooms the
 *     map directly. Google's default demands ctrl+wheel on a scrolling
 *     page; inside a dialog that is a control nobody finds.
 *   · MY LOCATION — the browser's own permission prompt, and a refusal
 *     is not an error: the pin is still there to drag.
 *   · A DRAGGABLE PIN, and a tap on the map moves it too, because
 *     dragging a small target on a phone is the harder gesture.
 *
 * THE NUMBERS ARE THE ANSWER. Whatever route somebody takes to the
 * spot — searching, locating, dragging — what leaves this component is
 * the pair under the pin, exactly as the OpenStreetMap picker beside
 * it produces.
 *
 * IT NEVER RENDERS WITHOUT A KEY. `LocationPicker` decides which of
 * the two to mount; this one is only reached when a key is configured,
 * and it still handles the load failing.
 */

const FALLBACK_CENTRE: Position = { latitude: 24.7136, longitude: 46.6753 };
const FALLBACK_ZOOM = 11;
const KNOWN_ZOOM = 17;

/** Six decimals ≈ a tenth of a metre, and exactly what the column stores. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;

// The Maps typings are not a dependency here; what this file touches is
// narrow enough to describe, and describing it is better than `any`
// spreading through the handlers.
interface GLatLng {
  lat(): number;
  lng(): number;
}
interface GMap {
  setCenter(position: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
  addListener(event: string, handler: (e: { latLng: GLatLng }) => void): void;
}
interface GMarker {
  setPosition(position: { lat: number; lng: number }): void;
  addListener(event: string, handler: () => void): void;
  getPosition(): GLatLng | undefined;
}
interface GGeocoder {
  geocode(
    request: { address: string; region?: string },
    callback: (
      results: { geometry: { location: GLatLng } }[] | null,
      status: string,
    ) => void,
  ): void;
}

/**
 * THE THREE THINGS THIS FILE BUILDS off the loaded script, and nothing
 * else.
 *
 * It was reached through `(window as unknown as { google: any })`, and
 * `any` there does not stop at the door: every value taken off it — the
 * map, the marker, the geocoder, each callback argument — arrived
 * unchecked, on the one screen where a wrong latitude is a delivery to
 * the wrong city.
 *
 * NOT THE WHOLE OF GOOGLE'S API. Typing what is used is honest and
 * finite; typing what is not used would be a second, unverified copy of
 * somebody else's library.
 */
interface GoogleMapsApi {
  maps: {
    Map: new (
      holder: HTMLElement,
      options: {
        center: { lat: number; lng: number };
        zoom: number;
        gestureHandling: string;
        mapTypeControl: boolean;
        streetViewControl: boolean;
        fullscreenControl: boolean;
      },
    ) => GMap;
    Marker: new (options: {
      map: GMap;
      position: { lat: number; lng: number };
      draggable: boolean;
    }) => GMarker;
    Geocoder: new () => GGeocoder;
  };
}

export function GoogleLocationPicker({
  initial,
  language,
  labels,
  onConfirm,
  onCancel,
}: {
  initial: Position | null;
  /** "ar" or "en" — the map's own labels follow the reader. */
  language: string;
  labels: LocationPickerLabels;
  onConfirm: (position: Position) => void;
  onCancel: () => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const markerRef = useRef<GMarker | null>(null);
  const geocoderRef = useRef<GGeocoder | null>(null);

  const [position, setPosition] = useState<Position>(initial ?? FALLBACK_CENTRE);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);

  const place = useCallback((next: Position, zoom = KNOWN_ZOOM) => {
    setPosition(next);
    markerRef.current?.setPosition({ lat: next.latitude, lng: next.longitude });
    mapRef.current?.setCenter({ lat: next.latitude, lng: next.longitude });
    mapRef.current?.setZoom(zoom);
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps(language)
      .then(() => {
        if (cancelled || !holder.current) return;
        const google = (window as unknown as { google: GoogleMapsApi }).google;
        const start = initial ?? FALLBACK_CENTRE;

        const map: GMap = new google.maps.Map(holder.current, {
          center: { lat: start.latitude, lng: start.longitude },
          zoom: initial ? KNOWN_ZOOM : FALLBACK_ZOOM,
          // THE WHEEL ZOOMS THE MAP. Google's default asks for
          // ctrl+wheel on a scrolling page, which is a control nobody
          // finds inside a form.
          gestureHandling: "greedy",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });

        const marker: GMarker = new google.maps.Marker({
          map,
          position: { lat: start.latitude, lng: start.longitude },
          draggable: true,
        });

        const read = () => {
          const at = marker.getPosition();
          if (!at) return;
          setPosition({ latitude: round(at.lat()), longitude: round(at.lng()) });
        };
        marker.addListener("dragend", read);
        map.addListener("click", (event) => {
          if (!event.latLng) return;
          marker.setPosition({
            lat: event.latLng.lat(),
            lng: event.latLng.lng(),
          });
          read();
        });

        mapRef.current = map;
        markerRef.current = marker;
        geocoderRef.current = new google.maps.Geocoder();
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
    // BUILT ONCE, with `initial` deliberately out of the list: it is
    // where the map OPENS, and re-centring while somebody is dragging
    // would take the pin off the place they just chose.
  }, []);

  /** Search by place name, through the Geocoder. */
  const search = useCallback(() => {
    const text = query.trim();
    if (text === "" || !geocoderRef.current) return;
    setSearching(true);
    setSearchFailed(false);
    geocoderRef.current.geocode(
      { address: text, region: "SA" },
      (results, status) => {
        setSearching(false);
        const first = results?.[0];
        if (status !== "OK" || !first) {
          setSearchFailed(true);
          return;
        }
        const at = first.geometry.location;
        place({ latitude: round(at.lat()), longitude: round(at.lng()) });
      },
    );
  }, [query, place]);

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
        place({
          latitude: round(found.coords.latitude),
          longitude: round(found.coords.longitude),
        });
      },
      () => {
        setLocating(false);
        setLocateFailed(true);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [place]);

  if (failed) {
    return (
      <div className="flex flex-col gap-3" data-testid="google-picker-failed">
        <p className="text-sm text-content">{labels.mapUnavailable}</p>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {labels.cancel}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="google-location-picker">
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
          disabled={locating || !ready}
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

      {/* SEARCH BY NAME. Enter searches, because a person typing a
          place name expects Enter to do something. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-0 flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Never let it submit the form around this picker.
              e.preventDefault();
              search();
            }
          }}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          data-testid="picker-search"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={search}
          disabled={searching || !ready || query.trim() === ""}
          data-testid="picker-search-go"
        >
          {searching ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Search className="size-4" aria-hidden />
          )}
          {labels.search}
        </Button>
      </div>

      {searchFailed ? (
        <p className="text-xs text-content-muted" data-testid="picker-search-failed">
          {labels.searchFailed}
        </p>
      ) : null}

      <p className="text-xs text-content-muted">{labels.hint}</p>

      <div
        ref={holder}
        className="h-72 w-full overflow-hidden rounded-md border border-line bg-background sm:h-80"
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
