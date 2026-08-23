"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BRAND_THEME_COLOR_KEYS,
  type BrandThemeAdminView,
  type BrandThemeColorKey,
  type BrandThemeColors,
} from "@platform/types";
import { apiClient } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * The site's four brand colours: draft, check, publish.
 *
 * THREE STEPS, NOT ONE. Saving a draft changes nothing a visitor sees;
 * publishing is what goes live. That separation exists because a colour
 * with poor contrast makes text unreadable for everyone who lands on the
 * site, and the draft is where that gets caught.
 *
 * THE CONTRAST VERDICT COMES FROM THE SERVER, which is the code that
 * will refuse to publish a failing palette. Recomputing it here would be
 * a second implementation of a WCAG ratio, and the day the two disagree
 * the screen would promise a publish that then fails.
 *
 * Each colour has BOTH a colour picker and a text field, bound to the
 * same value. The picker is faster; the text field is the only way to
 * paste a brand hex from a style guide, and the only one a screen reader
 * user can operate meaningfully.
 *
 * RESET restores the shipped defaults. It asks first, because it discards
 * whatever the draft held.
 */
const HEX = /^#[0-9A-Fa-f]{6}$/;

export interface BrandThemeEditorLabels {
  colorLabel: (key: BrandThemeColorKey) => string;
  draftTitle: string;
  activeTitle: string;
  noDraft: string;
  contrastPasses: string;
  contrastFails: string;
  /** e.g. "Accent against its background: 3.10, needs 4.50". */
  issueContrast: (key: string, ratio: number, required: number) => string;
  /** A colour the server could not parse at all. */
  issueFormat: (key: string) => string;
  saveDraft: string;
  publish: string;
  publishPrompt: string;
  reset: string;
  resetPrompt: string;
  confirm: string;
  cancel: string;
  working: string;
  saved: string;
  invalidHex: string;
  errorTitle: string;
  requestIdLabel: string;
}

export function BrandThemeEditor({
  view,
  labels,
}: {
  view: BrandThemeAdminView;
  labels: BrandThemeEditorLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  // Seeded from the DRAFT when one exists, otherwise from what is live.
  // Starting from the defaults instead would quietly offer to overwrite
  // a published palette with colours nobody chose.
  const [colors, setColors] = useState<BrandThemeColors>(
    () => view.draft?.colors ?? view.active
  );
  const [asking, setAsking] = useState<"publish" | "reset" | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const allValid = BRAND_THEME_COLOR_KEYS.every((key) => HEX.test(colors[key]));

  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    setSaved(false);
    try {
      await work();
      setSaved(true);
      setAsking(null);
      setBusy(false);
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
      setBusy(false);
    }
  }

  function set(key: BrandThemeColorKey, value: string) {
    setColors((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  const draftVerdict = view.draft?.validation;
  const activeVerdict = view.activeValidation;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {BRAND_THEME_COLOR_KEYS.map((key) => {
          const value = colors[key];
          const valid = HEX.test(value);

          return (
            <div key={key} className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-${key}-text`}>{labels.colorLabel(key)}</Label>
              <div className="flex flex-wrap items-center gap-2">
                {/* Rendered only while the text value is a real colour.
                    A native colour input demands a valid value, so an
                    invalid hex would need a literal fallback here — and
                    a black swatch beside a field the reader has typed
                    wrongly reads as the colour they chose. It is also
                    the one thing that would put a hard-coded colour in a
                    component, which this codebase does not do.

                    The picker is an alternative input for the labelled
                    field beside it, not a control of its own, so it is
                    hidden from the accessibility tree rather than
                    announced twice. */}
                {valid ? (
                  <input
                    type="color"
                    aria-hidden="true"
                    tabIndex={-1}
                    value={value}
                    onChange={(event) => set(key, event.target.value.toUpperCase())}
                    className="h-11 w-14 rounded-md border border-line"
                  />
                ) : null}
                <Input
                  id={`${ids}-${key}-text`}
                  value={value}
                  dir="ltr"
                  maxLength={7}
                  invalid={!valid}
                  describedById={valid ? undefined : `${ids}-${key}-error`}
                  onChange={(event) => set(key, event.target.value.toUpperCase())}
                  className="w-32 font-mono"
                />
              </div>
              {!valid ? (
                <p id={`${ids}-${key}-error`} role="alert" className="text-xs text-danger-text">
                  {labels.invalidHex}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-md border border-line bg-surface p-3">
          <p className="text-sm font-medium text-content">{labels.activeTitle}</p>
          <StatusBadge
            label={activeVerdict.valid ? labels.contrastPasses : labels.contrastFails}
            tone={activeVerdict.valid ? "done" : "attention"}
          />
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-line bg-surface p-3">
          <p className="text-sm font-medium text-content">{labels.draftTitle}</p>
          {draftVerdict ? (
            <>
              <StatusBadge
                label={draftVerdict.valid ? labels.contrastPasses : labels.contrastFails}
                tone={draftVerdict.valid ? "done" : "attention"}
              />
              {/* WHICH pair failed, and by how much. "Contrast fails"
                  alone leaves an operator changing colours at random;
                  the measured ratio against the required one tells them
                  which way to move and how far. */}
              {draftVerdict.issues.length > 0 ? (
                <ul className="mt-2 flex list-none flex-col gap-1">
                  {draftVerdict.issues.map((issue) => (
                    <li key={`${issue.key}:${issue.code}`} className="text-xs text-warning-text">
                      {issue.ratio !== undefined && issue.required !== undefined
                        ? labels.issueContrast(issue.key, issue.ratio, issue.required)
                        : labels.issueFormat(issue.key)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-content-muted">{labels.noDraft}</p>
          )}
        </div>
      </div>

      {failure ? (
        <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger p-3">
          <p className="text-sm font-medium text-content">{labels.errorTitle}</p>
          <p className="text-sm text-content-muted">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-xs text-content-muted">
              {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {saved ? (
        <p role="status" className="text-sm text-content">
          {labels.saved}
        </p>
      ) : null}

      {asking !== null ? (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
          <p role="status" aria-live="polite" className="text-sm text-content">
            {asking === "publish" ? labels.publishPrompt : labels.resetPrompt}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={asking === "reset" ? "danger" : "primary"}
              size="sm"
              className="min-h-11"
              isLoading={busy}
              disabled={busy}
              onClick={() =>
                run(() =>
                  apiClient.post(
                    asking === "publish"
                      ? "/admin/branding/theme/publish"
                      : "/admin/branding/theme/reset"
                  )
                )
              }
            >
              {busy ? labels.working : labels.confirm}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              disabled={busy}
              onClick={() => setAsking(null)}
            >
              {labels.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-h-11"
            isLoading={busy}
            disabled={busy || !allValid}
            onClick={() => run(() => apiClient.put("/admin/branding/theme/draft", colors))}
          >
            {busy ? labels.working : labels.saveDraft}
          </Button>

          {/* Publish is offered only when a draft EXISTS. Publishing
              with nothing saved would republish what is already live —
              a button that appears to do something and does not. */}
          {view.draft ? (
            <Button
              type="button"
              variant="secondary"
              className="min-h-11"
              disabled={busy}
              onClick={() => setAsking("publish")}
            >
              {labels.publish}
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            disabled={busy}
            onClick={() => setAsking("reset")}
          >
            {labels.reset}
          </Button>
        </div>
      )}
    </div>
  );
}
