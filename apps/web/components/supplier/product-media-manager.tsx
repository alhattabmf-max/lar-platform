"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ProductMediaView } from "@platform/types";
import { apiClient, uploadFile } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { mediaUrl } from "@/lib/media-url";
import { Button } from "@/components/ui/button";

/**
 * The product's images: view, add, choose the main one, remove one.
 *
 * Every path comes from the API's own `ProductMediaView` — `url` and
 * `thumbnailUrl` are relative routes built from ids. No storage key reaches
 * this component, nothing is presigned, and no URL is assembled here: the
 * only transformation is `mediaUrl()`, which prefixes the browser API origin
 * so an `<img src>` resolves against the API rather than the web app.
 *
 * The thumbnail is what the grid renders and the full image is what its link
 * opens, so a ten-image product does not download ten full-size files.
 *
 * NOTE ON THE COOKIE: this route is private — `SessionAuthGuard` plus the
 * supplier guard — so the `<img>` request must carry `sid`. The cookie is
 * `SameSite=Lax`, which sends it on a subresource request only when the web
 * app and the API are the SAME SITE (`forsa.sa` / `api.forsa.sa`). That is
 * the deployed topology; a genuinely cross-site API origin would need a
 * different cookie policy, not a change here.
 *
 * Three actions, one gate. Upload, set-main and remove all go through the
 * API's `assertEditableTx`, so they are allowed in exactly the same states —
 * `canEdit` is that single gate, and when it is false no control is drawn.
 */
export interface ProductMediaManagerProps {
  productId: string;
  media: readonly ProductMediaView[];
  /** True when the API's edit guard would accept a media mutation. */
  canEdit: boolean;
  /** Product name in the reader's locale — used to build each image's alt text. */
  productName: string;
  labels: {
    heading: string;
    empty: string;
    /** ICU with {name} and {index}. */
    imageAlt: string;
    /** ICU with {name}. */
    mainImageAlt: string;
    mainBadge: string;
    setMain: string;
    remove: string;
    removePrompt: string;
    confirm: string;
    cancel: string;
    working: string;
    addImage: string;
    addImageHint: string;
    openFull: string;
    errorTitle: string;
    requestIdLabel: string;
    /** ICU with {name} and {index}. */
    moveUp: string;
    moveDown: string;
    reorderHint: string;
  };
}

