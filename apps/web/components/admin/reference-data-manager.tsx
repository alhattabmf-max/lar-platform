"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * Create, rename and activate one kind of reference data.
 *
 * ONE component for regions, cities, sales units and taxonomy nodes,
 * because the four endpoints are the same shape: a list, a create, a
 * PATCH that renames, and a toggle. Four near-identical files would drift
 * — one of them would end up without the bilingual pair, or without the
 * confirmation on deactivate.
 *
 * DEACTIVATE IS NOT DELETE, and the label says so. These rows are
 * referenced by products, addresses and opportunities; the endpoint
 * toggles `isActive` and there is no delete anywhere in the API. Calling
 * the control "delete" would promise something it does not do.
 *
 * BOTH NAMES ARE REQUIRED. Every one of these appears in both interfaces,
 * and a row with only an Arabic name renders as blank for an English
 * reader — so the form does not allow it, exactly as the API does not.
 *
 * `iconUrl` on a taxonomy node is deliberately NOT editable here. It is a
 * free-text URL field on the API, and an operator-typed destination is a
 * surface this portal does not open.
 */
export interface ReferenceRow {
  id: string;
  nameAr: string;
  nameEn: string;
  isActive: boolean;
  /** Rendered beside the name — a parent category, or a city's region. */
  context?: string;
}

/** A required extra field on create, e.g. a city's region. */
export interface ReferenceParentField {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
}

export interface ReferenceDataManagerLabels {
  addLegend: string;
  nameAr: string;
  nameEn: string;
  add: string;
  rename: string;
  save: string;
  cancel: string;
  activate: string;
  deactivate: string;
  deactivatePrompt: string;
  activePill: string;
  inactivePill: string;
  working: string;
  required: string;
  notDeleteNotice: string;
  errorTitle: string;
  requestIdLabel: string;
}

const NAME_MAX = 120;

export function ReferenceDataManager({
  basePath,
  rows,
  parentField,
  labels,
}: {
  /** API collection path, e.g. `/admin/regions`. */
  basePath: string;
  rows: readonly ReferenceRow[];
  parentField?: ReferenceParentField;
  labels: ReferenceDataManagerLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [parent, setParent] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editAr, setEditAr] = useState("");
  const [editEn, setEditEn] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  // Which row is asking to be deactivated. An inline question rather
  // than window.confirm: a native dialog cannot be translated, ignores
  // the page direction, and is suppressible by the browser — so the
  // confirmation could simply not appear.
  const [confirming, setConfirming] = useState<string | null>(null);

  const canAdd =
    nameAr.trim() !== "" && nameEn.trim() !== "" && (!parentField || parent !== "");

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

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!canAdd) return;
    await run(async () => {
      await apiClient.post(basePath, {
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim(),
        ...(parentField ? { [parentField.name]: parent } : {}),
      });
      setNameAr("");
      setNameEn("");
      setParent("");
    });
  }

  async function rename(id: string) {
    if (editAr.trim() === "" || editEn.trim() === "") return;
    await run(async () => {
      await apiClient.patch(`${basePath}/${id}`, {
        nameAr: editAr.trim(),
        nameEn: editEn.trim(),
      });
      setEditing(null);
    });
  }

  const failureBlock = failure ? (
    <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger p-3">
      <p className="text-sm font-medium text-content">{labels.errorTitle}</p>
      <p className="text-sm text-content-muted">{root(failure.messageKey)}</p>
      {failure.requestId ? (
        <p className="text-xs text-content-muted">
          {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
        </p>
      ) : null}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={create}
        className="flex flex-col gap-3 rounded-card bg-surface shadow-card px-card-x py-card-y"
        noValidate
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="px-1 text-base font-medium text-content">{labels.addLegend}</legend>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-ar`} required requiredLabel={labels.required}>
                {labels.nameAr}
              </Label>
              <Input
                id={`${ids}-ar`}
                dir="rtl"
                maxLength={NAME_MAX}
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-en`} required requiredLabel={labels.required}>
                {labels.nameEn}
              </Label>
              <Input
                id={`${ids}-en`}
                dir="ltr"
                maxLength={NAME_MAX}
                value={nameEn}
                onChange={(event) => setNameEn(event.target.value)}
              />
            </div>
          </div>

          {parentField ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-parent`} required requiredLabel={labels.required}>
                {parentField.label}
              </Label>
              <Select
                id={`${ids}-parent`}
                value={parent}
                onChange={(event) => setParent(event.target.value)}
              >
                <option value="">{parentField.label}</option>
                {parentField.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div>
            <Button
              type="submit"
              size="sm"
             
              isLoading={busy}
              disabled={busy || !canAdd}
            >
              {busy ? labels.working : labels.add}
            </Button>
          </div>
        </fieldset>
      </form>

      {failureBlock}

      <p className="text-sm text-content-muted">{labels.notDeleteNotice}</p>

      <ul className="flex list-none flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-md border border-line bg-surface p-3">
            {editing === row.id ? (
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${ids}-edit-ar-${row.id}`}>{labels.nameAr}</Label>
                    <Input
                      id={`${ids}-edit-ar-${row.id}`}
                      dir="rtl"
                      maxLength={NAME_MAX}
                      value={editAr}
                      onChange={(event) => setEditAr(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${ids}-edit-en-${row.id}`}>{labels.nameEn}</Label>
                    <Input
                      id={`${ids}-edit-en-${row.id}`}
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
                    onClick={() => rename(row.id)}
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
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex flex-1 flex-col gap-1">
                  <span className="text-sm text-content">
                    {row.nameAr} — {row.nameEn}
                  </span>
                  {row.context ? (
                    <span className="text-xs text-content-muted">{row.context}</span>
                  ) : null}
                </span>

                <StatusBadge
                  label={row.isActive ? labels.activePill : labels.inactivePill}
                  tone={row.isActive ? "done" : "neutral"}
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                 
                  disabled={busy}
                  onClick={() => {
                    setEditing(row.id);
                    setEditAr(row.nameAr);
                    setEditEn(row.nameEn);
                    setFailure(null);
                  }}
                >
                  {labels.rename}
                </Button>

                {/* Deactivating hides a row from every picker on the
                    platform, so it asks first. Reactivating restores
                    something that already existed and does not. */}
                {confirming === row.id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span role="status" aria-live="polite" className="text-sm text-content">
                      {labels.deactivatePrompt}
                    </span>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                     
                      isLoading={busy}
                      disabled={busy}
                      onClick={() => {
                        setConfirming(null);
                        void run(() => apiClient.post(`${basePath}/${row.id}/toggle`));
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
                    onClick={() => {
                      if (row.isActive) {
                        setConfirming(row.id);
                        setFailure(null);
                        return;
                      }
                      void run(() => apiClient.post(`${basePath}/${row.id}/toggle`));
                    }}
                  >
                    {row.isActive ? labels.deactivate : labels.activate}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
