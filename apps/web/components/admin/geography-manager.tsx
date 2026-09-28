"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * The regions of the Kingdom, and the cities beneath them.
 *
 * ONE HIERARCHICAL CARD, not two flat lists. The two used to be
 * separate `ReferenceDataManager` sections, which meant a screen that
 * showed a hundred and fifty-two cities in one column with their region
 * printed underneath each as a caption — the shape of the data was
 * exactly backwards from the shape of the list. A region is the
 * platform's operational unit and its cities belong to it, so here it
 * reads that way: a region, and its cities indented under it.
 *
 * ACTIVATION IS INDEPENDENT AT EACH LEVEL, and the two mean different
 * things:
 *
 *   · A REGION that is switched off cannot be used in a new operation.
 *     A branch cannot be added there, and a listing shipping from one
 *     goes to ACTION_REQUIRED. That is why deactivating one asks a
 *     harder question than deactivating a city.
 *   · A CITY that is switched off stops being offered as a refinement
 *     under its region. Nothing else changes: branches keep working,
 *     listings keep publishing, the marketplace keeps selling.
 *
 * A CITY UNDER AN INACTIVE REGION SAYS SO. Its own switch still works —
 * the two levels are independent, as required — but an active city
 * under a switched-off region is offered nowhere, and a screen that did
 * not say that would be showing a control with no effect.
 *
 * NOTHING HERE DELETES. Every region and city is referenced by
 * branches, listings and frozen snapshots, and the API has no delete
 * for either. Deactivating is what "retiring a place" means.
 */

export interface GeographyCity {
  id: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
}

export interface GeographyRegion {
  id: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  cities: readonly GeographyCity[];
}

export interface GeographyManagerLabels {
  addRegion: string;
  addCity: string;
  nameAr: string;
  nameEn: string;
  add: string;
  rename: string;
  save: string;
  cancel: string;
  activate: string;
  deactivate: string;
  /** Asked before switching a region off — it stops new operations. */
  deactivateRegionPrompt: string;
  /** Asked before switching a city off — it only stops being offered. */
  deactivateCityPrompt: string;
  activePill: string;
  inactivePill: string;
  /** Shown on a city whose region is switched off. */
  regionInactiveNotice: string;
  noCities: string;
  working: string;
  required: string;
  notDeleteNotice: string;
  errorTitle: string;
  requestIdLabel: string;
}

const NAME_MAX = 120;

