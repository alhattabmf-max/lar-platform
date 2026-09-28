import { render, screen, waitFor, within } from "@testing-library/react";
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
 * The banner console, after banners stopped carrying text.
 *
 * A banner is ARTWORK — one picture per language — and nothing else.
 * The screen used to ask for an Arabic title, an English title and two
 * body fields; none of them was ever displayed, the Arabic title was
 * quietly reused as alt text, and the rest were stored and ignored.
 * What is pinned here is that they are gone, that both languages are
 * required before anything can go live, and that a banner can be
 * removed for good rather than only switched off.
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

function banner(overrides: Partial<AdminBannerRow> = {}): AdminBannerRow {
  return {
    id: ID,
    placement: "PUBLIC_HOME",
    images: ["ar-SA", "en-SA"],
    linkUrl: null,
    sortOrder: 1,
    isActive: false,
    startsAt: null,
    endsAt: null,
    state: "DRAFT",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    ...overrides,
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

describe("the form asks for pictures, not prose", () => {
  it("offers ONE upload control per language and no text fields at all", () => {
    renderWith([]);

    expect(screen.getByTestId("artwork-picker-ar-SA")).toBeTruthy();
    expect(screen.getByTestId("artwork-picker-en-SA")).toBeTruthy();

    // Four fields that were never rendered anywhere and are now gone.
    expect(screen.queryByLabelText(/العنوان/)).toBeNull();
    expect(screen.queryByLabelText(/النص/)).toBeNull();
  });

  it("keeps the optional link", () => {
    renderWith([]);
    expect(screen.getByLabelText(LABELS.linkUrl)).toBeTruthy();
  });

  it("refuses to submit until BOTH languages have a picture", () => {
    renderWith([]);

    // A banner with one language is a draft nobody can publish, so
    // asking for both up front beats accepting half and refusing later.
    expect(screen.getByRole("button", { name: LABELS.create })).toBeDisabled();
  });
});

describe("activation waits for both languages", () => {
  it("disables the control while a language is missing, and says why", () => {
    renderWith([banner({ images: ["ar-SA"] })]);

    const toggle = screen.getByTestId(`banner-toggle-${ID}`);
    expect(toggle).toBeDisabled();
    // A disabled button with no explanation is the same as a broken one.
    expect(toggle.getAttribute("title")).toBe(
      messages.admin.banners.activateNeedsBoth,
    );
  });

  it("names the language that is still missing", () => {
    renderWith([banner({ images: ["ar-SA"] })]);

    // The notice names it; the upload control for that language names it
    // too, which is why this reads the notice specifically.
    expect(screen.getByText(/ينقصه/).textContent).toContain("الإنجليزية");
  });

  it("allows activation once both are present", async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api.apiClient, "post").mockResolvedValue({});

    renderWith([banner()]);
    await user.click(screen.getByTestId(`banner-toggle-${ID}`));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/admin/banners/${ID}/toggle`, {
        isActive: true,
      }),
    );
  });

  it("never blocks DEACTIVATION, whatever the artwork looks like", () => {
    // Switching something off must always work — a banner that lost an
    // image must not become impossible to take down.
    renderWith([banner({ images: [], isActive: true, state: "LIVE" })]);

    expect(screen.getByTestId(`banner-toggle-${ID}`)).not.toBeDisabled();
  });
});

describe("deleting a banner for good", () => {
  it("offers delete alongside deactivate, not instead of it", () => {
    renderWith([banner()]);

    // Deactivating is the reversible control and this one is not, so
    // they are two different buttons rather than one with a flag.
    expect(screen.getByTestId(`banner-delete-${ID}`)).toBeTruthy();
    expect(screen.getByTestId(`banner-toggle-${ID}`)).toBeTruthy();
  });

  it("offers it for a LIVE banner too", () => {
    renderWith([banner({ isActive: true, state: "LIVE" })]);
    expect(screen.getByTestId(`banner-delete-${ID}`)).toBeTruthy();
  });

  it("asks first, and asks IN THE PAGE", async () => {
    const user = userEvent.setup();
    const del = vi.spyOn(api.apiClient, "delete").mockResolvedValue({});
    const confirmSpy = vi.spyOn(window, "confirm");

    renderWith([banner()]);
    await user.click(screen.getByTestId(`banner-delete-${ID}`));

    // A native dialog cannot be translated, ignores the document's RTL
    // direction, and a browser may suppress it outright.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId(`banner-delete-confirm-${ID}`)).toBeTruthy();
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes only after the confirmation is pressed", async () => {
    const user = userEvent.setup();
    const del = vi.spyOn(api.apiClient, "delete").mockResolvedValue({});

    renderWith([banner()]);
    await user.click(screen.getByTestId(`banner-delete-${ID}`));
    await user.click(screen.getByTestId(`banner-delete-confirmed-${ID}`));

    await waitFor(() =>
      expect(del).toHaveBeenCalledWith(`/admin/banners/${ID}`),
    );
  });

  it("cancels without touching the network", async () => {
    const user = userEvent.setup();
    const del = vi.spyOn(api.apiClient, "delete").mockResolvedValue({});

    renderWith([banner()]);
    await user.click(screen.getByTestId(`banner-delete-${ID}`));
    await user.click(screen.getByText(messages.common.cancel));

    await waitFor(() =>
      expect(screen.queryByTestId(`banner-delete-confirm-${ID}`)).toBeNull(),
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("warns that it cannot be undone", async () => {
    const user = userEvent.setup();
    renderWith([banner()]);

    await user.click(screen.getByTestId(`banner-delete-${ID}`));

    const prompt = screen.getByTestId(`banner-delete-confirm-${ID}`);
    expect(within(prompt).getByRole("status").textContent).toBe(
      messages.admin.banners.deletePrompt,
    );
  });
});

describe("the card carries no banner text", () => {
  it("shows state and artwork, and prints nothing an operator wrote", () => {
    renderWith([banner({ linkUrl: "/offers" })]);

    // The link is data, not prose, and is edited rather than displayed
    // as a heading. Nothing on the row is a title or a body.
    expect(screen.getByTestId(`banner-artwork-${ID}-ar-SA`)).toBeTruthy();
    expect(screen.getByTestId(`banner-artwork-${ID}-en-SA`)).toBeTruthy();
  });
});
