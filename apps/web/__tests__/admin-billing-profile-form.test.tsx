import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../messages/ar-SA.json";
import type { AdminPlatformBillingProfile } from "@platform/types";
import {
  PlatformBillingProfileForm,
  type PlatformBillingProfileFormLabels,
} from "@/components/admin/platform-billing-profile-form";
import * as api from "@/lib/api-client";
import { ApiError } from "@/lib/errors";
import { ERROR_CODES } from "@platform/types";

/**
 * The platform's billing identity, on the two things that make this form
 * different from every other form in the admin portal.
 *
 * ONE: THERE IS NO UPDATE. The API appends version N+1 and never touches
 * an earlier one, because documents already issued were computed against
 * them. A button labelled "save" would be a lie about what pressing it
 * does, so the label names the version it is about to write.
 *
 * TWO: THE ADDRESS IS AN OPAQUE BLOB. The DTO validates it as
 * `@IsObject()` with no declared shape, and the commission document
 * copies the whole thing. So this form owns two keys and must carry
 * every other key through untouched — dropping one would silently
 * rewrite what appears on a tax-adjacent document.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const CITY_RIYADH = "11111111-1111-4111-8111-111111111111";
const CITY_JEDDAH = "22222222-2222-4222-8222-222222222222";
const CITIES = [
  { id: CITY_RIYADH, name: "الرياض" },
  { id: CITY_JEDDAH, name: "جدة" },
];

const LABELS: PlatformBillingProfileFormLabels = {
  legalName: "الاسم النظامي",
  crNumber: "السجل التجاري",
  vatRegistered: "مسجّل في ضريبة القيمة المضافة",
  vatNumber: "الرقم الضريبي",
  city: "المدينة",
  cityPlaceholder: "اختر المدينة",
  shortAddress: "العنوان الوطني المختصر",
  yes: "نعم",
  no: "لا",
  required: "(مطلوب)",
  create: "حفظ الملف النظامي",
  // Resolved by the page, not by the component: a function prop
  // cannot cross the server-to-client boundary.
  newVersion: "إصدار النسخة رقم 4",
  working: "جارٍ الحفظ…",
  saved: "حُفظ الملف النظامي.",
  errorTitle: "تعذّر إتمام الطلب",
  requestIdLabel: "رقم المرجع",
  errorLegalName: "الاسم النظامي مطلوب، وبحد أقصى 300 حرف.",
  errorCrNumber: "رقم السجل التجاري مطلوب.",
  errorVatNumber: "الرقم الضريبي يجب أن يكون 15 رقمًا.",
  errorAddress: "هذا الحقل مطلوب لأن العنوان يظهر على مستندات العمولة.",
};

const EXISTING: AdminPlatformBillingProfile = {
  id: "profile-1",
  version: 3,
  legalName: "منصة فرصة للتجارة",
  crNumber: "1010101010",
  isVatRegistered: true,
  vatNumber: "300012345600003",
  addressSnapshot: {
    cityId: CITY_RIYADH,
    // The names as they were when this version was written — snapshot
    // by the server, never typed here.
    cityNameAr: "الرياض",
    cityNameEn: "Riyadh",
    shortAddress: "RRRD2929",
  },
  createdAt: "2026-08-01T09:00:00.000Z",
};

function wrap(current: AdminPlatformBillingProfile | null) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <PlatformBillingProfileForm
        current={current}
        cities={CITIES}
        labels={LABELS}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("creating the first profile", () => {
  it("offers a save, not a version number, when none exists", () => {
    wrap(null);

    expect(
      screen.getByRole("button", { name: "حفظ الملف النظامي" }),
    ).toBeInTheDocument();
  });

  it("sends exactly the fields the DTO declares", async () => {
    const post = vi.spyOn(api.apiClient, "post").mockResolvedValue({} as never);
    const user = userEvent.setup();
    wrap(null);

    await user.type(screen.getByLabelText(/الاسم النظامي/), "  منصة فرصة  ");
    await user.type(screen.getByLabelText(/السجل التجاري/), "1010101010");
    await user.selectOptions(screen.getByLabelText(/المدينة/), CITY_RIYADH);
    await user.type(screen.getByLabelText(/العنوان الوطني المختصر/), "RRRD2929");
    await user.click(screen.getByRole("button", { name: "حفظ الملف النظامي" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe("/admin/platform-billing-profile");
    expect(post.mock.calls[0][1]).toEqual({
      // Trimmed here, as the service trims there.
      legalName: "منصة فرصة",
      crNumber: "1010101010",
      isVatRegistered: false,
      // A CITY ID AND A SHORT ADDRESS — the declared shape, nothing
      // else. The city names are the server's to snapshot.
      addressSnapshot: { cityId: CITY_RIYADH, shortAddress: "RRRD2929" },
    });

    // ONE VERSION PER PRESS, and a version is permanent. The key rides
    // on the request; disabling the button is only a courtesy.
    expect(post.mock.calls[0][2]).toMatchObject({
      idempotencyKey: expect.any(String),
    });
  });

  it("says so when it is saved", async () => {
    vi.spyOn(api.apiClient, "post").mockResolvedValue({} as never);
    const user = userEvent.setup();
    wrap(null);

    await user.type(screen.getByLabelText(/الاسم النظامي/), "منصة فرصة");
    await user.type(screen.getByLabelText(/السجل التجاري/), "1010101010");
    await user.selectOptions(screen.getByLabelText(/المدينة/), CITY_RIYADH);
    await user.type(screen.getByLabelText(/العنوان الوطني المختصر/), "RRRD2929");
    await user.click(screen.getByRole("button", { name: "حفظ الملف النظامي" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "حُفظ الملف النظامي.",
    );
  });
});

describe("what the browser refuses before anything is sent", () => {
  it("will not post an empty form, and names every missing field", async () => {
    const post = vi.spyOn(api.apiClient, "post").mockResolvedValue({} as never);
    const user = userEvent.setup();
    wrap(null);

    await user.click(screen.getByRole("button", { name: "حفظ الملف النظامي" }));

    expect(post).not.toHaveBeenCalled();
    expect(
      screen.getByText("الاسم النظامي مطلوب، وبحد أقصى 300 حرف."),
    ).toBeInTheDocument();
    expect(screen.getByText("رقم السجل التجاري مطلوب.")).toBeInTheDocument();
    // The server accepts an empty address. This form does not — an empty
    // seller address on a commission document helps nobody.
    expect(
      screen.getAllByText("هذا الحقل مطلوب لأن العنوان يظهر على مستندات العمولة."),
    ).toHaveLength(2);
    // And the city is a CHOICE, so an empty one is a placeholder rather
    // than an empty text box.
    expect(screen.getByLabelText(/المدينة/)).toHaveValue("");
  });

  it("asks for fifteen digits when the platform is VAT registered", async () => {
    const post = vi.spyOn(api.apiClient, "post").mockResolvedValue({} as never);
    const user = userEvent.setup();
    wrap(null);

    await user.type(screen.getByLabelText(/الاسم النظامي/), "منصة فرصة");
    await user.type(screen.getByLabelText(/السجل التجاري/), "1010101010");
    await user.selectOptions(screen.getByLabelText(/المدينة/), CITY_RIYADH);
    await user.type(screen.getByLabelText(/العنوان الوطني المختصر/), "RRRD2929");
    await user.selectOptions(
      screen.getByLabelText("مسجّل في ضريبة القيمة المضافة"),
      "true",
    );
    await user.type(screen.getByLabelText(/الرقم الضريبي/), "3000123456");

    await user.click(screen.getByRole("button", { name: "حفظ الملف النظامي" }));

    expect(post).not.toHaveBeenCalled();
    expect(
      screen.getByText("الرقم الضريبي يجب أن يكون 15 رقمًا."),
    ).toBeInTheDocument();
  });

  it("accepts a VAT number typed in Arabic-Indic digits, because the API does", async () => {
    const post = vi.spyOn(api.apiClient, "post").mockResolvedValue({} as never);
    const user = userEvent.setup();
    wrap(null);

    await user.type(screen.getByLabelText(/الاسم النظامي/), "منصة فرصة");
    await user.type(screen.getByLabelText(/السجل التجاري/), "1010101010");
    await user.selectOptions(screen.getByLabelText(/المدينة/), CITY_RIYADH);
    await user.type(screen.getByLabelText(/العنوان الوطني المختصر/), "RRRD2929");
    await user.selectOptions(
      screen.getByLabelText("مسجّل في ضريبة القيمة المضافة"),
      "true",
    );
    await user.type(screen.getByLabelText(/الرقم الضريبي/), "٣٠٠٠١٢٣٤٥٦٠٠٠٠٣");

    await user.click(screen.getByRole("button", { name: "حفظ الملف النظامي" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // Normalised on the way out, exactly as the service normalises it on
    // the way in — the request carries plain digits.
    expect(
      (post.mock.calls[0][1] as { vatNumber: string }).vatNumber,
    ).toBe("300012345600003");
  });

  it("does not offer a VAT number box when the platform is not registered", () => {
    wrap(null);

    expect(screen.queryByLabelText(/الرقم الضريبي/)).not.toBeInTheDocument();
  });

  it("clears a VAT number when registration is switched off", async () => {
    const post = vi.spyOn(api.apiClient, "post").mockResolvedValue({} as never);
    const user = userEvent.setup();
    wrap(EXISTING);

    const toggle = screen.getByLabelText("مسجّل في ضريبة القيمة المضافة");
    await user.selectOptions(toggle, "false");
    await user.selectOptions(toggle, "true");

    // THE POINT: the old number is not still sitting behind the switch,
    // waiting to be posted by someone who never re-read it.
    expect(screen.getByLabelText(/الرقم الضريبي/)).toHaveValue("");

    await user.selectOptions(toggle, "false");
    await user.click(screen.getByRole("button", { name: "إصدار النسخة رقم 4" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // The service rejects a VAT number on an unregistered profile, so the
    // key must be absent rather than empty.
    expect(post.mock.calls[0][1]).not.toHaveProperty("vatNumber");
  });
});

describe("issuing the next version", () => {
  it("names the version it is about to create, never 'save'", () => {
    wrap(EXISTING);

    expect(
      screen.getByRole("button", { name: "إصدار النسخة رقم 4" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "حفظ الملف النظامي" }),
    ).not.toBeInTheDocument();
  });

  it("starts from the current version rather than an empty form", () => {
    wrap(EXISTING);

    expect(screen.getByLabelText(/الاسم النظامي/)).toHaveValue("منصة فرصة للتجارة");
    expect(screen.getByLabelText(/السجل التجاري/)).toHaveValue("1010101010");
    expect(screen.getByLabelText(/الرقم الضريبي/)).toHaveValue("300012345600003");
    // Without these the address would be blank on every new version, and
    // the operator would have to remember it.
    expect(screen.getByLabelText(/المدينة/)).toHaveValue(CITY_RIYADH);
    expect(screen.getByLabelText(/العنوان الوطني المختصر/)).toHaveValue("RRRD2929");
  });

  it("sends the declared shape and nothing else", async () => {
    const post = vi.spyOn(api.apiClient, "post").mockResolvedValue({} as never);
    const user = userEvent.setup();
    wrap(EXISTING);

    await user.selectOptions(screen.getByLabelText(/المدينة/), CITY_JEDDAH);
    await user.click(screen.getByRole("button", { name: "إصدار النسخة رقم 4" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // The DTO is closed. An extra key — including a name the server
    // snapshots itself — is a 400, so nothing is carried through.
    expect(
      (post.mock.calls[0][1] as { addressSnapshot: Record<string, unknown> })
        .addressSnapshot,
    ).toEqual({ cityId: CITY_JEDDAH, shortAddress: "RRRD2929" });
  });

  it("reuses ONE idempotency key across a retry of the same form", async () => {
    const post = vi
      .spyOn(api.apiClient, "post")
      .mockRejectedValueOnce(
        new ApiError({
          kind: "server",
          status: 500,
          code: ERROR_CODES.INTERNAL_ERROR,
          requestId: "req-1",
          message: "boom",
        }),
      )
      .mockResolvedValueOnce({} as never);
    const user = userEvent.setup();
    wrap(EXISTING);

    const submit = screen.getByRole("button", { name: "إصدار النسخة رقم 4" });
    await user.click(submit);
    await screen.findByRole("alert");
    await user.click(submit);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    // THE WHOLE POINT of minting it on mount. A key per press would let
    // a timeout and a retry become two permanent versions.
    const first = (post.mock.calls[0][2] as { idempotencyKey: string })
      .idempotencyKey;
    const second = (post.mock.calls[1][2] as { idempotencyKey: string })
      .idempotencyKey;
    expect(second).toBe(first);
  });
});

describe("when the server refuses", () => {
  it("shows what came back and keeps every value in place", async () => {
    vi.spyOn(api.apiClient, "post").mockRejectedValue(
      new ApiError({
        kind: "validation",
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        requestId: "req-77",
        message: "invalid",
      }),
    );
    const user = userEvent.setup();
    wrap(EXISTING);

    await user.click(screen.getByRole("button", { name: "إصدار النسخة رقم 4" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تعذّر إتمام الطلب");
    expect(alert).toHaveTextContent("req-77");
    // A rejected submission that also emptied the form would be two
    // failures, and the second one is this screen's fault.
    expect(screen.getByLabelText(/الاسم النظامي/)).toHaveValue("منصة فرصة للتجارة");
    expect(
      screen.getByRole("button", { name: "إصدار النسخة رقم 4" }),
    ).toBeEnabled();
  });
});
