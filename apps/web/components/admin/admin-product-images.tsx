"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ImagePlus } from "lucide-react";
import type { ProductMediaView } from "@platform/types";
import { apiClient, uploadFile } from "@/lib/api-client";
import { toUserFacingError, type UserFacingError } from "@/lib/error-messages";
import { mediaUrl } from "@/lib/media-url";
import { FieldError } from "@/components/ui/field";

/**
 * A PRODUCT'S PICTURES, CHANGEABLE FROM THE CONSOLE.
 *
 * «حتى الصورة اجعلها قابلة للتعديل، لأني أضغط عليها ولا يعطيني تعديل.»
 *
 * IT STANDS WHERE THE SUPPLIER'S PICKER STANDS — the narrow column
 * beside the names, with the rule between — because the card is the
 * supplier's «إضافة منتج» card and this is the part of it that takes a
 * file. The dashed panel, the label-as-target and the focusable
 * `sr-only` input are that picker's, so the keyboard path here is the
 * file dialog itself rather than a div pretending to be one.
 *
 * IT ADDS; IT DOES NOT SILENTLY REPLACE. Choosing a file uploads a NEW
 * image, and each existing one carries its own two answers — make it
 * the main one, or remove it. A picker that overwrote whatever was
 * there would destroy a photograph with one mis-click and no
 * confirmation, and the platform keeps several per product on purpose.
 *
 * EVERY WRITE IS THE SERVER'S. There is no optimistic anything: the
 * routes are the console's own, each recorded as
 * `PRODUCT_MEDIA_*_BY_ADMIN`, and `router.refresh()` re-reads what the
 * product now holds.
 */

export interface AdminProductImageLabels {
  title: string;
  choose: string;
  empty: string;
  setMain: string;
  remove: string;
  main: string;
  working: string;
  errorTitle: string;
}

export function AdminProductImages({
  productId,
  media,
  labels,
}: {
  productId: string;
  media: readonly ProductMediaView[];
  labels: AdminProductImageLabels;
}) {
  const router = useRouter();
  const root = useTranslations();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<UserFacingError | null>(null);

  const main = media.find((image) => image.isMain) ?? media[0];
  const rest = media.filter((image) => image.id !== main?.id);

  async function run(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      setFailure(toUserFacingError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function choose(file: File | null) {
    if (!file) return;
    await run(() => uploadFile(`/admin/products/${productId}/media`, file));
    // The same file may need choosing again after a failure, and a file
    // input fires no change event for an unchanged value.
    if (input.current) input.current.value = "";
  }

  return (
    <div className="flex flex-col gap-1">
      {/* THE INPUT IS THE CONTROL, and it is real. `sr-only` rather than
          `hidden`: it stays focusable, and the dashed panel is its
          LABEL, which is what makes the whole area clickable with no
          script at all. */}
      <input
        ref={input}
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(event) => void choose(event.target.files?.[0] ?? null)}
        className="peer sr-only"
        data-testid="admin-product-image-input"
      />
      <label
        htmlFor={inputId}
        className="flex cursor-pointer flex-col gap-1 rounded-card peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2"
      >
        <span className="text-center text-sm font-medium text-content">
          {labels.title}
        </span>
        <span className="mx-auto flex w-full max-w-56 flex-col items-center justify-center gap-1 rounded-card border border-dashed border-line-control py-3 transition-colors hover:border-secondary">
          {main ? (
            <img
              src={mediaUrl(main.url)}
              alt=""
              aria-hidden="true"
              decoding="async"
              className="size-24 rounded-control object-cover shadow-soft"
            />
          ) : (
            <ImagePlus className="size-8 text-secondary" aria-hidden="true" />
          )}
          <span className="text-sm font-semibold text-secondary">
            {busy ? labels.working : labels.choose}
          </span>
          {!main ? (
            <span className="px-2 text-xs text-content-muted">{labels.empty}</span>
          ) : null}
        </span>
      </label>

      {media.length > 0 ? (
        <ul className="mx-auto flex w-full max-w-56 flex-col gap-1">
          {[main, ...rest].filter(Boolean).map((image) => (
            <li
              key={image!.id}
              className="flex items-center gap-1 rounded-control border border-line p-1"
            >
              <img
                src={mediaUrl(image!.thumbnailUrl)}
                alt=""
                aria-hidden="true"
                loading="lazy"
                decoding="async"
                className="size-8 shrink-0 rounded object-cover"
              />
              {image!.isMain ? (
                <span className="flex-1 text-xs text-content-muted">{labels.main}</span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      apiClient.post(
                        `/admin/products/${productId}/media/${image!.id}/set-main`,
                      ),
                    )
                  }
                  className="inline-flex min-h-nav flex-1 items-center text-start text-xs text-secondary hover:opacity-[var(--state-hover-opacity)] disabled:opacity-[var(--state-disabled-opacity)]"
                >
                  {labels.setMain}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    apiClient.delete(
                      `/admin/products/${productId}/media/${image!.id}`,
                    ),
                  )
                }
                className="inline-flex min-h-nav shrink-0 items-center text-xs text-danger hover:opacity-[var(--state-hover-opacity)] disabled:opacity-[var(--state-disabled-opacity)]"
                data-testid="admin-product-image-remove"
              >
                {labels.remove}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {failure ? (
        <FieldError id={`${inputId}-error`}>
          {labels.errorTitle}: {root(failure.messageKey)}
        </FieldError>
      ) : null}
    </div>
  );
}
