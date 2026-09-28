import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../messages/ar-SA.json";
import english from "../messages/en-SA.json";
import {
  BannerManager,
  type BannerManagerLabels,
} from "@/components/admin/banner-manager";
import type { AdminBannerRow } from "@/lib/admin-data";
import * as api from "@/lib/api-client";
import { DEFAULT_BANNER_IMAGE_SHAPE } from "@platform/types";

/**
 * The banner image SHAPE, judged before anything is uploaded.
 *
 * The rule itself is tested where it is decided, on the API side. What
 * is pinned here is the behaviour an operator meets: a portrait
 * photograph is refused immediately, with the dimensions it actually
 * has and the ones required; an acceptable file is not uploaded on
 * sight but held for confirmation behind a preview of the real crop;
 * and the limits shown come from the policy in force rather than from
 * numbers typed into this screen.
 *
 * The browser check is a courtesy. It exists to turn a round-trip into
 * an immediate, specific message — the server measures the same file
 * again and its refusal is the one that decides.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const BANNER_ID = "11111111-1111-4111-8111-111111111111";

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

function banner(): AdminBannerRow {
  return {
    id: BANNER_ID,
    placement: "PUBLIC_HOME",
    images: [],
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

/**
 * jsdom has no object URLs and never decodes an image, so a picked file
 * would be unmeasurable and the screen would skip its check entirely.
 * These stubs stand in for the browser's decoder so the measured path
 * can be exercised; `nextSize` is what that "decoder" reports, and null
 * means it could not read the file at all.
 */
let nextSize: { width: number; height: number } | null = null;
const revoked: string[] = [];

beforeEach(() => {
  revoked.length = 0;
  URL.createObjectURL = vi.fn(() => "blob:banner-under-test");
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });

  class StubImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_value: string) {
      queueMicrotask(() => {
        if (!nextSize) {
          this.onerror?.();
          return;
        }
        this.naturalWidth = nextSize.width;
        this.naturalHeight = nextSize.height;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal("Image", StubImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderWith(
  locale: "ar-SA" | "en-SA" = "ar-SA",
  shape = DEFAULT_BANNER_IMAGE_SHAPE,
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ar-SA" ? messages : english}
    >
      <BannerManager
        placement="PUBLIC_HOME"
        banners={[banner()]}
        labels={LABELS}
        imageShape={shape}
      />
    </NextIntlClientProvider>,
  );
}

const file = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "banner.png", {
    type: "image/png",
  });

function pickerInput(): HTMLInputElement {
  const label = screen.getByTestId("artwork-input-ar-SA");
  return label.querySelector("input[type=file]") as HTMLInputElement;
}

const WIDE_OPEN = {
  minWidth: 100,
  minHeight: 100,
  preferredAspectRatio: 1,
  minAspectRatio: 0.5,
  maxAspectRatio: 2,
};

describe("a file outside the accepted shape is refused before it is uploaded", () => {
  it("refuses a PORTRAIT photograph without contacting the server", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});
    nextSize = { width: 1080, height: 1920 };

    renderWith();
    await user.upload(pickerInput(), file());

    await waitFor(() =>
      expect(screen.getByTestId("artwork-refusal-ar-SA")).toBeTruthy(),
    );
    // The point of checking here is to spend nothing on a file that
    // cannot be accepted.
    expect(upload).not.toHaveBeenCalled();
  });

  it("names the ACTUAL dimensions and the required minimum", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "uploadFile").mockResolvedValue({});
    nextSize = { width: 800, height: 600 };

    renderWith();
    await user.upload(pickerInput(), file());

    const refusal = await screen.findByTestId("artwork-refusal-ar-SA");
    // "Invalid image" tells an operator nothing about what to do next.
    expect(refusal.textContent).toContain("800");
    expect(refusal.textContent).toContain("600");
    expect(refusal.textContent).toContain(
      String(DEFAULT_BANNER_IMAGE_SHAPE.minWidth),
    );
    expect(refusal.textContent).toContain(
      String(DEFAULT_BANNER_IMAGE_SHAPE.minHeight),
    );
  });

  it("names the actual ratio and the accepted band when the size is fine", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "uploadFile").mockResolvedValue({});
    nextSize = { width: 2000, height: 1000 };

    renderWith();
    await user.upload(pickerInput(), file());

    const refusal = await screen.findByTestId("artwork-refusal-ar-SA");
    expect(refusal.textContent).toContain("2:1");
    expect(refusal.textContent).toContain("3:1");
    expect(refusal.textContent).toContain("6:1");
  });

  it("announces the refusal rather than only showing it", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "uploadFile").mockResolvedValue({});
    nextSize = { width: 1080, height: 1920 };

    renderWith();
    await user.upload(pickerInput(), file());

    const refusal = await screen.findByTestId("artwork-refusal-ar-SA");
    expect(refusal.getAttribute("role")).toBe("alert");
  });

  it("refuses in English too, with the same numbers", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "uploadFile").mockResolvedValue({});
    nextSize = { width: 1080, height: 1920 };

    renderWith("en-SA");
    await user.upload(pickerInput(), file());

    const refusal = await screen.findByTestId("artwork-refusal-ar-SA");
    expect(refusal.textContent).toContain("1080");
    expect(refusal.textContent).toContain("1920");
    // A missing translation renders the key itself, which would still
    // "contain" the numbers only by accident.
    expect(refusal.textContent).not.toContain("shapeTooSmall");
  });
});

