import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/ar-SA.json";
import {
  BannerManager,
  type BannerManagerLabels,
} from "@/components/admin/banner-manager";
import type { AdminBannerRow } from "@/lib/admin-data";
import * as api from "@/lib/api-client";
import { ApiError } from "@/lib/errors";
import { ERROR_CODES } from "@platform/types";

/**
 * Giving a banner its image, from the product.
 *
 * `POST /admin/banners/:id/image` and its DELETE were implemented,
 * guarded and reachable — and NOTHING in the web app called either. A
 * banner created in the admin portal could never be given a picture, and
 * the page told the operator that uploads happened "through a separate
 * interface" which did not exist anywhere. The banner path could not be
 * completed from the product at all.
 *
 * These tests pin the control that closes it: that it is present on a
 * banner with no image, that choosing a file actually uploads to the
 * right endpoint, that a rejected upload keeps the card usable, and that
 * the same file can be chosen twice after a failure — the retry case an
 * uncleared file input silently breaks.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const LABELS: BannerManagerLabels = {
  createLegend: "إضافة لافتة",
  titleAr: "العنوان بالعربية",
  titleEn: "العنوان بالإنجليزية",
  bodyAr: "النص بالعربية",
  bodyEn: "النص بالإنجليزية",
  linkUrl: "الرابط",
  linkHint: "رابط داخلي فقط",
  create: "إنشاء",
  saveOrder: "حفظ الترتيب",
  orderChanged: "تغيّر الترتيب",
  orderSaved: "حُفظ الترتيب",
  activate: "تفعيل",
  deactivate: "إيقاف",
  hasImage: "بها صورة",
  noImage: "بلا صورة",
  scheduleFrom: "من",
  scheduleTo: "إلى",
  saveSchedule: "حفظ الجدولة",
  scheduleHint: "اتركه فارغًا ليظل دائمًا",
  working: "جارٍ التنفيذ",
  required: "مطلوب",
  empty: "لا توجد لافتات",
  errorTitle: "تعذّر إتمام الطلب",
  requestIdLabel: "رقم المرجع",
};

const BANNER_ID = "11111111-1111-4111-8111-111111111111";

function banner(overrides: Partial<AdminBannerRow> = {}): AdminBannerRow {
  return {
    id: BANNER_ID,
    placement: "PUBLIC_HOME",
    titleAr: "عرض الأسمنت",
    titleEn: "Cement offer",
    bodyAr: null,
    bodyEn: null,
    linkUrl: null,
    sortOrder: 1,
    isActive: false,
    startsAt: null,
    endsAt: null,
    hasImage: false,
    state: "DRAFT",
    imageWidth: null,
    imageHeight: null,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
  };
}

function renderWith(rows: AdminBannerRow[]) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <BannerManager placement="PUBLIC_HOME" banners={rows} labels={LABELS} />
    </NextIntlClientProvider>
  );
}

const pngFile = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "banner.png", { type: "image/png" });

/** The file input behind the visible picker control. */
function pickerInput(): HTMLInputElement {
  const label = screen.getByTestId(`banner-image-picker-${BANNER_ID}`);
  const input = label.querySelector("input[type=file]");
  if (!input) throw new Error("no file input inside the picker");
  return input as HTMLInputElement;
}

