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
import { DEFAULT_BANNER_IMAGE_SHAPE } from "@platform/types";

/**
 * Giving a banner its artwork — ONE PICTURE PER LANGUAGE.
 *
 * The two languages are independent from end to end: separate rows on
 * the server, separate controls here, and separate uploads addressed by
 * a `locale` query parameter on the one image route. Replacing the
 * Arabic artwork must leave the English artwork exactly where it was,
 * which is the property these tests exist to hold.
 *
 * There is no fallback between them anywhere. An Arabic reader is never
 * shown English artwork, so a banner missing either one cannot go live
 * — covered in `admin-banner-manager.test.tsx`.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const LABELS: BannerManagerLabels = {
  createLegend: "إضافة لافتة",
  linkUrl: "الرابط",
  linkHint: "رابط داخلي فقط",
  create: "إنشاء",
  saveOrder: "حفظ الترتيب",
  orderChanged: "تغيّر الترتيب",
  orderSaved: "حُفظ الترتيب",
  activate: "تفعيل",
  deactivate: "إيقاف",
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

const ID = "11111111-1111-4111-8111-111111111111";

function banner(images: Array<"ar-SA" | "en-SA">): AdminBannerRow {
  return {
    id: ID,
    placement: "PUBLIC_HOME",
    images,
    linkUrl: null,
    sortOrder: 1,
    isActive: false,
    startsAt: null,
    endsAt: null,
    state: "DRAFT",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
}

function renderWith(rows: AdminBannerRow[]) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <BannerManager
        placement="PUBLIC_HOME"
        banners={rows}
        labels={LABELS}
        imageShape={DEFAULT_BANNER_IMAGE_SHAPE}
      />
    </NextIntlClientProvider>,
  );
}

const file = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "art.png", {
    type: "image/png",
  });

function pickerFor(locale: "ar-SA" | "en-SA"): HTMLInputElement {
  const label = screen.getByTestId(`banner-artwork-picker-${ID}-${locale}`);
  return label.querySelector("input[type=file]") as HTMLInputElement;
}

describe("each language has its own control", () => {
  it("shows one for Arabic and one for English", () => {
    renderWith([banner([])]);

    expect(screen.getByTestId(`banner-artwork-${ID}-ar-SA`)).toBeTruthy();
    expect(screen.getByTestId(`banner-artwork-${ID}-en-SA`)).toBeTruthy();
  });

  it("says which languages already have artwork and which do not", () => {
    renderWith([banner(["ar-SA"])]);

    const arabic = screen.getByTestId(`banner-artwork-${ID}-ar-SA`);
    const english = screen.getByTestId(`banner-artwork-${ID}-en-SA`);

    expect(arabic.querySelector("img")).not.toBeNull();
    expect(english.querySelector("img")).toBeNull();
    expect(english.textContent).toContain(messages.admin.banners.noArtwork);
  });
});

describe("uploading is addressed to ONE language", () => {
  it("sends the Arabic picture to the Arabic locale", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});

    renderWith([banner([])]);
    await user.upload(pickerFor("ar-SA"), file());

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][0]).toBe(
      `/admin/banners/${ID}/image?locale=ar-SA`,
    );
  });

  it("sends the English picture to the English locale", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});

    renderWith([banner([])]);
    await user.upload(pickerFor("en-SA"), file());

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][0]).toBe(
      `/admin/banners/${ID}/image?locale=en-SA`,
    );
  });

  it("REPLACES one language without touching the other", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});

    renderWith([banner(["ar-SA", "en-SA"])]);
    await user.upload(pickerFor("ar-SA"), file());

    // Exactly one request, and it names Arabic. The English artwork is
    // a separate row and is not mentioned at all.
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0][0]).toContain("locale=ar-SA");
    expect(upload.mock.calls[0][0]).not.toContain("en-SA");
  });

  it("accepts only the content types the server actually stores", () => {
    renderWith([banner([])]);
    // Real values, taken from the API's own EXTENSION_BY_CONTENT_TYPE —
    // not an invented list.
    expect(pickerFor("ar-SA").accept).toBe("image/jpeg,image/png,image/webp");
  });

  it("states no size limit, because none is readable by this client", () => {
    const { container } = renderWith([banner([])]);
    // A fabricated megabyte figure would be worse than none: the real
    // bound is admin-configurable and no endpoint exposes it here.
    expect(container.textContent).not.toMatch(/\d+\s*(MB|ميغا|كيلو|KB)/i);
  });
});

describe("the admin preview asks for the right picture", () => {
  it("builds a preview URL carrying the language and the thumbnail variant", () => {
    renderWith([banner(["ar-SA", "en-SA"])]);

    const arabic = screen
      .getByTestId(`banner-artwork-${ID}-ar-SA`)
      .querySelector("img")
      ?.getAttribute("src");

    expect(arabic).toContain(`/admin/banners/${ID}/image`);
    expect(arabic).toContain("locale=ar-SA");
    expect(arabic).toContain("variant=thumb");
  });

  it("keeps the preview decorative — the language is named beside it", () => {
    renderWith([banner(["ar-SA"])]);

    const img = screen
      .getByTestId(`banner-artwork-${ID}-ar-SA`)
      .querySelector("img");
    // Announcing the picture as well as its label would say the same
    // thing twice.
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("a failed upload leaves the control usable", () => {
  it("shows the failure and keeps the picker enabled", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/errors");
    const { ERROR_CODES } = await import("@platform/types");

    vi.spyOn(api, "uploadFile").mockRejectedValue(
      new ApiError({
        kind: "validation",
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        requestId: "req-too-big",
        message: "Image exceeds the limit",
      }),
    );

    renderWith([banner([])]);
    await user.upload(pickerFor("ar-SA"), file());

    await waitFor(() =>
      expect(screen.getByText(LABELS.errorTitle)).toBeTruthy(),
    );
    expect(screen.getByText(/req-too-big/)).toBeTruthy();
    expect(pickerFor("ar-SA").disabled).toBe(false);
  });

  it("lets the SAME file be chosen again after a failure", async () => {
    const user = userEvent.setup();
    const { ApiError } = await import("@/lib/errors");
    const { ERROR_CODES } = await import("@platform/types");

    const upload = vi
      .spyOn(api, "uploadFile")
      .mockRejectedValueOnce(
        new ApiError({
          kind: "server",
          status: 500,
          code: ERROR_CODES.INTERNAL_ERROR,
          requestId: "r1",
          message: "boom",
        }),
      )
      .mockResolvedValueOnce({});

    renderWith([banner([])]);
    await user.upload(pickerFor("ar-SA"), file());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    // The input is cleared after every pick, so re-choosing the same
    // file fires `change` again — without that, a retry does nothing.
    await user.upload(pickerFor("ar-SA"), file());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
  });
});
