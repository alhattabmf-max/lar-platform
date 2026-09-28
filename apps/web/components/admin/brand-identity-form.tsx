"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AdminBrandingView } from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

/**
 * The platform's name and description, in both languages.
 *
 * THE SERVER ALWAYS ACCEPTED THESE. `PUT /admin/branding` has taken
 * `nameAr`, `nameEn`, `shortDescriptionAr` and `shortDescriptionEn`
 * since it was written, and `BrandingSettings` has had the columns for
 * just as long. This screen showed all four as a read-only list — so the
 * one thing an operator could not change about their own platform was
 * what it is called.
 *
 * WHERE THEY APPEAR: the name is the wordmark fallback in the top bar
 * and the footer heading, and the description is the line under it. Both
 * are read by `getBranding` on every public page, so a save here is
 * visible on the storefront rather than only in this console.
 *
 * NO DRAFT AND NO PUBLISH, deliberately. The logo has both because an
 * unfinished picture is visible damage; a name is one field, saved when
 * it is right. Adding a draft state for it would mean a second stored
 * shape and a second thing to forget to publish.
 */

export interface BrandIdentityLabels {
  nameAr: string;
  nameEn: string;
  shortDescriptionAr: string;
  shortDescriptionEn: string;
  save: string;
  working: string;
  saved: string;
  required: string;
  errorTitle: string;
  requestIdLabel: string;
  errorName: string;
  hint: string;
}

/** The platform's own bound on a display name, quoted from the DTO. */
const NAME_MAX = 120;
const DESCRIPTION_MAX = 300;

export function BrandIdentityForm({
  current,
  labels,
}: {
  current: AdminBrandingView | null;
  labels: BrandIdentityLabels;
}) {
  const router = useRouter();
  const root = useTranslations();

  const [nameAr, setNameAr] = useState(current?.nameAr ?? "");
  const [nameEn, setNameEn] = useState(current?.nameEn ?? "");
  const [descriptionAr, setDescriptionAr] = useState(
    current?.shortDescriptionAr ?? "",
  );
  const [descriptionEn, setDescriptionEn] = useState(
    current?.shortDescriptionEn ?? "",
  );

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const touch = () => {
    if (saved) setSaved(false);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    // BOTH LANGUAGES OR NEITHER. The public pages pick by the reader's
    // locale with no fallback, so a name saved in one language leaves
    // the other half of the audience looking at the fallback wordmark.
    if (nameAr.trim().length === 0 || nameEn.trim().length === 0) {
      setError(labels.errorName);
      return;
    }
    setError(null);
    setBusy(true);
    setFailure(null);
    setSaved(false);

    try {
      await apiClient.put("/admin/branding", {
        nameAr: nameAr.trim(),
        nameEn: nameEn.trim(),
        shortDescriptionAr: descriptionAr.trim(),
        shortDescriptionEn: descriptionEn.trim(),
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setFailure(toUserFacingError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* The two names sit side by side because they are one field in
            two languages, and reading one while typing the other is the
            whole job. */}
        <Field
          label={labels.nameAr}
          error={error ?? undefined}
          required
          requiredLabel={labels.required}
        >
          {({ inputId, errorId, invalid }) => (
            <Input
              id={inputId}
              dir="rtl"
              maxLength={NAME_MAX}
              value={nameAr}
              onChange={(event) => {
                setNameAr(event.target.value);
                touch();
              }}
              disabled={busy}
              describedById={errorId}
              invalid={invalid}
              data-testid="brand-name-ar"
            />
          )}
        </Field>
        <Field label={labels.nameEn} required requiredLabel={labels.required}>
          {({ inputId }) => (
            <Input
              id={inputId}
              dir="ltr"
              maxLength={NAME_MAX}
              value={nameEn}
              onChange={(event) => {
                setNameEn(event.target.value);
                touch();
              }}
              disabled={busy}
              data-testid="brand-name-en"
            />
          )}
        </Field>

        {/* A description is a sentence. It keeps the full row. */}
        <div className="sm:col-span-2">
          <Field label={labels.shortDescriptionAr}>
            {({ inputId }) => (
              <Textarea
                id={inputId}
                dir="rtl"
                rows={2}
                maxLength={DESCRIPTION_MAX}
                value={descriptionAr}
                onChange={(event) => {
                  setDescriptionAr(event.target.value);
                  touch();
                }}
                disabled={busy}
                data-testid="brand-description-ar"
              />
            )}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={labels.shortDescriptionEn}>
            {({ inputId }) => (
              <Textarea
                id={inputId}
                dir="ltr"
                rows={2}
                maxLength={DESCRIPTION_MAX}
                value={descriptionEn}
                onChange={(event) => {
                  setDescriptionEn(event.target.value);
                  touch();
                }}
                disabled={busy}
                data-testid="brand-description-en"
              />
            )}
          </Field>
        </div>
      </div>

      <p className="text-sm text-content-muted">{labels.hint}</p>

      {failure ? (
        <p role="alert" className="text-sm text-danger">
          {labels.errorTitle}: {root(failure.messageKey)}
          {failure.requestId ? (
            <span className="block font-mono text-xs text-content-muted">
              {labels.requestIdLabel} {failure.requestId}
            </span>
          ) : null}
        </p>
      ) : null}

      {saved ? (
        <p role="status" className="text-sm text-success">
          {labels.saved}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={busy} data-testid="brand-identity-save">
          {busy ? labels.working : labels.save}
        </Button>
      </div>
    </form>
  );
}
