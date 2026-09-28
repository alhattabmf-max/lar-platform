"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BRAND_ASSET_CONTENT_TYPES,
  BRAND_ASSET_LOCALES,
  BRAND_LOGO_LIMITS,
  ERROR_CODES,
  type BrandAssetAdminItem,
  type BrandAssetLocale,
  type BrandAssetsAdminView,
  type ErrorCode,
} from "@platform/types";
import { apiClient, uploadFile } from "@/lib/api-client";
import { isApiError } from "@/lib/errors";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { mediaUrl } from "@/lib/media-url";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { StatusBadge } from "@/components/trader/status-badge";

/**
 * The header logo, one per language, inside the identity screen.
 *
 * NOT ITS OWN PAGE and not its own nav entry: a logo is part of the
 * identity, and a separate screen would mean an operator changing the
 * brand has to visit two places and remember both.
 *
 * BOTH LANGUAGES OR NEITHER. Publishing is refused unless every
 * language has artwork, because a header showing a new Arabic mark
 * beside an old English one — or beside a blank — is not a state
 * anyone chose. Deleting removes the pair for the same reason.
 *
 * UPLOADING IS NOT PUBLISHING. A replacement can be uploaded and looked
 * at without any visitor seeing it; the public route serves only what
 * has been published. That is what makes preparing a new identity safe.
 *
 * THE PREVIEW IS A TEST, NOT A DECORATION. "Present" used to be a badge
 * the server printed from a row it had written — which stayed green
 * while every operator saw a broken image, because the bytes were being
 * fetched and then discarded by the browser. The preview now reports
 * whether it actually RENDERED, and publishing is refused until it has:
 * a mark nobody can see is not one to put in front of visitors.
 *
 * FAILURES ARE NAMED BY THE STAGE THEY HAPPENED AT. "The submitted data
 * is not valid" for four different problems is what sent the last
 * investigation looking at the file when the file was fine.
 *
 * NO NAME ANYWHERE. The header renders the logo or a blank placeholder;
 * `nameAr` and `nameEn` are not read here and are not a fallback.
 */

/**
 * The numbers every logo message interpolates.
 *
 * Passed on EVERY message render, including the generic ones. next-intl
 * ignores values a message does not use, and a message that does use one
 * throws when it is missing — so passing them always is what stops a
 * refusal from turning into a blank panel.
 */
const LIMIT_VALUES = {
  maxMb: BRAND_LOGO_LIMITS.maxSizeBytes / (1024 * 1024),
  minWidth: BRAND_LOGO_LIMITS.minWidth,
  minHeight: BRAND_LOGO_LIMITS.minHeight,
};

/**
 * Which step of the job went wrong.
 *
 * The four are genuinely different repairs: a rejected FILE is fixed by
 * exporting another one; a failed SAVE is a server or storage problem
 * and the same file will work on a retry; a failed PREVIEW means the
 * bytes are stored but not reaching the screen; a failed PUBLISH leaves
 * everything staged and only the last step to redo.
 */
type Stage = "upload" | "save" | "preview" | "publish" | "delete";

/**
 * The codes that mean THE FILE was refused.
 *
 * Anything else coming back from an upload — a 500, a storage timeout,
 * a row that would not write — means the file was acceptable and the
 * system was not, which is a different sentence to show and a different
 * thing to do about it.
 */
const FILE_REFUSAL_CODES = new Set<ErrorCode>([
  ERROR_CODES.BRAND_LOGO_TOO_LARGE,
  ERROR_CODES.BRAND_LOGO_TOO_MANY_PIXELS,
  ERROR_CODES.BRAND_LOGO_TYPE_UNSUPPORTED,
  ERROR_CODES.BRAND_LOGO_TOO_SMALL,
  ERROR_CODES.VALIDATION_FAILED,
]);

export interface BrandLogoManagerLabels {
  present: string;
  missing: string;
  publish: string;
  published: string;
  unpublished: string;
  publishNeedsBoth: string;
  deleteSet: string;
  deletePrompt: string;
  deleteConfirm: string;
  cancel: string;
  working: string;
  errorTitle: string;
  requestIdLabel: string;
}

interface Failure {
  stage: Stage;
  /** Absent for a preview failure, which the server never hears about. */
  error: UserFacingError | null;
  locale?: BrandAssetLocale;
}

