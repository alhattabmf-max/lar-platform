import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../messages/ar-SA.json";
import {
  BannerManager,
  type BannerManagerLabels,
} from "@/components/admin/banner-manager";
import * as api from "@/lib/api-client";
import { ApiError } from "@/lib/errors";
import { DEFAULT_BANNER_IMAGE_SHAPE, ERROR_CODES } from "@platform/types";

/**
 * Creating a banner is TWO STEPS, and the second one can fail.
 *
 * The row must exist before an upload can be addressed to it, so
 * creation posts the banner and then uploads each language's artwork
 * onto it. That means a request can succeed and the next one fail, and
 * what happens then is a real decision rather than an accident:
 *
 *   THE HALF-BUILT BANNER IS KEPT, as an inactive draft. It cannot be
 *   activated until both languages are present, so no visitor can ever
 *   see it; it sits in the list with its missing language named, and
 *   the operator finishes it or deletes it.
 *
 * Rolling back instead would throw away the upload that DID succeed and
 * make the operator repeat it — worse for them, and no safer, because
 * the draft was never visible in the first place.
 *
 * A creation failure must also leave the CHOSEN FILES in place. Clearing
 * the form on failure means re-picking two pictures because of one
 * server error.
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

/**
 * jsdom has no object URLs and never decodes an image, so a picked file
 * would be unmeasurable and the shape check would be skipped. These
 * stubs stand in for the browser's decoder; the reported size is a
 * valid 5:1 banner so the picker accepts it.
 */
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:artwork");
  URL.revokeObjectURL = vi.fn();

  class StubImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 2000;
    naturalHeight = 400;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", StubImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderWith() {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <BannerManager
        placement="PUBLIC_HOME"
        banners={[]}
        labels={LABELS}
        imageShape={DEFAULT_BANNER_IMAGE_SHAPE}
      />
    </NextIntlClientProvider>,
  );
}

const file = (name: string) =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
    type: "image/png",
  });

function formPicker(locale: "ar-SA" | "en-SA"): HTMLInputElement {
  const label = screen.getByTestId(`artwork-input-${locale}`);
  return label.querySelector("input[type=file]") as HTMLInputElement;
}

async function pickBoth(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(formPicker("ar-SA"), file("ar.png"));
  await waitFor(() =>
    expect(screen.getByTestId("artwork-preview-ar-SA")).toBeTruthy(),
  );
  await user.upload(formPicker("en-SA"), file("en.png"));
  await waitFor(() =>
    expect(screen.getByTestId("artwork-preview-en-SA")).toBeTruthy(),
  );
}

describe("creating a banner", () => {
  it("posts the row FIRST, then uploads one picture per language", async () => {
    const user = userEvent.setup();
    const post = vi
      .spyOn(api.apiClient, "post")
      .mockResolvedValue({ id: "new-1" });
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});

    renderWith();
    await pickBoth(user);
    await user.click(screen.getByRole("button", { name: LABELS.create }));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));

    // The row has to exist before anything can be uploaded onto it.
    expect(post).toHaveBeenCalledWith("/admin/banners", {
      placement: "PUBLIC_HOME",
      linkUrl: null,
    });
    expect(upload.mock.calls[0][0]).toBe(
      "/admin/banners/new-1/image?locale=ar-SA",
    );
    expect(upload.mock.calls[1][0]).toBe(
      "/admin/banners/new-1/image?locale=en-SA",
    );
  });

  it("sends a blank link as null, never as an empty string", async () => {
    const user = userEvent.setup();
    const post = vi
      .spyOn(api.apiClient, "post")
      .mockResolvedValue({ id: "new-1" });
    vi.spyOn(api, "uploadFile").mockResolvedValue({});

    renderWith();
    await pickBoth(user);
    await user.click(screen.getByRole("button", { name: LABELS.create }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect((post.mock.calls[0][1] as { linkUrl: unknown }).linkUrl).toBeNull();
  });
});

describe("when the banner row itself cannot be created", () => {
  it("shows the failure with its request id", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.apiClient, "post").mockRejectedValue(
      new ApiError({
        kind: "server",
        status: 500,
        code: ERROR_CODES.INTERNAL_ERROR,
        requestId: "75689e20-2f79-494e-8e49-dc84383b7bf5",
        message: "boom",
      }),
    );
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});

    renderWith();
    await pickBoth(user);
    await user.click(screen.getByRole("button", { name: LABELS.create }));

    await waitFor(() =>
      expect(screen.getByText(LABELS.errorTitle)).toBeTruthy(),
    );
    expect(screen.getByText(/75689e20/)).toBeTruthy();
    // Nothing was uploaded: there is no row to upload onto.
    expect(upload).not.toHaveBeenCalled();
  });

  it("KEEPS the chosen pictures so the operator can retry", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.apiClient, "post").mockRejectedValue(
      new ApiError({
        kind: "server",
        status: 500,
        code: ERROR_CODES.INTERNAL_ERROR,
        requestId: "r1",
        message: "boom",
      }),
    );

    renderWith();
    await pickBoth(user);
    await user.click(screen.getByRole("button", { name: LABELS.create }));

    await waitFor(() =>
      expect(screen.getByText(LABELS.errorTitle)).toBeTruthy(),
    );

    // Both previews survive, so pressing the button again is all it
    // takes — rather than picking two files a second time.
    expect(screen.getByTestId("artwork-preview-ar-SA")).toBeTruthy();
    expect(screen.getByTestId("artwork-preview-en-SA")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: LABELS.create }),
    ).not.toBeDisabled();
  });
});

describe("when one picture uploads and the other fails", () => {
  it("stops at the failure and reports it", async () => {
    const user = userEvent.setup();
    vi.spyOn(api.apiClient, "post").mockResolvedValue({ id: "new-1" });
    const upload = vi
      .spyOn(api, "uploadFile")
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new ApiError({
          kind: "server",
          status: 500,
          code: ERROR_CODES.INTERNAL_ERROR,
          requestId: "partial-1",
          message: "storage unreachable",
        }),
      );

    renderWith();
    await pickBoth(user);
    await user.click(screen.getByRole("button", { name: LABELS.create }));

    await waitFor(() => expect(screen.getByText(/partial-1/)).toBeTruthy());
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("does NOT undo the banner or the picture that succeeded", async () => {
    const user = userEvent.setup();
    const post = vi
      .spyOn(api.apiClient, "post")
      .mockResolvedValue({ id: "new-1" });
    const del = vi.spyOn(api.apiClient, "delete").mockResolvedValue({});
    vi.spyOn(api, "uploadFile")
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new ApiError({
          kind: "server",
          status: 500,
          code: ERROR_CODES.INTERNAL_ERROR,
          requestId: "partial-2",
          message: "storage unreachable",
        }),
      );

    renderWith();
    await pickBoth(user);
    await user.click(screen.getByRole("button", { name: LABELS.create }));

    await waitFor(() => expect(screen.getByText(/partial-2/)).toBeTruthy());

    // The draft stays. It is inactive and cannot be activated with a
    // language missing, so no visitor can see it — and the operator
    // keeps the upload that worked.
    expect(del).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
  });
});
