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
import { apiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/errors";
import { ERROR_CODES } from "@platform/types";

/**
 * A REAL ApiError, not a look-alike object. `isApiError` is an
 * `instanceof` check, so a plain literal is treated as an unknown throw
 * and loses its requestId — which would make this test assert against a
 * failure mode the app never actually produces.
 */
function serverFailure(requestId: string): ApiError {
  return new ApiError({
    kind: "server",
    status: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    requestId,
    message: "Internal server error",
  });
}

/** The reference number the founder was shown. */
const REQUEST_ID = "75689e20-2f79-494e-8e49-dc84383b7bf5";

/**
 * What an operator keeps when the server refuses the request.
 *
 * `POST /admin/banners` answered 500 for every banner
 * (`Failed to deserialize column of type 'void'` — see
 * `banner-placement-lock.integration-spec.ts`). The founder hit it after
 * typing a full banner, and the question that matters for the person at
 * the keyboard is not only "was the bug fixed" but "did I lose what I
 * typed".
 *
 * Today the answer is no, by construction: `create()` clears the five
 * fields only AFTER `await apiClient.post(...)` returns, so a throw
 * skips the clears entirely. That is easy to break — moving the resets
 * into a `finally`, or clearing optimistically before the request, would
 * silently start discarding an operator's work on every failure. This
 * pins the behaviour.
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

const NO_BANNERS: AdminBannerRow[] = [];

/** The founder's banner: home placement, both titles, NO link. */
const TYPED = {
  titleAr: "عرض الأسمنت الوطني",
  titleEn: "National Cement Offer",
  bodyAr: "خصم خاص لهذا الشهر",
};

function renderManager() {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <BannerManager placement="PUBLIC_HOME" banners={NO_BANNERS} labels={LABELS} />
    </NextIntlClientProvider>
  );
}

async function fillTheForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(new RegExp(LABELS.titleAr)), TYPED.titleAr);
  await user.type(screen.getByLabelText(new RegExp(LABELS.titleEn)), TYPED.titleEn);
  await user.type(screen.getByLabelText(new RegExp(LABELS.bodyAr)), TYPED.bodyAr);
}

describe("creating a banner when the server fails", () => {
  it("keeps every typed value so nothing has to be retyped", async () => {
    const user = userEvent.setup();
    // The exact failure shape the API returned.
    vi.spyOn(apiClient, "post").mockRejectedValue(serverFailure(REQUEST_ID));

    renderManager();
    await fillTheForm(user);
    await user.click(screen.getByRole("button", { name: LABELS.create }));

    await waitFor(() => {
      expect(screen.getByText(LABELS.errorTitle)).toBeTruthy();
    });

    // The whole point: the fields still hold what was typed.
    expect(screen.getByLabelText(new RegExp(LABELS.titleAr))).toHaveValue(TYPED.titleAr);
    expect(screen.getByLabelText(new RegExp(LABELS.titleEn))).toHaveValue(TYPED.titleEn);
    expect(screen.getByLabelText(new RegExp(LABELS.bodyAr))).toHaveValue(TYPED.bodyAr);
  });

  it("shows the reference id, so a failure can be traced to the log", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "post").mockRejectedValue(serverFailure(REQUEST_ID));

    renderManager();
    await fillTheForm(user);
    await user.click(screen.getByRole("button", { name: LABELS.create }));

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(REQUEST_ID))
      ).toBeTruthy();
    });
  });

  it("the form is usable again — the operator can retry without retyping", async () => {
    const user = userEvent.setup();
    const post = vi
      .spyOn(apiClient, "post")
      .mockRejectedValueOnce(serverFailure(REQUEST_ID))
      .mockResolvedValueOnce({});

    renderManager();
    await fillTheForm(user);

    const submit = screen.getByRole("button", { name: LABELS.create });
    await user.click(submit);
    await waitFor(() => expect(screen.getByText(LABELS.errorTitle)).toBeTruthy());

    // Second attempt, without touching the fields again.
    await user.click(submit);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    // Both attempts carried the same typed content.
    expect(post.mock.calls[1][1]).toMatchObject({
      placement: "PUBLIC_HOME",
      titleAr: TYPED.titleAr,
      titleEn: TYPED.titleEn,
      // A blank optional field is sent as null, never "".
      linkUrl: null,
      bodyEn: null,
    });
  });

  it("clears the form only on success", async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, "post").mockResolvedValue({});

    renderManager();
    await fillTheForm(user);
    await user.click(screen.getByRole("button", { name: LABELS.create }));

    await waitFor(() => {
      expect(screen.getByLabelText(new RegExp(LABELS.titleAr))).toHaveValue("");
    });
    expect(screen.getByLabelText(new RegExp(LABELS.titleEn))).toHaveValue("");
    expect(screen.getByLabelText(new RegExp(LABELS.bodyAr))).toHaveValue("");
  });
});