export function BrandLogoManager({
  view,
  labels,
}: {
  view: BrandAssetsAdminView;
  labels: BrandLogoManagerLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [asking, setAsking] = useState(false);

  // Which languages have a preview that did NOT render. Empty is the
  // healthy state, and it is what gates publishing.
  const [unrenderable, setUnrenderable] = useState<BrandAssetLocale[]>([]);

  function markPreview(locale: BrandAssetLocale, rendered: boolean) {
    setUnrenderable((current) => {
      const without = current.filter((entry) => entry !== locale);
      return rendered ? without : [...without, locale];
    });
    if (rendered) {
      // Clear a preview failure the moment the picture appears, so a
      // retry that works does not leave a stale warning behind.
      setFailure((current) =>
        current?.stage === "preview" && current.locale === locale
          ? null
          : current,
      );
    } else {
      setFailure({ stage: "preview", error: null, locale });
    }
  }

  async function run(stage: Stage, work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await work();
      setBusy(false);
      router.refresh();
    } catch (error) {
      // An upload has two distinct outcomes worth telling apart: the
      // file was refused, or the file was fine and storing it failed.
      const actual: Stage =
        stage === "upload" &&
        !(isApiError(error) && FILE_REFUSAL_CODES.has(error.code))
          ? "save"
          : stage;
      setFailure({ stage: actual, error: toUserFacingError(error) });
      setBusy(false);
    }
  }

  const byLocale = new Map(view.assets.map((asset) => [asset.locale, asset]));

  // Every language present AND every preview rendered. The server's own
  // check still runs on publish; this is the half that can see the
  // browser.
  const previewsHealthy = unrenderable.length === 0;
  const canPublish = view.complete && previewsHealthy;

  const publishBlockedBecause = !view.complete
    ? labels.publishNeedsBoth
    : !previewsHealthy
      ? root("admin.branding.logoPublishNeedsPreview")
      : undefined;

  return (
    <div className="flex flex-col gap-4" data-testid="brand-logo-manager">
      <p className="text-sm text-content-muted">
        {root("admin.branding.logoConstraints", LIMIT_VALUES)}
      </p>

      {/* Side by side on a desktop, stacked on a phone — one grid, no
          media-query branch in the markup. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {BRAND_ASSET_LOCALES.map((locale) => (
          <LogoSlot
            key={locale}
            locale={locale}
            asset={byLocale.get(locale)}
            busy={busy}
            labels={labels}
            unrenderable={unrenderable.includes(locale)}
            onPreviewResult={(rendered) => markPreview(locale, rendered)}
            onPick={(file) =>
              run("upload", () =>
                uploadFile(
                  `/admin/branding/logo?locale=${encodeURIComponent(locale)}`,
                  file,
                ),
              )
            }
          />
        ))}
      </div>

      {failure ? <FailureNotice failure={failure} labels={labels} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge
          label={view.published ? labels.published : labels.unpublished}
          tone={view.published ? "done" : "neutral"}
        />

        {/* Refused WITH the reason, not just disabled: a control that
            does nothing and says nothing is the same as a broken one. */}
        <Button
          type="button"
          size="sm"
         
          data-testid="brand-logo-publish"
          isLoading={busy}
          disabled={busy || !canPublish}
          title={publishBlockedBecause}
          onClick={() =>
            run("publish", () =>
              apiClient.post("/admin/branding/logo/publish", {}),
            )
          }
        >
          {labels.publish}
        </Button>

        {view.assets.length > 0 && !asking ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
           
            data-testid="brand-logo-delete"
            disabled={busy}
            onClick={() => setAsking(true)}
          >
            {labels.deleteSet}
          </Button>
        ) : null}
      </div>

      {/* Staged but not live. Said explicitly, because "uploaded" and
          "visible to visitors" are two different things here and the
          gap between them is the whole point of the two-step design. */}
      {view.assets.length > 0 && !view.published ? (
        <p
          role="status"
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-content-muted"
          data-testid="brand-logo-draft-notice"
        >
          {root("admin.branding.logoDraftNotice")}
        </p>
      ) : null}

      {asking ? (
        <div
          className="flex flex-col gap-2 rounded-md border border-danger bg-surface p-3"
          data-testid="brand-logo-delete-confirm"
        >
          {/* Asked in the page, never through `window.confirm`: a native
              dialog cannot be translated, ignores the document's RTL
              direction, and a browser may suppress it outright. */}
          <p role="status" aria-live="polite" className="text-sm text-content">
            {labels.deletePrompt}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
             
              isLoading={busy}
              disabled={busy}
              data-testid="brand-logo-delete-confirmed"
              onClick={() =>
                void run("delete", async () => {
                  await apiClient.delete("/admin/branding/logo");
                  setAsking(false);
                })
              }
            >
              {labels.deleteConfirm}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
             
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              {labels.cancel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What went wrong, named by the step it went wrong at.
 *
 * Two lines rather than one: the STAGE, which is the same sentence
 * every time and tells the operator which part of the job to redo, and
 * the server's own reason underneath it when there is one. A preview
 * failure has no server reason at all — the request succeeded and the
 * browser refused the result — so it carries a hint instead.
 */
function FailureNotice({
  failure,
  labels,
}: {
  failure: Failure;
  labels: BrandLogoManagerLabels;
}) {
  const root = useTranslations();

  const STAGE_KEY: Record<Stage, string> = {
    upload: "admin.branding.logoStageUpload",
    save: "admin.branding.logoStageSave",
    preview: "admin.branding.logoStagePreview",
    publish: "admin.branding.logoStagePublish",
    delete: "admin.branding.logoStageDelete",
  };

  const localeName = failure.locale
    ? root(`admin.branding.logoLocale.${failure.locale}`)
    : // Only the preview message interpolates it, and the preview
      // failure always carries a language.
      "";

  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-md border border-danger p-3"
      data-testid="brand-logo-failure"
    >
      <p
        className="text-sm font-medium text-content"
        data-testid="brand-logo-stage"
      >
        {root(STAGE_KEY[failure.stage], { locale: localeName })}
      </p>

      <p className="text-sm text-content-muted" data-testid="brand-logo-error">
        {failure.error
          ? root(failure.error.messageKey, LIMIT_VALUES)
          : root("admin.branding.logoPreviewFailedHint")}
      </p>

      {failure.error?.requestId ? (
        <p className="text-xs text-content-muted">
          {labels.requestIdLabel}:{" "}
          <span className="font-mono">{failure.error.requestId}</span>
        </p>
      ) : null}
    </div>
  );
}

/** One language: its preview, its state, and its upload control. */
function LogoSlot({
  locale,
  asset,
  busy,
  labels,
  unrenderable,
  onPick,
  onPreviewResult,
}: {
  locale: BrandAssetLocale;
  asset: BrandAssetAdminItem | undefined;
  busy: boolean;
  labels: BrandLogoManagerLabels;
  unrenderable: boolean;
  onPick: (file: File) => void;
  onPreviewResult: (rendered: boolean) => void;
}) {
  const root = useTranslations();
  const inputId = useId();

  // NAMED BY LANGUAGE, on the control itself: «رفع الشعار العربي», not
  // «رفع الشعار» twice over. Two identical buttons side by side make an
  // operator work out which is which from their position on the screen.
  const localeName = root(`admin.branding.logoLocale.${locale}`);
  const uploadLabel = root("admin.branding.logoUploadFor", {
    locale: localeName,
  });
  const replaceLabel = root("admin.branding.logoReplace", {
    locale: localeName,
  });

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared immediately: picking the SAME file twice must fire
    // `change` again, which it will not if the input still holds it.
    event.target.value = "";
    if (file) onPick(file);
  }

  // THE PREVIEW URL CHANGES WHEN THE ARTWORK DOES. The route is the same
  // for every version of a language's logo and answers with an ETag and
  // cache headers, so a replacement would otherwise show the picture it
  // just replaced — the operator would look at the old mark and believe
  // the upload silently failed. `updatedAt` is already on the row, so
  // this needs nothing new from the server.
  const previewSrc = asset
    ? mediaUrl(
        `/api/v1/admin/branding/logo/image?locale=${encodeURIComponent(locale)}` +
          `&variant=thumb&v=${encodeURIComponent(asset.updatedAt)}`,
      )
    : null;

  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-line p-3"
      data-testid={`brand-logo-slot-${locale}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={inputId}>{uploadLabel}</Label>
        <StatusBadge
          label={
            unrenderable
              ? labels.missing
              : asset
                ? labels.present
                : labels.missing
          }
          tone={asset && !unrenderable ? "done" : "neutral"}
        />
      </div>

      {previewSrc ? (
        // A plain <img>: an API route on another origin, and the route
        // already emits a resized thumbnail. Decorative — the language
        // is named above it.
        //
        // `onLoad`/`onError` are what make this a CHECK rather than a
        // decoration: a request that returns 200 and is then discarded
        // by the browser — a missing CORP header, a body that is not an
        // image — reaches `onError`, and nothing else in this screen
        // can see that happen.
        <img
          key={asset?.updatedAt}
          src={previewSrc}
          alt=""
          aria-hidden="true"
          decoding="async"
          data-testid={`brand-logo-preview-${locale}`}
          className={
            unrenderable ? "hidden" : "h-12 w-auto max-w-full object-contain"
          }
          onLoad={() => onPreviewResult(true)}
          onError={() => onPreviewResult(false)}
        />
      ) : null}

      {previewSrc && unrenderable ? (
        <div
          className="flex h-12 items-center justify-center rounded border border-dashed border-danger px-2 text-xs text-content-muted"
          data-testid={`brand-logo-preview-failed-${locale}`}
        >
          {root("admin.branding.logoStagePreview", { locale: localeName })}
        </div>
      ) : null}

      {!previewSrc ? (
        <div
          className="flex h-12 items-center justify-center rounded border border-dashed border-line-control text-xs text-content-muted"
          data-testid={`brand-logo-empty-${locale}`}
        >
          {labels.missing}
        </div>
      ) : null}

      <label
        className="inline-flex cursor-pointer items-center justify-center rounded-md border border-line px-3 py-2 text-sm text-content hover:bg-surface-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2"
        data-testid={`brand-logo-picker-${locale}`}
      >
        {asset ? replaceLabel : uploadLabel}
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept={BRAND_ASSET_CONTENT_TYPES.join(",")}
          disabled={busy}
          onChange={onFile}
        />
      </label>
    </div>
  );
}
