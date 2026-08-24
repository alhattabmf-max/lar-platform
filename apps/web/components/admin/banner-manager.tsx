"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiClient, uploadFile } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { mediaUrl } from "@/lib/media-url";
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

/**
 * Promotional banners for one placement.
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
 * which the server applies under an advisory lock for the placement. A
 * write per keypress would fire a request per arrow press and let two
 * administrators interleave partial orders.
 *
 * `linkUrl` IS free text here, and that is the API's design rather than
 * this screen's: `BannerLinkService` normalises it against a
 * server-side host allowlist and rejects anything outside it. The field
 * says so, and a rejection surfaces as the server's own refusal.
 *
 * THE IMAGE IS NOT UPLOADED HERE. It has its own endpoint with its own
 * content-type and size checks, and `hasImage` is all this contract
 * carries — the storage key is never sent to a browser.
 *
 * `state` is the SERVER's derived verdict — scheduled, live, expired —
 * computed against the database's clock. Deriving it here from `startsAt`
 * and `endsAt` against the browser's clock would disagree with the site
 * for anyone whose device time is off.
 */
export interface BannerManagerLabels {
  createLegend: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  linkUrl: string;
  linkHint: string;
  create: string;

  // moveUp / moveDown / stateLabel are NOT here. They need a runtime
  // argument (a banner title, a state), and a function cannot cross the
  // server/client boundary — React has to serialize these props, and
  // passing one throws "Functions cannot be passed directly to Client
  // Components", which renders the whole page as a server-side
  // exception. This component is already a client component holding a
  // `useTranslations()` translator, so it resolves those three itself.
  saveOrder: string;
  orderChanged: string;
  orderSaved: string;