describe("banner image upload from the admin portal", () => {
  it("offers an upload control on a banner that has no image", () => {
    renderWith([banner()]);

    expect(screen.getByText(messages.admin.banners.uploadImage)).toBeTruthy();
    // Nothing to remove when there is no image.
    expect(screen.queryByText(messages.admin.banners.removeImage)).toBeNull();
  });

  it("uploads the chosen file to the banner's own image endpoint", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});

    renderWith([banner()]);
    await user.upload(pickerInput(), pngFile());

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    const [path, file] = upload.mock.calls[0];
    expect(path).toBe(`/admin/banners/${BANNER_ID}/image`);
    expect((file as File).name).toBe("banner.png");
  });

  it("accepts only the content types the server actually stores", () => {
    renderWith([banner()]);
    // Real values, taken from the API's own EXTENSION_BY_CONTENT_TYPE —
    // not an invented list.
    expect(pickerInput().accept).toBe("image/jpeg,image/png,image/webp");
  });

  it("states no size limit, because none is readable by this client", () => {
    const { container } = renderWith([banner()]);
    // A fabricated megabyte figure would be worse than none: the real
    // bound is admin-configurable and no endpoint exposes it here.
    expect(container.textContent).not.toMatch(/\d+\s*(MB|ميغا|كيلو|KB)/i);
  });

  it("shows the failure and keeps the control usable when the server refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "uploadFile").mockRejectedValue(
      new ApiError({
        kind: "validation",
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        requestId: "req-too-big",
        message: "Image exceeds the limit",
      })
    );

    renderWith([banner()]);
    await user.upload(pickerInput(), pngFile());

    await waitFor(() => expect(screen.getByText(LABELS.errorTitle)).toBeTruthy());
    expect(screen.getByText(/req-too-big/)).toBeTruthy();
    expect(pickerInput().disabled).toBe(false);
  });

  it("lets the SAME file be chosen again after a failure", async () => {
    const user = userEvent.setup();
    const upload = vi
      .spyOn(api, "uploadFile")
      .mockRejectedValueOnce(
        new ApiError({
          kind: "server",
          status: 500,
          code: ERROR_CODES.INTERNAL_ERROR,
          requestId: "r1",
          message: "boom",
        })
      )
      .mockResolvedValueOnce({});

    renderWith([banner()]);

    await user.upload(pickerInput(), pngFile());
    await waitFor(() => expect(screen.getByText(LABELS.errorTitle)).toBeTruthy());

    // A file input that still holds the file fires no `change` for the
    // same selection, so a retry would silently do nothing.
    await user.upload(pickerInput(), pngFile());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  });

  it("offers replace and remove once the banner has an image", () => {
    renderWith([banner({ hasImage: true })]);

    expect(screen.getByText(messages.admin.banners.replaceImage)).toBeTruthy();
    expect(screen.getByText(messages.admin.banners.removeImage)).toBeTruthy();
    expect(screen.queryByText(messages.admin.banners.uploadImage)).toBeNull();
  });

  it("asks in the page before removing, never with a native dialog", async () => {
    const user = userEvent.setup();
    const del = vi.spyOn(api.apiClient, "delete").mockResolvedValue({});
    // A native dialog cannot be translated and ignores RTL; if the
    // component reached for one, this spy would catch it.
    const nativeConfirm = vi.spyOn(window, "confirm");

    renderWith([banner({ hasImage: true })]);
    await user.click(screen.getByText(messages.admin.banners.removeImage));

    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    // The question is asked in the document, in the operator's language.
    expect(screen.getByText(messages.admin.banners.removeImagePrompt)).toBeTruthy();
  });

  it("cancelling leaves the image alone", async () => {
    const user = userEvent.setup();
    const del = vi.spyOn(api.apiClient, "delete").mockResolvedValue({});

    renderWith([banner({ hasImage: true })]);
    await user.click(screen.getByText(messages.admin.banners.removeImage));
    await user.click(screen.getByText(messages.admin.actions.cancel));

    expect(del).not.toHaveBeenCalled();
    expect(screen.queryByText(messages.admin.banners.removeImagePrompt)).toBeNull();
  });

  it("confirming removes the image", async () => {
    const user = userEvent.setup();
    const del = vi.spyOn(api.apiClient, "delete").mockResolvedValue({});

    renderWith([banner({ hasImage: true })]);
    await user.click(screen.getByText(messages.admin.banners.removeImage));
    await user.click(screen.getByText(messages.admin.actions.confirm));

    await waitFor(() =>
      expect(del).toHaveBeenCalledWith(`/admin/banners/${BANNER_ID}/image`)
    );
  });

  it("renders no untranslated message key", () => {
    const { container } = renderWith([banner({ hasImage: true })]);
    expect(container.textContent).not.toMatch(/admin\.banners\./);
  });
});