describe("an acceptable file is previewed before it is saved", () => {
  it("does NOT upload on sight — it waits for confirmation", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});
    nextSize = { width: 2000, height: 400 };

    renderWith();
    await user.upload(pickerInput(), file());

    await waitFor(() =>
      expect(screen.getByTestId("artwork-preview-ar-SA")).toBeTruthy(),
    );
    // Replacing a live banner with a badly-cropped image before anyone
    // could look at it is the failure this step exists to prevent.
    expect(upload).not.toHaveBeenCalled();
  });

  it("previews at the SAME ratio and crop the public page uses", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "uploadFile").mockResolvedValue({});
    nextSize = { width: 2000, height: 400 };

    renderWith();
    await user.upload(pickerInput(), file());

    const frame = await screen.findByTestId("artwork-preview-ar-SA");
    expect(frame.style.aspectRatio).toBe(
      String(DEFAULT_BANNER_IMAGE_SHAPE.preferredAspectRatio),
    );

    const img = frame.querySelector("img");
    // A preview that letterboxed the image would hide the very thing
    // being checked: what the frame cuts off.
    expect(img?.className).toContain("object-cover");
  });

  it("holds the picture until the banner is created, uploading nothing on pick", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});
    nextSize = { width: 2000, height: 400 };

    renderWith();
    await user.upload(pickerInput(), file());
    await screen.findByTestId("artwork-preview-ar-SA");

    // Nothing is uploaded on pick, because there is no banner to upload
    // ONTO yet: the row is created first and the pictures follow. What
    // the operator gets in the meantime is the crop preview.
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads nothing when the operator cancels, and releases the file", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});
    nextSize = { width: 2000, height: 400 };

    renderWith();
    await user.upload(pickerInput(), file());
    await screen.findByTestId("artwork-preview-ar-SA");

    await user.click(screen.getByText(messages.common.cancel));

    await waitFor(() =>
      expect(screen.queryByTestId("artwork-preview-ar-SA")).toBeNull(),
    );
    expect(upload).not.toHaveBeenCalled();
    // An object URL is a document-lifetime handle to the file's bytes.
    expect(revoked).toContain("blob:banner-under-test");
  });
});

describe("the limits shown are the ones in force", () => {
  it("states the band from the policy, not from this screen", () => {
    renderWith();

    const hint = screen.getByTestId("artwork-picker-ar-SA");
    expect(hint.textContent).toContain("5:1");
    expect(hint.textContent).toContain("1500");
    expect(hint.textContent).toContain("300");
  });

  it("follows a WIDENED policy — a square passes when the policy allows it", async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(api, "uploadFile").mockResolvedValue({});
    nextSize = { width: 600, height: 600 };

    // The proof that nothing is hard-coded here: the same file the
    // default band refuses sails through a policy that permits it.
    renderWith("ar-SA", WIDE_OPEN);
    await user.upload(pickerInput(), file());

    const frame = await screen.findByTestId("artwork-preview-ar-SA");
    expect(frame.style.aspectRatio).toBe("1");
    expect(screen.queryByTestId("artwork-refusal-ar-SA")).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("shows the widened numbers in the hint too", () => {
    renderWith("ar-SA", WIDE_OPEN);

    const hint = screen.getByTestId("artwork-picker-ar-SA");
    expect(hint.textContent).toContain("1:1");
    expect(hint.textContent).not.toContain("1500");
  });
});

describe("a file this browser cannot measure", () => {
  it("is ACCEPTED rather than refused on our own blind spot", async () => {
    const user = userEvent.setup();
    // The decoder refuses it here; the server may well support it.
    nextSize = null;

    renderWith();
    await user.upload(pickerInput(), file());

    // No refusal: this browser having no opinion is not a reason to
    // block a format the server may handle perfectly well. It is kept
    // and sent when the banner is created — without a preview, because
    // there is nothing to preview.
    await waitFor(() =>
      expect(screen.queryByTestId("artwork-refusal-ar-SA")).toBeNull(),
    );
    expect(screen.queryByTestId("artwork-preview-ar-SA")).toBeNull();
  });
});