  activate: string;
  deactivate: string;
  hasImage: string;
  noImage: string;
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

const TITLE_MAX = 120;
const BODY_MAX = 500;
const LINK_MAX = 2048;

export function BannerManager({
  placement,
  banners,
  labels,
}: {
  placement: string;
  banners: readonly AdminBannerRow[];
  labels: BannerManagerLabels;
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

  const [titleAr, setTitleAr] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [bodyAr, setBodyAr] = useState("");
  const [bodyEn, setBodyEn] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const canCreate = titleAr.trim() !== "" && titleEn.trim() !== "";

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
        `${ids}-${delta < 0 ? "up" : "down"}-${target}`
      );
      button?.focus();
      button?.scrollIntoView?.({ block: "nearest" });
    });
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!canCreate) return;
    await run(async () => {
      await apiClient.post("/admin/banners", {
        placement,
        titleAr: titleAr.trim(),
        titleEn: titleEn.trim(),
        // Blank optional fields are sent as null, not "". An empty
        // string would render as an empty paragraph on the public site.
        bodyAr: bodyAr.trim() === "" ? null : bodyAr.trim(),
        bodyEn: bodyEn.trim() === "" ? null : bodyEn.trim(),
        linkUrl: linkUrl.trim() === "" ? null : linkUrl.trim(),
      });
      setTitleAr("");
      setTitleEn("");
      setBodyAr("");
      setBodyEn("");
      setLinkUrl("");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={create}
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
        noValidate
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="px-1 text-base font-medium text-content">
            {labels.createLegend}
          </legend>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-title-ar`} required requiredLabel={labels.required}>
                {labels.titleAr}
              </Label>
              <Input
                id={`${ids}-title-ar`}
                dir="rtl"
                maxLength={TITLE_MAX}
                value={titleAr}
                onChange={(event) => setTitleAr(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-title-en`} required requiredLabel={labels.required}>
                {labels.titleEn}
              </Label>
              <Input
                id={`${ids}-title-en`}
                dir="ltr"
                maxLength={TITLE_MAX}
                value={titleEn}
                onChange={(event) => setTitleEn(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-body-ar`}>{labels.bodyAr}</Label>
              <Input
                id={`${ids}-body-ar`}
                dir="rtl"
                maxLength={BODY_MAX}
                value={bodyAr}
                onChange={(event) => setBodyAr(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-body-en`}>{labels.bodyEn}</Label>
              <Input
                id={`${ids}-body-en`}
                dir="ltr"
                maxLength={BODY_MAX}
                value={bodyEn}
                onChange={(event) => setBodyEn(event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-link`}>{labels.linkUrl}</Label>
            <Input
              id={`${ids}-link`}
              dir="ltr"
              maxLength={LINK_MAX}
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              aria-describedby={`${ids}-link-hint`}
            />
            <p id={`${ids}-link-hint`} className="text-xs text-content-muted">
              {labels.linkHint}
            </p>
          </div>

          <div>
            <Button
              type="submit"
              size="sm"
              className="min-h-11"
              isLoading={busy}
              disabled={busy || !canCreate}
            >
              {busy ? labels.working : labels.create}
            </Button>
          </div>
        </fieldset>
      </form>

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

      {/* Every reorder is announced. A visual list re-rendering silently
          tells a screen-reader user nothing at all. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {order.length === 0 ? (
        <p className="text-sm text-content-muted">{labels.empty}</p>
      ) : (
        <ol className="flex list-none flex-col gap-3">
          {order.map((banner, index) => (
            <li key={banner.id} className="rounded-md border border-line bg-surface p-3">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 text-sm text-content">
                    {banner.titleAr} — {banner.titleEn}
                  </span>
                  <StatusBadge
                    label={root(`admin.vocab.bannerState.${banner.state}`)}
                    tone={banner.state === "LIVE" ? "done" : "neutral"}
                  />
                  <StatusBadge label={banner.hasImage ? labels.hasImage : labels.noImage} />
                </div>

                <BannerImage
                  banner={banner}
                  busy={busy}
                  run={run}
                  labels={labels}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    id={`${ids}-up-${index}`}
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    disabled={busy || index === 0}
                    aria-label={root("admin.banners.moveUp", { title: banner.titleAr })}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    id={`${ids}-down-${index}`}
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    disabled={busy || index === order.length - 1}
                    aria-label={root("admin.banners.moveDown", { title: banner.titleAr })}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>

                  <Button
                    type="button"
                    variant={banner.isActive ? "danger" : "primary"}
                    size="sm"
                    className="min-h-11"
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        apiClient.post(`/admin/banners/${banner.id}/toggle`, {
                          isActive: !banner.isActive,
                        })
                      )
                    }
                  >
                    {banner.isActive ? labels.deactivate : labels.activate}
                  </Button>
                </div>

                <BannerSchedule
                  bannerId={banner.id}
                  startsAt={banner.startsAt}
                  endsAt={banner.endsAt}
                  busy={busy}
                  labels={labels}
                  onSave={(payload) =>
                    run(() => apiClient.post(`/admin/banners/${banner.id}/schedule`, payload))
                  }
                />
              </div>
            </li>
          ))}
        </ol>
      )}

      {dirty ? (
        <div>
          <Button
            type="button"
            className="min-h-11"
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
/**
 * The banner's image: what it currently is, and how to change it.
 *
 * This existed only as an API before. `POST /admin/banners/:id/image`
 * and its DELETE were implemented and reachable, and nothing in the
 * product called either — so a banner created here could never be given
 * a picture, and the page told the operator that uploading happened
 * "through a separate interface" that did not exist.
 *
 * The picker is a real `<input type="file">` behind a labelled control
 * rather than a bare input, so the button reads as a button and is
 * reachable from the keyboard. It is `<label>`-wrapped, which is what
 * makes clicking the visible control open the picker without any
 * scripted `.click()` forwarding.
 *
 * NO CLIENT-SIDE SIZE CHECK. The limit is admin-configurable and no
 * endpoint exposes it here — see ACCEPTED_IMAGE_TYPES. The type filter
 * is real and verifiable, so it is applied; the size is not, so it is
 * left to the server, whose refusal carries the actual bound.
 */
function BannerImage({
  banner,
  busy,
  run,
  labels,
}: {
  banner: AdminBannerRow;
  busy: boolean;
  run: (work: () => Promise<unknown>) => Promise<void>;
  labels: BannerManagerLabels;
}) {
  const root = useTranslations();
  // Removal asks in the page, never through window.confirm: a native
  // dialog cannot be translated, ignores the document's RTL direction,
  // and a browser may suppress it outright — so the confirmation could
  // simply not appear. A repo-wide test forbids it across admin.
  const [asking, setAsking] = useState(false);

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Clear immediately: picking the SAME file twice must fire `change`
    // again, which it will not if the input still holds it — a retry
    // after a failed upload would otherwise do nothing at all.
    event.target.value = "";
    if (!file) return;

    void run(() => uploadFile(`/admin/banners/${banner.id}/image`, file));
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {banner.hasImage ? (
        // A plain <img>: an API route on another origin, and the route
        // already emits a resized thumbnail, so the Next optimiser has
        // nothing to add. Decorative here — the title sits beside it and
        // the badge above already announces whether an image exists, so
        // a described preview would be the third telling of one fact.
        <img
          src={mediaUrl(`/api/v1/admin/banners/${banner.id}/image?variant=thumb`)}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="h-16 w-28 rounded border border-line object-cover"
        />
      ) : (
        <div
          className="flex h-16 w-28 items-center justify-center rounded border border-dashed border-line text-xs text-content-muted"
          aria-hidden="true"
        >
          {labels.noImage}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label
          className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-line px-3 py-2 text-sm text-content hover:bg-surface-muted focus-within:outline focus-within:outline-2 focus-within:outline-offset-2"
          data-testid={`banner-image-picker-${banner.id}`}
        >
          {banner.hasImage
            ? root("admin.banners.replaceImage")
            : root("admin.banners.uploadImage")}
          <input
            type="file"
            className="sr-only"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            disabled={busy}
            onChange={onPick}
          />
        </label>

        {banner.hasImage && !asking ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            className="min-h-11"
            disabled={busy}
            onClick={() => setAsking(true)}
          >
            {root("admin.banners.removeImage")}
          </Button>
        ) : null}

        <span className="text-xs text-content-muted">
          {root("admin.banners.imageTypes")}
        </span>
      </div>

      {asking ? (
        <div className="flex w-full flex-col gap-2 rounded-md border border-line bg-surface p-3">
          <p role="status" aria-live="polite" className="text-sm text-content">
            {root("admin.banners.removeImagePrompt")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="min-h-11"
              isLoading={busy}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await apiClient.delete(`/admin/banners/${banner.id}/image`);
                  setAsking(false);
                })
              }
            >
              {/* The SHARED admin confirm/cancel wording, not a second
                  copy under this namespace — one phrasing for the same
                  action everywhere in the portal. */}
              {busy ? labels.working : root("admin.actions.confirm")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11"
              disabled={busy}
              onClick={() => setAsking(false)}
            >
              {root("admin.actions.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

  // `datetime-local` wants "YYYY-MM-DDTHH:mm" with no zone; the API
  // speaks ISO 8601. The two conversions are kept adjacent so neither
  // can be changed without the other.
  const toLocal = (iso: string | null) => (iso === null ? "" : iso.slice(0, 16));
  const toIso = (local: string) => (local === "" ? null : new Date(local).toISOString());

  const [from, setFrom] = useState(() => toLocal(startsAt));
  const [to, setTo] = useState(() => toLocal(endsAt));

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-from-${bannerId}`}>{labels.scheduleFrom}</Label>
        <Input
          id={`${ids}-from-${bannerId}`}
          type="datetime-local"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-to-${bannerId}`}>{labels.scheduleTo}</Label>
        <Input
          id={`${ids}-to-${bannerId}`}
          type="datetime-local"
          value={to}
          onChange={(event) => setTo(event.target.value)}
        />
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="min-h-11"
        disabled={busy}
        onClick={() => onSave({ startsAt: toIso(from), endsAt: toIso(to) })}
      >
        {labels.saveSchedule}
      </Button>
      <p className="w-full text-xs text-content-muted">{labels.scheduleHint}</p>
    </div>
  );
}
