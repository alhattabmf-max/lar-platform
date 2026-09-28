"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BANNER_IMAGE_LOCALES,
  formatAspectRatio,
  hasEveryBannerImage,
  type BannerImageLocale,
  type BannerImageShape,
} from "@platform/types";
import { apiClient, uploadFile } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { mediaUrl } from "@/lib/media-url";
import { measureImageFile, rejectionFor } from "@/lib/banner-image-file";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { StatusBadge } from "@/components/trader/status-badge";
import type { AdminBannerRow } from "@/lib/admin-data";

/**
 * The content types the banner image pipeline actually stores —
 * `EXTENSION_BY_CONTENT_TYPE` in `apps/api/src/banners/banner-image.service.ts`
 * and the processor's own encoder list. Used for the file picker's
 * `accept`, so the operator is not offered a format the server will
 * reject.
 *
 * NO SIZE LIMIT IS STATED. The maximum is admin-configurable
 * (`BannerPolicyService.maxSizeBytes`) and no endpoint exposes it to
 * this client, so any number printed here would be invented. The server
 * refuses an oversized file and its refusal is what the operator sees.
 */
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const LINK_MAX = 2048;

/**
 * Promotional banners for one placement.
 *
 * A BANNER IS ARTWORK, ONE PICTURE PER LANGUAGE, AND NOTHING ELSE.
 * There is no title, body or description to write: every word a visitor
 * reads is drawn inside the image. This screen used to ask for four
 * text fields that were never displayed anywhere — the Arabic title was
 * quietly used as alt text and the rest were stored and ignored. They
 * are gone, and the accessible description is now a translated constant
 * in the public component.
 *
 * BOTH LANGUAGES BEFORE IT CAN GO LIVE. An Arabic reader is never shown
 * English artwork and never shown an empty frame, so a banner missing
 * either image cannot be activated. The activate button says so rather
 * than failing on the server.
 *
 * ORDER IS REARRANGED WITH BUTTONS, operable from the keyboard. Drag and
 * drop is not offered as the only way to do this: it is unusable with a
 * keyboard, unreliable with a screen reader, and awkward on a touch
 * screen. Each move announces itself and focus follows the row that
 * moved, so an operator can press the same key repeatedly without
 * hunting for where the item went.
 *
 * REORDERING IS SAVED EXPLICITLY. The arrows change a local order and
 * the save button sends the whole sequence to `POST /admin/banners/reorder`,
 * which the server applies under an advisory lock for the placement.
 */
export interface BannerManagerLabels {
  createLegend: string;
  linkUrl: string;
  linkHint: string;
  create: string;

  // moveUp / moveDown / stateLabel are NOT here. They need a runtime
  // argument (a position, a state), and a function cannot cross the
  // server/client boundary — React has to serialize these props, and
  // passing one throws "Functions cannot be passed directly to Client
  // Components", which renders the whole page as a server-side
  // exception. This component is already a client component holding a
  // `useTranslations()` translator, so it resolves those itself.
  saveOrder: string;
  orderChanged: string;
  orderSaved: string;

  activate: string;
  deactivate: string;
  scheduleFrom: string;
  scheduleTo: string;
  saveSchedule: string;
  scheduleHint: string;

  working: string;
  required: string;
  empty: string;
  errorTitle: string;
  requestIdLabel: string;
}

/** A file the operator has chosen, already measured and accepted. */
interface PickedArtwork {
  file: File;
  /** Object URL for the crop preview. The holder revokes it. */
  url: string;
}