export function GeographyManager({
  regions,
  labels,
}: {
  regions: readonly GeographyRegion[];
  labels: GeographyManagerLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  // A new region.
  const [regionAr, setRegionAr] = useState("");
  const [regionEn, setRegionEn] = useState("");

  // A new city, and which region's form is open. Keyed by region so two
  // open forms cannot share one draft.
  const [addingCityTo, setAddingCityTo] = useState<string | null>(null);
  const [cityAr, setCityAr] = useState("");
  const [cityEn, setCityEn] = useState("");

  // Renaming, and the inline deactivate question. Both are keyed by id
  // rather than by kind: an id is unique across both levels.
  const [editing, setEditing] = useState<string | null>(null);
  const [editAr, setEditAr] = useState("");
  const [editEn, setEditEn] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await work();
      setBusy(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  const rename = (basePath: string, id: string) => {
    if (editAr.trim() === "" || editEn.trim() === "") return;
    void run(async () => {
      await apiClient.patch(`${basePath}/${id}`, {
        nameAr: editAr.trim(),
        nameEn: editEn.trim(),
      });
      setEditing(null);
    });
  };

  const toggle = (basePath: string, id: string) =>
    void run(() => apiClient.post(`${basePath}/${id}/toggle`));

  /** The rename form, shared by both levels. */
  const renameForm = (basePath: string, id: string) => (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-edit-ar-${id}`}>{labels.nameAr}</Label>
          <Input
            id={`${ids}-edit-ar-${id}`}
            dir="rtl"
            maxLength={NAME_MAX}
            value={editAr}
            onChange={(event) => setEditAr(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-edit-en-${id}`}>{labels.nameEn}</Label>
          <Input
            id={`${ids}-edit-en-${id}`}
            dir="ltr"
            maxLength={NAME_MAX}
            value={editEn}
            onChange={(event) => setEditEn(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          isLoading={busy}
          disabled={busy || editAr.trim() === "" || editEn.trim() === ""}
          onClick={() => rename(basePath, id)}
        >
          {busy ? labels.working : labels.save}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setEditing(null)}
        >
          {labels.cancel}
        </Button>
      </div>
    </div>
  );

  /**
   * The rename and activate controls, shared by both levels.
   *
   * The PROMPT differs because the consequence differs — switching off
   * a region stops new business in it, switching off a city only stops
   * it being offered — and the button that asks has to say which.
   */
  const controls = (
    basePath: string,
    row: { id: string; isActive: boolean; nameAr: string; nameEn: string },
    prompt: string,
    testPrefix: string,
  ) => (
    <>
      <StatusBadge
        label={row.isActive ? labels.activePill : labels.inactivePill}
        tone={row.isActive ? "done" : "neutral"}
      />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        data-testid={`${testPrefix}-rename-${row.id}`}
        onClick={() => {
          setEditing(row.id);
          setEditAr(row.nameAr);
          setEditEn(row.nameEn);
          setFailure(null);
        }}
      >
        {labels.rename}
      </Button>

      {confirming === row.id ? (
        <span className="flex flex-wrap items-center gap-2">
          <span role="status" aria-live="polite" className="text-sm text-content">
            {prompt}
          </span>
          <Button
            type="button"
            variant="danger"
            size="sm"
            isLoading={busy}
            disabled={busy}
            data-testid={`${testPrefix}-confirm-${row.id}`}
            onClick={() => {
              setConfirming(null);
              toggle(basePath, row.id);
            }}
          >
            {labels.deactivate}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setConfirming(null)}
          >
            {labels.cancel}
          </Button>
        </span>
      ) : (
        <Button
          type="button"
          variant={row.isActive ? "danger" : "primary"}
          size="sm"
          disabled={busy}
          data-testid={`${testPrefix}-toggle-${row.id}`}
          onClick={() => {
            // Switching something ON restores what already existed and
            // asks nothing. Switching it OFF removes it from every
            // picker on the platform, so it asks first.
            if (row.isActive) {
              setConfirming(row.id);
              setFailure(null);
              return;
            }
            toggle(basePath, row.id);
          }}
        >
          {row.isActive ? labels.deactivate : labels.activate}
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- a new region ---------- */}
      <form
        noValidate
        className="flex flex-col gap-3 rounded-card bg-surface shadow-card px-card-x py-card-y"
        onSubmit={(event) => {
          event.preventDefault();
          if (regionAr.trim() === "" || regionEn.trim() === "") return;
          void run(async () => {
            await apiClient.post("/admin/regions", {
              nameAr: regionAr.trim(),
              nameEn: regionEn.trim(),
            });
            setRegionAr("");
            setRegionEn("");
          });
        }}
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="px-1 text-base font-medium text-content">
            {labels.addRegion}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-region-ar`} required requiredLabel={labels.required}>
                {labels.nameAr}
              </Label>
              <Input
                id={`${ids}-region-ar`}
                dir="rtl"
                maxLength={NAME_MAX}
                value={regionAr}
                onChange={(event) => setRegionAr(event.target.value)}
                data-testid="region-name-ar"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-region-en`} required requiredLabel={labels.required}>
                {labels.nameEn}
              </Label>
              <Input
                id={`${ids}-region-en`}
                dir="ltr"
                maxLength={NAME_MAX}
                value={regionEn}
                onChange={(event) => setRegionEn(event.target.value)}
                data-testid="region-name-en"
              />
            </div>
          </div>
          <div>
            <Button
              type="submit"
              size="sm"
              isLoading={busy}
              disabled={busy || regionAr.trim() === "" || regionEn.trim() === ""}
              data-testid="add-region"
            >
              {busy ? labels.working : labels.add}
            </Button>
          </div>
        </fieldset>
      </form>

      {failure ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-danger p-3"
        >
          <p className="text-sm font-medium text-content">{labels.errorTitle}</p>
          <p className="text-sm text-content-muted">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-xs text-content-muted">
              {labels.requestIdLabel}:{" "}
              <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm text-content-muted">{labels.notDeleteNotice}</p>

      {/* ---------- the regions, each with its cities ---------- */}
      <ul className="flex list-none flex-col gap-3">
        {regions.map((region) => (
          <li
            key={region.id}
            className="rounded-card border border-line bg-surface px-card-x py-card-y"
            data-testid={`region-${region.id}`}
          >
            {editing === region.id ? (
              renameForm("/admin/regions", region.id)
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex flex-1 flex-col gap-1">
                  <span className="text-sm font-medium text-content">
                    {region.nameAr} — {region.nameEn}
                  </span>
                  {/*
                    THE COUNT GOES THROUGH next-intl, not through a
                    label with a hand-rolled replace: Arabic has six
                    plural forms and the catalogue is where that rule
                    belongs. This is a client component with its own
                    translator, so it resolves the message itself
                    rather than being handed a half-rendered string.
                  */}
                  <span className="text-xs text-content-muted">
                    {root("admin.catalogue.cityCount", {
                      count: region.cities.length,
                    })}
                  </span>
                </span>
                {controls(
                  "/admin/regions",
                  region,
                  labels.deactivateRegionPrompt,
                  "region",
                )}
              </div>
            )}

            {/* ---------- its cities ---------- */}
            <ul className="mt-3 flex list-none flex-col gap-2 border-s-2 border-line ps-3">
              {region.cities.length === 0 ? (
                <li className="text-sm text-content-muted">{labels.noCities}</li>
              ) : (
                region.cities.map((city) => (
                  <li
                    key={city.id}
                    className="rounded-md border border-line p-2"
                    data-testid={`city-${city.id}`}
                  >
                    {editing === city.id ? (
                      renameForm("/admin/cities", city.id)
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="flex flex-1 flex-col gap-1">
                          <span className="text-sm text-content">
                            {city.nameAr} — {city.nameEn}
                          </span>
                          {/*
                            AN ACTIVE CITY UNDER A SWITCHED-OFF REGION
                            is offered nowhere. Its own switch still
                            works — the levels are independent — and
                            saying so is the difference between a
                            control and a control with no effect.
                          */}
                          {city.isActive && !region.isActive ? (
                            <span className="text-xs text-content-muted">
                              {labels.regionInactiveNotice}
                            </span>
                          ) : null}
                        </span>
                        {controls(
                          "/admin/cities",
                          city,
                          labels.deactivateCityPrompt,
                          "city",
                        )}
                      </div>
                    )}
                  </li>
                ))
              )}

              {/* ---------- a new city, under THIS region ---------- */}
              <li>
                {addingCityTo === region.id ? (
                  <form
                    noValidate
                    className="flex flex-col gap-3 rounded-md border border-line p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (cityAr.trim() === "" || cityEn.trim() === "") return;
                      void run(async () => {
                        // The region comes from the row the form is
                        // open under, never from a picker: there is no
                        // way to add a city to the wrong region here.
                        await apiClient.post("/admin/cities", {
                          regionId: region.id,
                          nameAr: cityAr.trim(),
                          nameEn: cityEn.trim(),
                        });
                        setCityAr("");
                        setCityEn("");
                        setAddingCityTo(null);
                      });
                    }}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1">
                        <Label
                          htmlFor={`${ids}-city-ar-${region.id}`}
                          required
                          requiredLabel={labels.required}
                        >
                          {labels.nameAr}
                        </Label>
                        <Input
                          id={`${ids}-city-ar-${region.id}`}
                          dir="rtl"
                          maxLength={NAME_MAX}
                          value={cityAr}
                          onChange={(event) => setCityAr(event.target.value)}
                          data-testid="city-name-ar"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label
                          htmlFor={`${ids}-city-en-${region.id}`}
                          required
                          requiredLabel={labels.required}
                        >
                          {labels.nameEn}
                        </Label>
                        <Input
                          id={`${ids}-city-en-${region.id}`}
                          dir="ltr"
                          maxLength={NAME_MAX}
                          value={cityEn}
                          onChange={(event) => setCityEn(event.target.value)}
                          data-testid="city-name-en"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        isLoading={busy}
                        disabled={
                          busy || cityAr.trim() === "" || cityEn.trim() === ""
                        }
                        data-testid="save-city"
                      >
                        {busy ? labels.working : labels.add}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setAddingCityTo(null)}
                      >
                        {labels.cancel}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    // The API refuses to create a city under an
                    // inactive region, so the control is not offered
                    // there rather than offered and then refused.
                    disabled={busy || !region.isActive}
                    data-testid={`add-city-${region.id}`}
                    onClick={() => {
                      setAddingCityTo(region.id);
                      setCityAr("");
                      setCityEn("");
                      setFailure(null);
                    }}
                  >
                    {labels.addCity}
                  </Button>
                )}
              </li>
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
