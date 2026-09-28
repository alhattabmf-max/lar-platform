import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { GeographyManager } from "@/components/admin/geography-manager";
import messages from "@/messages/ar-SA.json";

/**
 * The regions and their cities, on one screen.
 *
 * WHAT THIS PINS is the hierarchy and the independence of the two
 * switches — the two things the screen exists to express:
 *
 *   · a city is drawn INSIDE its region, and a new city is added to the
 *     region whose button was pressed rather than to one chosen from a
 *     list, so there is no way to file it under the wrong one;
 *   · switching a region off and switching a city off are different
 *     acts with different consequences, and the screen asks a different
 *     question for each.
 */

const post = vi.fn();
const patch = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    patch: (...args: unknown[]) => patch(...args),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const catalogue = messages.admin.catalogue as Record<string, string>;

const LABELS = {
  addRegion: catalogue.addRegion,
  addCity: catalogue.addCity,
  nameAr: catalogue.nameAr,
  nameEn: catalogue.nameEn,
  add: catalogue.add,
  rename: catalogue.rename,
  save: catalogue.save,
  cancel: catalogue.cancel,
  activate: catalogue.activate,
  deactivate: catalogue.deactivate,
  deactivateRegionPrompt: catalogue.deactivateRegionPrompt,
  deactivateCityPrompt: catalogue.deactivateCityPrompt,
  activePill: catalogue.activePill,
  inactivePill: catalogue.inactivePill,
  regionInactiveNotice: catalogue.regionInactiveNotice,
  noCities: catalogue.noCities,
  working: catalogue.working,
  required: catalogue.required,
  notDeleteNotice: catalogue.notDeleteNotice,
  errorTitle: "تعذّر إتمام العملية",
  requestIdLabel: "معرّف الطلب",
};

const RIYADH = {
  id: "region-riyadh",
  nameAr: "منطقة الرياض",
  nameEn: "Riyadh Region",
  isActive: true,
  cities: [
    { id: "city-riyadh", nameAr: "الرياض", nameEn: "Riyadh", isActive: true },
    { id: "city-kharj", nameAr: "الخرج", nameEn: "Al Kharj", isActive: false },
  ],
};

const TABUK = {
  id: "region-tabuk",
  nameAr: "منطقة تبوك",
  nameEn: "Tabuk Region",
  isActive: false,
  cities: [{ id: "city-tabuk", nameAr: "تبوك", nameEn: "Tabuk", isActive: true }],
};

function renderManager(regions = [RIYADH, TABUK]) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <GeographyManager regions={regions} labels={LABELS} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
});

describe("the cities are inside their region, not beside it", () => {
  it("draws each city within its own region's block", () => {
    renderManager();

    const riyadh = screen.getByTestId(`region-${RIYADH.id}`);
    expect(within(riyadh).getByTestId("city-city-riyadh")).toBeInTheDocument();
    expect(within(riyadh).getByTestId("city-city-kharj")).toBeInTheDocument();
    // Tabuk's city belongs to Tabuk, and is not inside Riyadh.
    expect(within(riyadh).queryByTestId("city-city-tabuk")).toBeNull();
  });

  it("says so when a region has no cities, rather than showing nothing", () => {
    renderManager([{ ...RIYADH, cities: [] }]);

    expect(screen.getByText(catalogue.noCities)).toBeInTheDocument();
  });

  it("counts a region's cities", () => {
    renderManager([RIYADH]);

    // Two cities, through the catalogue's own plural rule.
    expect(screen.getByText("مدينتان")).toBeInTheDocument();
  });
});

describe("a new city goes under the region it was added from", () => {
  it("sends that region's id, with no picker to get wrong", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId(`add-city-${RIYADH.id}`));
    await user.type(screen.getByTestId("city-name-ar"), "الدرعية");
    await user.type(screen.getByTestId("city-name-en"), "Diriyah");
    await user.click(screen.getByTestId("save-city"));

    expect(post).toHaveBeenCalledWith("/admin/cities", {
      regionId: RIYADH.id,
      nameAr: "الدرعية",
      nameEn: "Diriyah",
    });
  });

  it("offers no add-city control under a switched-off region", () => {
    renderManager();

    // The API refuses to create a city under an inactive region, so the
    // control is not offered rather than offered and then refused.
    expect(screen.getByTestId(`add-city-${TABUK.id}`)).toBeDisabled();
  });
});

describe("the two switches are independent, and mean different things", () => {
  it("asks a region-shaped question before switching a region off", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId(`region-toggle-${RIYADH.id}`));

    expect(screen.getByText(catalogue.deactivateRegionPrompt)).toBeInTheDocument();
    // Nothing happens until the question is answered.
    expect(post).not.toHaveBeenCalled();
  });

  it("asks a city-shaped question before switching a city off", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId("city-toggle-city-riyadh"));

    expect(screen.getByText(catalogue.deactivateCityPrompt)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("switches a city off through the cities endpoint", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId("city-toggle-city-riyadh"));
    await user.click(screen.getByTestId("city-confirm-city-riyadh"));

    expect(post).toHaveBeenCalledWith("/admin/cities/city-riyadh/toggle");
  });

  it("switches a region off through the regions endpoint", async () => {
    const user = userEvent.setup();
    renderManager([RIYADH]);

    await user.click(screen.getByTestId(`region-toggle-${RIYADH.id}`));
    await user.click(screen.getByTestId(`region-confirm-${RIYADH.id}`));

    expect(post).toHaveBeenCalledWith(`/admin/regions/${RIYADH.id}/toggle`);
  });

  /**
   * SWITCHING SOMETHING ON RESTORES WHAT ALREADY EXISTED and asks
   * nothing. The question exists because switching off removes a row
   * from every picker on the platform, which is not symmetrical.
   */
  it("asks nothing before switching a city back on", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByTestId("city-toggle-city-kharj"));

    expect(post).toHaveBeenCalledWith("/admin/cities/city-kharj/toggle");
  });
});

describe("a control with no effect says so", () => {
  it("marks an active city whose region is switched off", () => {
    renderManager();

    const tabuk = screen.getByTestId("city-city-tabuk");
    expect(
      within(tabuk).getByText(catalogue.regionInactiveNotice),
    ).toBeInTheDocument();
  });

  it("does not mark a city whose region is active", () => {
    renderManager([RIYADH]);

    expect(screen.queryByText(catalogue.regionInactiveNotice)).toBeNull();
  });
});

describe("nothing here deletes", () => {
  it("says so on the screen", () => {
    renderManager();

    expect(screen.getByText(catalogue.notDeleteNotice)).toBeInTheDocument();
  });

  it("uses no native browser dialog for the confirmation", () => {
    // A native dialog cannot be translated, ignores the page direction,
    // and is suppressible by the browser — so the confirmation could
    // simply not appear.
    const confirmSpy = vi.spyOn(window, "confirm");
    renderManager();

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