export function BannerManager({
  placement,
  banners,
  labels,
  imageShape,
}: {
  placement: string;
  banners: readonly AdminBannerRow[];
  labels: BannerManagerLabels;
  /**
   * The shape the policy enforces RIGHT NOW, resolved by the page.
   *
   * Passed in rather than imported so this component has no opinion
   * about the numbers — an admin who widens the band changes what this
   * screen accepts without a deploy.
   */
  imageShape: BannerImageShape;
}) {
  const router = useRouter();
  const root = useTranslations();
  const ids = useId();

  const [order, setOrder] = useState<AdminBannerRow[]>(() => [...banners]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // The server is the source of truth for order. When a refresh brings
  // new rows in, the local arrangement is replaced — otherwise an
  // operator would keep editing a list that no longer matches what was
  // saved, including by a colleague.
  useEffect(() => {
    setOrder([...banners]);
    setDirty(false);
  }, [banners]);

  const [picked, setPicked] = useState<
    Partial<Record<BannerImageLocale, PickedArtwork>>
  >({});
  const [linkUrl, setLinkUrl] = useState("");

  // BOTH pictures before the button does anything. A banner with one
  // language is a draft nobody can publish, so asking for both up front
  // is kinder than accepting half and refusing later.
  const canCreate = BANNER_IMAGE_LOCALES.every(
    (locale) => picked[locale] !== undefined,
  );

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

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;

    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    setOrder(next);
    setDirty(true);
    setAnnouncement(labels.orderChanged);

    // Focus follows the row that moved. `scrollIntoView` is
    // optional-called because jsdom does not implement it, and a test
    // environment must not be the reason a real interaction throws.
    queueMicrotask(() => {
      const button = document.getElementById(
        `${ids}-${delta < 0 ? "up" : "down"}-${target}`,
      );
      button?.focus();
      button?.scrollIntoView?.({ block: "nearest" });
    });
  }

  /**
   * Create the row, then upload each picture onto it.
   *
   * THE ROW MUST EXIST FIRST: an upload is addressed to a banner id, so
   * there is nothing to upload onto until it does.
   *
   * A FAILURE PART-WAY LEAVES A SAFE DRAFT, deliberately, rather than
   * rolling the banner back. The banner is created inactive and cannot
   * be activated until both languages are present, so a half-uploaded
   * banner is invisible to every visitor — it sits in this list with
   * its missing language named, and the operator finishes it or deletes
   * it. Undoing instead would throw away the upload that DID succeed
   * and make the operator repeat it.
   */
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreate) return;

    await run(async () => {
      const created = await apiClient.post<{ id: string }>("/admin/banners", {
        placement,
        linkUrl: linkUrl.trim() === "" ? null : linkUrl.trim(),
      });

      for (const locale of BANNER_IMAGE_LOCALES) {
        const artwork = picked[locale];
        if (!artwork) continue;
        await uploadFile(
          `/admin/banners/${created.id}/image?locale=${encodeURIComponent(locale)}`,
          artwork.file,
        );
      }

      for (const artwork of Object.values(picked)) {
        if (artwork) URL.revokeObjectURL(artwork.url);
      }
      setPicked({});
      setLinkUrl("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={create}
        className="flex flex-col gap-3 rounded-card bg-surface shadow-card px-card-x py-card-y"
        noValidate
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="px-1 text-base font-medium text-content">
            {labels.createLegend}
          </legend>

          <div className="grid gap-3 sm:grid-cols-2">
            {BANNER_IMAGE_LOCALES.map((locale) => (
              <ArtworkPicker
                key={locale}
                locale={locale}
                shape={imageShape}
                picked={picked[locale] ?? null}
                busy={busy}
                requiredLabel={labels.required}
                onPick={(artwork) =>
                  setPicked((current) => {
                    const previous = current[locale];
                    if (previous) URL.revokeObjectURL(previous.url);
                    return { ...current, [locale]: artwork };
                  })
                }
                onClear={() =>
                  setPicked((current) => {
                    const previous = current[locale];
                    if (previous) URL.revokeObjectURL(previous.url);
                    const next = { ...current };
                    delete next[locale];
                    return next;
                  })
                }
              />
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-link`}>{labels.linkUrl}</Label>
            <Input
              id={`${ids}-link`}
              dir="ltr"
              maxLength={LINK_MAX}
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
            />
          </div>

          <div>
            <Button
              type="submit"
              size="sm"
             
              isLoading={busy}
              disabled={busy || !canCreate}
            >
              {busy ? labels.working : labels.create}
            </Button>
          </div>
        </fieldset>
      </form>

      {failure ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-danger p-3"
        >
          <p className="text-sm font-medium text-content">
            {labels.errorTitle}
          </p>
          <p className="text-sm text-content-muted">
            {root(failure.messageKey)}
          </p>
          {failure.requestId ? (
            <p className="text-xs text-content-muted">
              {labels.requestIdLabel}:{" "}
              <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Every reorder is announced. A visual list re-rendering silently
          tells a screen-reader user nothing at all. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {order.length === 0 ? (
        <p className="text-sm text-content-muted">{labels.empty}</p>
      ) : (
        <ol className="flex list-none flex-col gap-3">
          {order.map((banner, index) => {
            const complete = hasEveryBannerImage(banner.images);
            const missing = BANNER_IMAGE_LOCALES.filter(
              (locale) => !banner.images.includes(locale),
            );

            return (
              <li
                key={banner.id}
                className="rounded-md border border-line bg-surface p-3"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={root(`admin.vocab.bannerState.${banner.state}`)}
                      tone={banner.state === "LIVE" ? "done" : "neutral"}
                    />
                    {missing.length > 0 ? (
                      <span className="text-xs text-content-muted">
                        {root("admin.banners.missingArtwork", {
                          locales: missing
                            .map((locale) =>
                              root(`admin.banners.locale.${locale}`),
                            )
                            .join("، "),
                        })}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {BANNER_IMAGE_LOCALES.map((locale) => (
                      <BannerArtwork
                        key={locale}
                        banner={banner}
                        locale={locale}
                        busy={busy}
                        run={run}
                        shape={imageShape}
                      />
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      id={`${ids}-up-${index}`}
                      variant="ghost"
                      size="sm"
                     
                      disabled={busy || index === 0}
                      aria-label={root("admin.banners.moveUpAt", {
                        position: index + 1,
                      })}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      id={`${ids}-down-${index}`}
                      variant="ghost"
                      size="sm"
                     
                      disabled={busy || index === order.length - 1}
                      aria-label={root("admin.banners.moveDownAt", {
                        position: index + 1,
                      })}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </Button>

                    {/* Activation is refused with BOTH the reason and the
                        control: a disabled button with no explanation is
                        the same as a broken one. */}
                    <Button
                      type="button"
                      variant={banner.isActive ? "danger" : "primary"}
                      size="sm"
                     
                      data-testid={`banner-toggle-${banner.id}`}
                      disabled={busy || (!banner.isActive && !complete)}
                      title={
                        !banner.isActive && !complete
                          ? root("admin.banners.activateNeedsBoth")
                          : undefined
                      }
                      onClick={() =>
                        run(() =>
                          apiClient.post(`/admin/banners/${banner.id}/toggle`, {
                            isActive: !banner.isActive,
                          }),
                        )
                      }
                    >
                      {banner.isActive ? labels.deactivate : labels.activate}
                    </Button>

                    <BannerDelete
                      bannerId={banner.id}
                      position={index + 1}
                      busy={busy}
                      run={run}
                    />
                  </div>

                  <BannerSchedule
                    bannerId={banner.id}
                    startsAt={banner.startsAt}
                    endsAt={banner.endsAt}
                    busy={busy}
                    labels={labels}
                    onSave={(payload) =>
                      run(() =>
                        apiClient.post(
                          `/admin/banners/${banner.id}/schedule`,
                          payload,
                        ),
                      )
                    }
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {dirty ? (
        <div>
          <Button
            type="button"
           
            isLoading={busy}
            disabled={busy}
            onClick={() =>
              run(async () => {
                await apiClient.post("/admin/banners/reorder", {
                  placement,
                  bannerIds: order.map((banner) => banner.id),
                });
                setDirty(false);
                setAnnouncement(labels.orderSaved);
              })
            }
          >
            {busy ? labels.working : labels.saveOrder}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Picks and checks one language's artwork BEFORE the banner exists.
 *
 * The shape check runs here for the same reason it runs on the card:
 * telling someone their picture is the wrong proportion is worth doing
 * before they submit a form, not after. It is a courtesy and never a
 * boundary — the server measures every upload again.
 */
function ArtworkPicker({
  locale,
  shape,
  picked,
  busy,
  requiredLabel,
  onPick,
  onClear,
}: {
  locale: BannerImageLocale;
  shape: BannerImageShape;
  picked: PickedArtwork | null;
  busy: boolean;
  requiredLabel: string;
  onPick: (artwork: PickedArtwork) => void;
  onClear: () => void;
}) {
  const root = useTranslations();
  const inputId = useId();
  const [refusal, setRefusal] = useState<string | null>(null);

  function describe(
    rejection: NonNullable<ReturnType<typeof rejectionFor>>,
  ): string {
    // The numbers come from the SHAPE IN FORCE, not from the message
    // catalogue — a translated string that hard-coded "1500x300" would
    // start lying the moment an admin changed the policy.
    if (rejection.reason === "TOO_SMALL") {
      return root("admin.banners.shapeTooSmall", {
        width: rejection.width,
        height: rejection.height,
        minWidth: shape.minWidth,
        minHeight: shape.minHeight,
      });
    }
    return root(
      rejection.reason === "TOO_TALL"
        ? "admin.banners.shapeTooTall"
        : "admin.banners.shapeTooWide",
      {
        width: rejection.width,
        height: rejection.height,
        ratio: formatAspectRatio(rejection.ratio),
        min: formatAspectRatio(shape.minAspectRatio),
        max: formatAspectRatio(shape.maxAspectRatio),
        preferred: formatAspectRatio(shape.preferredAspectRatio),
      },
    );
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear immediately: picking the SAME file twice must fire `change`
    // again, which it will not if the input still holds it.
    event.target.value = "";
    if (!file) return;

    setRefusal(null);

    const measured = await measureImageFile(file);
    if (!measured) {
      // No local opinion — this browser could not measure or preview
      // the file. It goes to the server, which decides.
      onPick({ file, url: "" });
      return;
    }

    const rejection = rejectionFor(measured, shape);
    if (rejection) {
      URL.revokeObjectURL(measured.previewUrl);
      setRefusal(describe(rejection));
      return;
    }

    onPick({ file, url: measured.previewUrl });
  }

  const localeName = root(`admin.banners.locale.${locale}`);

  return (
    <div
      className="flex flex-col gap-2"
      data-testid={`artwork-picker-${locale}`}
    >
      <Label htmlFor={inputId} required requiredLabel={requiredLabel}>
        {root("admin.banners.artworkFor", { locale: localeName })}
      </Label>

      {picked?.url ? (
        <div
          className="w-full overflow-hidden rounded border border-line"
          style={{ aspectRatio: String(shape.preferredAspectRatio) }}
          data-testid={`artwork-preview-${locale}`}
        >
          <img
            src={picked.url}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label
          className="inline-flex cursor-pointer items-center rounded-md border border-line px-3 py-2 text-sm text-content hover:bg-surface-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2"
          data-testid={`artwork-input-${locale}`}
        >
          {picked
            ? root("admin.banners.replaceImage")
            : root("admin.banners.uploadImage")}
          <input
            id={inputId}
            type="file"
            className="sr-only"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            disabled={busy}
            onChange={(event) => void onFile(event)}
          />
        </label>

        {picked ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
           
            disabled={busy}
            onClick={onClear}
          >
            {root("common.cancel")}
          </Button>
        ) : null}
      </div>

      <span className="text-xs text-content-muted">
        {root("admin.banners.imageShapeHint", {
          preferred: formatAspectRatio(shape.preferredAspectRatio),
          min: formatAspectRatio(shape.minAspectRatio),
          max: formatAspectRatio(shape.maxAspectRatio),
          minWidth: shape.minWidth,
          minHeight: shape.minHeight,
        })}
      </span>

      {refusal ? (
        <p
          role="alert"
          className="rounded-md border border-danger bg-surface px-3 py-2 text-sm text-danger"
          data-testid={`artwork-refusal-${locale}`}
        >
          {refusal}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One language's artwork on an EXISTING banner: what it is, and how to
 * replace it.
 *
 * Replacing one language leaves the other untouched — they are separate
 * rows on the server, and separate controls here for the same reason.
 */
function BannerArtwork({
  banner,
  locale,
  busy,
  run,
  shape,
}: {
  banner: AdminBannerRow;
  locale: BannerImageLocale;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
  shape: BannerImageShape;
}) {
  const root = useTranslations();
  const present = banner.images.includes(locale);
  const localeName = root(`admin.banners.locale.${locale}`);
  const query = `locale=${encodeURIComponent(locale)}`;

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void run(() =>
      uploadFile(`/admin/banners/${banner.id}/image?${query}`, file),
    );
  }

  return (
    <div
      className="flex flex-col gap-2"
      data-testid={`banner-artwork-${banner.id}-${locale}`}
    >
      <span className="text-xs font-medium text-content">{localeName}</span>

      {present ? (
        // A plain <img>: an API route on another origin, and the route
        // already emits a resized thumbnail, so the Next optimiser has
        // nothing to add. Decorative — the language is named above it.
        <div
          className="w-full overflow-hidden rounded border border-line"
          style={{ aspectRatio: String(shape.preferredAspectRatio) }}
        >
          <img
            src={mediaUrl(
              `/api/v1/admin/banners/${banner.id}/image?${query}&variant=thumb`,
            )}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div
          className="flex w-full items-center justify-center rounded border border-dashed border-line-control text-xs text-content-muted"
          style={{ aspectRatio: String(shape.preferredAspectRatio) }}
        >
          {root("admin.banners.noArtwork")}
        </div>
      )}

      <label
        className="inline-flex cursor-pointer items-center justify-center rounded-md border border-line px-3 py-2 text-sm text-content hover:bg-surface-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2"
        data-testid={`banner-artwork-picker-${banner.id}-${locale}`}
      >
        {present
          ? root("admin.banners.replaceImage")
          : root("admin.banners.uploadImage")}
        <input
          type="file"
          className="sr-only"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          disabled={busy}
          onChange={onFile}
        />
      </label>
    </div>
  );
}

/**
 * Removing a banner for good.
 *
 * Asks IN THE PAGE, never through `window.confirm`: a native dialog
 * cannot be translated, ignores the document's RTL direction, and a
 * browser may suppress it outright — so the confirmation could simply
 * not appear. A repo-wide test forbids it across admin.
 *
 * Separate from deactivating on purpose. Deactivating is the reversible
 * control; this one is not, so they are two different buttons rather
 * than one with a flag.
 */
function BannerDelete({
  bannerId,
  position,
  busy,
  run,
}: {
  bannerId: string;
  position: number;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const root = useTranslations();
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <Button
        type="button"
        variant="danger"
        size="sm"
       
        data-testid={`banner-delete-${bannerId}`}
        disabled={busy}
        aria-label={root("admin.banners.deleteAt", { position })}
        onClick={() => setAsking(true)}
      >
        {root("admin.banners.delete")}
      </Button>
    );
  }

  return (
    <div
      className="flex w-full flex-col gap-2 rounded-md border border-danger bg-surface p-3"
      data-testid={`banner-delete-confirm-${bannerId}`}
    >
      <p role="status" aria-live="polite" className="text-sm text-content">
        {root("admin.banners.deletePrompt")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="danger"
          size="sm"
         
          isLoading={busy}
          disabled={busy}
          data-testid={`banner-delete-confirmed-${bannerId}`}
          onClick={() =>
            void run(async () => {
              await apiClient.delete(`/admin/banners/${bannerId}`);
              setAsking(false);
            })
          }
        >
          {root("admin.banners.deleteConfirm")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
         
          disabled={busy}
          onClick={() => setAsking(false)}
        >
          {root("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * One banner's live window.
 *
 * Its own endpoint, because the update DTO deliberately rejects
 * `startsAt` and `endsAt`: scheduling is where overlap and the
 * concurrent-live limit are enforced, and letting a content edit carry a
 * window would route around those checks.
 *
 * A cleared field is sent as null — "no start date" and "starts at the
 * epoch" are very different instructions.
 */
function BannerSchedule({
  bannerId,
  startsAt,
  endsAt,
  busy,
  labels,
  onSave,
}: {
  bannerId: string;
  startsAt: string | null;
  endsAt: string | null;
  busy: boolean;
  labels: BannerManagerLabels;
  onSave: (payload: { startsAt: string | null; endsAt: string | null }) => void;
}) {
  const ids = useId();
  const [from, setFrom] = useState(() => toLocalInput(startsAt));
  const [to, setTo] = useState(() => toLocalInput(endsAt));

  useEffect(() => {
    setFrom(toLocalInput(startsAt));
    setTo(toLocalInput(endsAt));
  }, [startsAt, endsAt]);

  return (
    <div
      className="flex flex-wrap items-end gap-3"
      data-testid={`banner-schedule-${bannerId}`}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-from`}>{labels.scheduleFrom}</Label>
        <Input
          id={`${ids}-from`}
          type="datetime-local"
          value={from}
          disabled={busy}
          onChange={(event) => setFrom(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-to`}>{labels.scheduleTo}</Label>
        <Input
          id={`${ids}-to`}
          type="datetime-local"
          value={to}
          disabled={busy}
          onChange={(event) => setTo(event.target.value)}
        />
      </div>
      <Button
        type="button"
        size="sm"
       
        disabled={busy}
        onClick={() =>
          onSave({
            startsAt: from === "" ? null : new Date(from).toISOString(),
            endsAt: to === "" ? null : new Date(to).toISOString(),
          })
        }
      >
        {labels.saveSchedule}
      </Button>
      <p className="w-full text-xs text-content-muted">{labels.scheduleHint}</p>
    </div>
  );
}

/** ISO instant → the value a `datetime-local` input expects, in local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
