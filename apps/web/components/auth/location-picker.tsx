"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  GEOLOCATION_MESSAGE_KEY,
  RETRYABLE_FAILURES,
  isGeolocationSupported,
  isSecureContextForGeolocation,
  parseManualCoordinates,
  requestCurrentPosition,
  type Coordinates,
  type GeolocationFailure,
} from "@/lib/geolocation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/**
 * Captures the company's coordinates.
 *
 * Primary path is the browser's own geolocation, behind an explicit
 * button — never an automatic prompt on page load, which users reflexively
 * dismiss and which then cannot be re-asked.
 *
 * Manual entry is a real fallback, not a decoration: every failure mode
 * ends with it available and explained. There is no map in 8C, and no
 * fabricated position anywhere — when neither path yields coordinates,
 * `onChange(null)` keeps the parent's submit disabled.
 */
export interface LocationPickerProps {
  value: Coordinates | null;
  onChange: (coordinates: Coordinates | null) => void;
}

export function LocationPicker({ value, onChange }: LocationPickerProps) {
  const t = useTranslations("register.location");
  const common = useTranslations("common");
  const root = useTranslations();

  const statusId = useId();

  const [failure, setFailure] = useState<GeolocationFailure | null>(null);
  const [locating, setLocating] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [latitudeRaw, setLatitudeRaw] = useState("");
  const [longitudeRaw, setLongitudeRaw] = useState("");
  const [manualInvalid, setManualInvalid] = useState(false);

  // Evaluated on the client only; on the server both read false, which
  // is why the button is rendered and disabled rather than hidden.
  const supported = isGeolocationSupported();
  const secure = isSecureContextForGeolocation();
  const canUseBrowserLocation = supported && secure;

  async function detect() {
    setLocating(true);
    setFailure(null);

    const result = await requestCurrentPosition();
    setLocating(false);

    if (result.ok) {
      onChange(result.coordinates);
      setManualInvalid(false);
      return;
    }

    setFailure(result.failure);
    onChange(null);
    // Every failure surfaces manual entry — the user must always have a
    // way forward that does not depend on the browser cooperating.
    setManualOpen(true);
  }

  function applyManual(nextLat: string, nextLng: string) {
    setLatitudeRaw(nextLat);
    setLongitudeRaw(nextLng);

    if (nextLat.trim() === "" && nextLng.trim() === "") {
      setManualInvalid(false);
      onChange(null);
      return;
    }

    const parsed = parseManualCoordinates(nextLat, nextLng);
    setManualInvalid(parsed === null);
    onChange(parsed);
  }

  const failureKey = failure ? GEOLOCATION_MESSAGE_KEY[failure] : null;
  const canRetry = failure !== null && RETRYABLE_FAILURES.has(failure);

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <legend className="px-1 text-sm font-medium text-content">{t("legend")}</legend>
      <p className="text-sm text-content-muted">{t("description")}</p>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={detect}
          isLoading={locating}
          disabled={!canUseBrowserLocation}
        >
          {locating ? common("loading") : t("useMyLocation")}
        </Button>

        {canRetry ? (
          <Button type="button" variant="ghost" onClick={detect}>
            {common("retry")}
          </Button>
        ) : null}
      </div>

      {/* One live region for both success and failure, so a screen
          reader hears the outcome without polling the form. */}
      <div id={statusId} role="status" aria-live="polite">
        {value ? (
          <p className="text-sm text-success">
            {t("captured")}
            {value.accuracyMetres !== null
              ? ` — ${t("accuracy", { metres: Math.round(value.accuracyMetres) })}`
              : null}
          </p>
        ) : null}

        {failureKey ? (
          <p className="text-sm text-warning-text">{root(failureKey)}</p>
        ) : null}

        {!canUseBrowserLocation ? (
          <p className="text-sm text-warning-text">
            {root(
              supported
                ? GEOLOCATION_MESSAGE_KEY.INSECURE_CONTEXT
                : GEOLOCATION_MESSAGE_KEY.UNSUPPORTED
            )}
          </p>
        ) : null}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setManualOpen((open) => !open)}
          aria-expanded={manualOpen}
          className="text-sm text-secondary hover:opacity-90"
        >
          {manualOpen ? t("manual.hide") : t("manual.show")}
        </button>
      </div>

      {manualOpen ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-content-muted">{t("manual.description")}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("manual.latitude")}>
              {({ inputId }) => (
                <Input
                  id={inputId}
                  inputMode="decimal"
                  value={latitudeRaw}
                  invalid={manualInvalid}
                  onChange={(e) => applyManual(e.target.value, longitudeRaw)}
                />
              )}
            </Field>

            <Field label={t("manual.longitude")}>
              {({ inputId }) => (
                <Input
                  id={inputId}
                  inputMode="decimal"
                  value={longitudeRaw}
                  invalid={manualInvalid}
                  onChange={(e) => applyManual(latitudeRaw, e.target.value)}
                />
              )}
            </Field>
          </div>

          {manualInvalid ? (
            <p role="alert" className="text-sm text-danger">
              {t("manual.invalid")}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