export function ProductMediaManager({
  productId,
  media,
  canEdit,
  productName,
  labels,
}: ProductMediaManagerProps) {
  const router = useRouter();
  const root = useTranslations();
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  async function mutate(run: () => Promise<unknown>) {
    // Double-submit protection covers the whole panel, not one button:
    // removing an image while an upload is in flight would race the
    // server's own re-approval check.
    if (busy) return;

    setBusy(true);
    setFailure(null);

    try {
      await run();
      setRemoving(null);
      // The server decides the result: removing the main image promotes
      // the next one, and any mutation on an APPROVED product re-runs
      // the technical checks. Neither is knowable here.
      router.refresh();
    } catch (error) {
      setFailure(toUserFacingError(error));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Moving one image one place.
   *
   * Buttons, not drag-and-drop. A drag handle is unreachable by keyboard
   * and hostile on a touch screen; move up / move down work with both and
   * need no pointer at all. Drag could be added on top later — it must
   * never be the only way.
   *
   * The API takes the COMPLETE ordered id set and checks true set
   * equality, so this sends every id in its new order rather than a
   * "moved x to position n" instruction. Building the array from `media`
   * — the server's own list — is what guarantees it is complete and free
   * of duplicates.
   *
   * No optimistic reorder. On failure the grid keeps showing the last
   * order the server confirmed, because that is what is actually stored;
   * painting the new order and leaving it there would be a claim that the
   * move succeeded.
   */
  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= media.length) return;

    const ordered = media.map((image) => image.id);
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];

    void mutate(() =>
      apiClient.post(`/companies/me/products/${productId}/media/reorder`, { mediaIds: ordered })
    );
  }

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so choosing the SAME file again still fires a
    // change event.
    event.target.value = "";
    if (!file) return;

    // The existing multipart helper: it sets no Content-Type, because
    // setting one on a FormData body destroys the boundary the browser
    // generates and the request arrives unparseable.
    void mutate(() => uploadFile(`/companies/me/products/${productId}/media`, file, "file"));
  }

  return (
    <section
      // Focus target for MAIN_IMAGE_REQUIRED: that failure's fix is not
      // typing in a field, so the summary anchors to this panel.
      id="product-media-panel"
      tabIndex={-1}
      aria-label={labels.heading}
      className="flex flex-col gap-4"
    >
      <h2 className="text-base font-semibold text-content">{labels.heading}</h2>

      {canEdit && media.length > 1 ? (
        <p className="text-xs text-content-muted">{labels.reorderHint}</p>
      ) : null}

      {media.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface px-6 py-8 text-center text-sm text-content-muted">
          {labels.empty}
        </p>
      ) : (
        <ul className="grid list-none gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {media.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <a
                href={mediaUrl(image.url)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 flex-col gap-1"
              >
                {/* A plain <img>, as everywhere else in this app that
                    renders an API-hosted image. next/image would proxy
                    it through the optimizer, which fetches server-side
                    WITHOUT the visitor's session cookie — and this
                    route is private, so it would answer 401. */}
                <img
                  src={mediaUrl(image.thumbnailUrl)}
                  alt={
                    image.isMain
                      ? labels.mainImageAlt.replace("{name}", productName)
                      : labels.imageAlt
                          .replace("{name}", productName)
                          .replace("{index}", String(index + 1))
                  }
                  className="h-40 w-full rounded-md object-cover"
                />
                <span className="sr-only">{labels.openFull}</span>
              </a>

              {canEdit && media.length > 1 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {/* Disabled at the ends rather than hidden: a control
                      that disappears at the edge of a list moves every
                      other control as you use it. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    disabled={busy || index === 0}
                    aria-label={labels.moveUp
                      .replace("{name}", productName)
                      .replace("{index}", String(index + 1))}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    disabled={busy || index === media.length - 1}
                    aria-label={labels.moveDown
                      .replace("{name}", productName)
                      .replace("{index}", String(index + 1))}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </Button>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                {image.isMain ? (
                  <span className="rounded-md border border-success px-2 py-0.5 text-xs text-content">
                    {labels.mainBadge}
                  </span>
                ) : null}

                {canEdit && !image.isMain ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void mutate(() =>
                        apiClient.post(
                          `/companies/me/products/${productId}/media/${image.id}/set-main`
                        )
                      )
                    }
                  >
                    {busy ? labels.working : labels.setMain}
                  </Button>
                ) : null}

                {canEdit ? (
                  removing === image.id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span role="status" aria-live="polite" className="text-sm text-content">
                        {labels.removePrompt}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void mutate(() =>
                            apiClient.delete(
                              `/companies/me/products/${productId}/media/${image.id}`
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
                        disabled={busy}
                        onClick={() => setRemoving(null)}
                      >
                        {labels.cancel}
                      </Button>
                    </span>
                  ) : (
                    // Removing an image deletes the stored file. It asks
                    // first because nothing brings it back.
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setRemoving(image.id)}
                    >
                      {labels.remove}
                    </Button>
                  )
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="flex flex-col gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={onFileChosen}
          />
          <Button
            type="button"
            size="sm"
            className="min-h-11"
            disabled={busy}
            isLoading={busy}
            onClick={() => fileInput.current?.click()}
          >
            {busy ? labels.working : labels.addImage}
          </Button>
          {/* No numeric limit is stated: the maximum count and size are
              admin-configured and no endpoint exposes them, so a number
              here would be a value this app invented. The server's
              refusal names the reason instead. */}
          <p className="text-xs text-content-muted">{labels.addImageHint}</p>
        </div>
      ) : null}

      {failure ? (
        <div role="alert" className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-danger-text">{labels.errorTitle}</p>
          {/* A closed, translated message for a known code. The API's own
              text for a rejected image is an English developer string
              that names the decoder and the pixel ceiling. */}
          <p className="text-content">{root(failure.messageKey)}</p>
          {failure.requestId ? (
            <p className="text-content-muted">
              {labels.requestIdLabel}: <span className="font-mono">{failure.requestId}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
