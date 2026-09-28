import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../messages/ar-SA.json";
import enMessages from "../messages/en-SA.json";
import { ListToolbar } from "@/components/admin/list-toolbar";
import {
  DataTablePagination,
  windowOf,
} from "@/components/admin/data-table-pagination";
import { PAGE_SIZES, parsePageSize } from "@/lib/admin-list-query";

/**
 * Searching and filtering a control panel list.
 *
 * THE PROPERTY UNDER TEST is that nothing has to be applied: typing
 * searches, choosing a filter filters, and the address is what the
 * server reads. So every assertion here is about which URL was
 * navigated to — that is the entire state, and a component that agreed
 * with itself but not with the address would be the bug.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const nav = vi.hoisted(() => ({
  pathname: "/ar-SA/admin/companies",
  search: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const LABELS = {
  openLabel: "بحث",
  regionLabel: "البحث والتصفية",
  searchLabel: "البحث",
  searchPlaceholder: "ابحث…",
  filtersPanelLabel: "خيارات التصفية",
  reset: "إعادة تعيين",
};

const SELECTS = [
  {
    name: "accountType",
    label: "نوع الحساب",
    options: [
      { value: "", label: "الكل" },
      { value: "SUPPLIER", label: "مورد" },
      { value: "TRADER", label: "تاجر" },
    ],
  },
  {
    name: "verificationStatus",
    label: "حالة التوثيق",
    options: [
      { value: "", label: "الكل" },
      { value: "VERIFIED", label: "موثّق" },
    ],
  },
];

/**
 * Rendered inside the REAL message catalogue, not a stand-in.
 *
 * The counted filter label is formatted by the component itself, so a
 * fixture string here would test the fixture. The bug being guarded —
 * a message path rendering on screen — only appears against the real
 * messages.
 */
function renderToolbar(
  search = "",
  locale: "ar-SA" | "en-SA" = "ar-SA",
  { open = true }: { open?: boolean } = {},
) {
  nav.search = search;
  const messages = locale === "ar-SA" ? arMessages : enMessages;
  const result = render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ListToolbar labels={LABELS} selects={SELECTS} />
    </NextIntlClientProvider>,
  );

  // THE CARD IS SHUT UNTIL ASKED FOR. Most cases here are about
  // what the fields do, so they open it first — the same press an
  // operator makes. A page that arrives already narrowed opens on
  // its own, so pressing again would shut it.
  const trigger = screen.queryByTestId("list-toolbar-open");
  const alreadyOpen =
    trigger?.getAttribute("aria-expanded") === "true";
  if (open && trigger && !alreadyOpen) fireEvent.click(trigger);

  return result;
}

beforeEach(() => {
  router.push.mockClear();
  router.replace.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("typing searches on its own", () => {
  it("waits for the typing to settle before asking the server", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar();

    await user.type(screen.getByTestId("list-toolbar-search"), "نهضة");

    // Not one request per keystroke: the answers would arrive out of
    // order and the last one to land would win.
    expect(router.replace).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace.mock.calls[0][0]).toBe(
      "/ar-SA/admin/companies?search=%D9%86%D9%87%D8%B6%D8%A9",
    );
  });

  it("REPLACES rather than pushing, so Back does not walk letter by letter", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar();

    await user.type(screen.getByTestId("list-toolbar-search"), "ab");
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalled();
  });

  it("answers Enter immediately instead of waiting out the delay", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar();

    await user.type(screen.getByTestId("list-toolbar-search"), "نهضة{Enter}");

    // Impatience is answered: the pending wait is dropped and the search
    // runs now — and as a real history entry, because it was deliberate.
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push.mock.calls[0][0]).toContain("search=");
  });

  it("restores the list when the box is cleared", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar("search=%D9%86%D9%87%D8%B6%D8%A9");

    await user.clear(screen.getByTestId("list-toolbar-search"));
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    // No `search=` at all rather than `search=`: an empty parameter is a
    // filter for the empty string.
    expect(router.replace).toHaveBeenCalledWith("/ar-SA/admin/companies", {
      scroll: false,
    });
  });

  it("follows the address when it changes underneath the box", () => {
    const view = renderToolbar("search=first");
    expect(
      (screen.getByTestId("list-toolbar-search") as HTMLInputElement).value,
    ).toBe("first");
    view.unmount();

    // Back, Reset, a pasted link — the box must not hold a value the
    // results no longer reflect.
    renderToolbar("search=second");
    expect(
      (screen.getByTestId("list-toolbar-search") as HTMLInputElement).value,
    ).toBe("second");
  });

  it("offers no Apply button at all", () => {
    renderToolbar();

    // It was a second decision on top of one the operator had already
    // made, and the only state it could create was the screen and the
    // controls disagreeing.
    const buttons = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons.join(" ")).not.toContain("تطبيق");
  });
});

describe("the card is shut until it is asked for", () => {
  it("shows no fields at all before the button is pressed", () => {
    // The card stood open above every list, pushing the rows down
    // the page, and most of the time nobody was searching.
    renderToolbar("", "ar-SA", { open: false });

    expect(screen.queryByTestId("list-toolbar")).toBeNull();
    expect(screen.queryByTestId("list-toolbar-select-accountType")).toBeNull();
  });

  it("offers one button, named «بحث»", () => {
    renderToolbar("", "ar-SA", { open: false });

    const trigger = screen.getByTestId("list-toolbar-open");
    expect(trigger.textContent).toContain("بحث");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens every field at once when it is pressed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar("", "ar-SA", { open: false });

    await user.click(screen.getByTestId("list-toolbar-open"));

    // No second disclosure inside: the card is already behind a
    // button, and a door behind a door is not a design.
    expect(screen.getByTestId("list-toolbar-search")).toBeTruthy();
    expect(screen.getByTestId("list-toolbar-select-accountType")).toBeTruthy();
    expect(screen.queryByTestId("list-toolbar-filters-toggle")).toBeNull();
  });

  it("opens on its own when the list arrived narrowed", () => {
    // A shut card over a filtered list is the one state worth
    // avoiding: the rows are not all the rows, and nothing on screen
    // would say why.
    renderToolbar("accountType=SUPPLIER", "ar-SA", { open: false });

    expect(screen.getByTestId("list-toolbar")).toBeTruthy();
    expect(screen.getByTestId("list-toolbar-open").getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("carries the count while it is shut", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar("accountType=SUPPLIER&verificationStatus=VERIFIED", "ar-SA", {
      open: false,
    });

    await user.click(screen.getByTestId("list-toolbar-open"));

    expect(screen.queryByTestId("list-toolbar")).toBeNull();
    expect(screen.getByTestId("list-toolbar-open").textContent).toContain("2");
  });

  it("says no number when nothing is narrowed", () => {
    renderToolbar("", "ar-SA", { open: false });

    expect(screen.getByTestId("list-toolbar-open").textContent?.trim()).toBe(
      "بحث",
    );
  });

  it("closing it clears no value", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar("accountType=SUPPLIER");

    await user.click(screen.getByTestId("list-toolbar-open"));
    await user.click(screen.getByTestId("list-toolbar-open"));

    expect(
      (
        screen.getByTestId("list-toolbar-select-accountType") as HTMLSelectElement
      ).value,
    ).toBe("SUPPLIER");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("navigates nowhere when it is pressed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar("", "ar-SA", { open: false });

    await user.click(screen.getByTestId("list-toolbar-open"));

    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("puts the page's own actions on the same row, at the other end", () => {
    render(
      <NextIntlClientProvider locale="ar-SA" messages={arMessages}>
        <ListToolbar
          labels={LABELS}
          selects={SELECTS}
          actions={<button type="button">تصدير</button>}
        />
      </NextIntlClientProvider>,
    );

    const row = screen.getByTestId("list-toolbar-open").parentElement;
    expect(row?.className).toContain("justify-between");
    expect(row?.textContent).toContain("تصدير");
  });
});

describe("choosing a filter IS applying it", () => {
  it("navigates the moment a select changes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar();

    await user.selectOptions(
      screen.getByTestId("list-toolbar-select-accountType"),
      "SUPPLIER",
    );

    expect(router.push).toHaveBeenCalledWith(
      "/ar-SA/admin/companies?accountType=SUPPLIER",
      {
        scroll: false,
      },
    );
  });

  it("removes the parameter when the empty option is chosen", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar("accountType=SUPPLIER");

    await user.selectOptions(
      screen.getByTestId("list-toolbar-select-accountType"),
      "",
    );

    expect(router.push).toHaveBeenCalledWith("/ar-SA/admin/companies", {
      scroll: false,
    });
  });

  it("keeps the other filters and the search", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar("search=x&verificationStatus=VERIFIED");

    await user.selectOptions(
      screen.getByTestId("list-toolbar-select-accountType"),
      "TRADER",
    );

    const url = router.push.mock.calls[0][0] as string;
    expect(url).toContain("search=x");
    expect(url).toContain("verificationStatus=VERIFIED");
    expect(url).toContain("accountType=TRADER");
  });
});

describe("any change returns to the first page", () => {
  it("drops the page number when a filter changes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar("page=4");

    await user.selectOptions(
      screen.getByTestId("list-toolbar-select-accountType"),
      "SUPPLIER",
    );

    // Page 4 of a result set that now has one page renders empty and
    // reads as "nothing matched".
    expect(router.push.mock.calls[0][0]).not.toContain("page=");
  });

  it("drops it when the search changes too", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar("page=3");

    await user.type(screen.getByTestId("list-toolbar-search"), "z");
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(router.replace.mock.calls[0][0]).not.toContain("page=");
  });
});

describe("reset appears only when there is something to undo", () => {
  it("is absent on an untouched list", () => {
    renderToolbar();

    expect(screen.queryByTestId("list-toolbar-reset")).toBeNull();
  });

  it("appears for a search", () => {
    renderToolbar("search=x");

    expect(screen.getByTestId("list-toolbar-reset")).toBeTruthy();
  });

  it("appears for a filter", () => {
    renderToolbar("accountType=SUPPLIER");

    expect(screen.getByTestId("list-toolbar-reset")).toBeTruthy();
  });

  it("clears the search, the filters and the page together", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar(
      "search=x&accountType=SUPPLIER&verificationStatus=VERIFIED&page=5",
    );

    await user.click(screen.getByTestId("list-toolbar-reset"));

    expect(router.push).toHaveBeenCalledWith("/ar-SA/admin/companies", {
      scroll: false,
    });
  });

  it("leaves query parameters it does not own alone", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderToolbar("search=x&pageSize=50");

    await user.click(screen.getByTestId("list-toolbar-reset"));

    // Rows-per-page is the reader's own display choice, not a filter.
    expect(router.push.mock.calls[0][0]).toContain("pageSize=50");
  });
});

// ------------------------------------------------------------ pagination

describe("the pager keeps the filters", () => {
  const LABELS_P = {
    navLabel: "تنقل بين الصفحات",
    first: "الصفحة الأولى",
    previous: "السابق",
    next: "التالي",
    last: "الصفحة الأخيرة",
    rowsPerPage: "عرض",
    rowsPerPageUnit: "صف لكل صفحة",
    range: "عرض 1–25 من 120",
  };

  function renderPager(page: number, total: number, search = "") {
    nav.search = search;
    // Inside the real catalogue: "Page 3" is formatted by the pager, so
    // a fixture string would test the fixture.
    return render(
      <NextIntlClientProvider locale="ar-SA" messages={arMessages}>
        <DataTablePagination
          page={page}
          pageSize={25}
          total={total}
          labels={LABELS_P}
        />
      </NextIntlClientProvider>,
    );
  }

  it("carries the search into a page link", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPager(1, 120, "search=x&accountType=SUPPLIER");

    await user.click(screen.getByTestId("pagination-next"));

    const url = router.push.mock.calls[0][0] as string;
    expect(url).toContain("search=x");
    expect(url).toContain("accountType=SUPPLIER");
    expect(url).toContain("page=2");
  });

  it("leaves page 1 implicit", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPager(2, 120);

    await user.click(screen.getByTestId("pagination-previous"));

    expect(router.push).toHaveBeenCalledWith("/ar-SA/admin/companies", {
      scroll: false,
    });
  });

  it("disables previous on the first page and next on the last", () => {
    const first = renderPager(1, 120);
    expect(
      (screen.getByTestId("pagination-previous") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("pagination-next") as HTMLButtonElement).disabled,
    ).toBe(false);
    first.unmount();

    renderPager(5, 120);
    expect(
      (screen.getByTestId("pagination-previous") as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByTestId("pagination-next") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("uses BUTTONS for the ends, because a disabled link is not a thing", () => {
    renderPager(1, 120);

    // An `<a>` with aria-disabled is still focusable and still
    // activates.
    expect(screen.getByTestId("pagination-previous").tagName).toBe("BUTTON");
    expect(screen.getByTestId("pagination-first").tagName).toBe("BUTTON");
  });

  it("marks the current page for a screen reader", () => {
    renderPager(3, 120);

    expect(screen.getByTestId("pagination-page-3")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("pagination-page-2")).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("names every numbered button", () => {
    renderPager(1, 120);

    expect(screen.getByTestId("pagination-page-2")).toHaveAttribute(
      "aria-label",
      "الصفحة 2",
    );
  });

  it("shows the range and the total", () => {
    renderPager(1, 120);

    expect(screen.getByTestId("pagination-range").textContent).toBe(
      "عرض 1–25 من 120",
    );
  });

  it("changes the rows per page and returns to the start", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPager(3, 500);

    await user.selectOptions(screen.getByTestId("rows-per-page"), "100");

    const url = router.push.mock.calls[0][0] as string;
    expect(url).toContain("pageSize=100");
    // A larger page makes the old page number mean something else.
    expect(url).not.toContain("page=");
  });

  it("offers exactly the three approved sizes", () => {
    renderPager(1, 500);

    const options = Array.from(
      screen.getByTestId("rows-per-page").querySelectorAll("option"),
    ).map((option) => option.value);
    expect(options).toEqual(["25", "50", "100"]);
    expect(PAGE_SIZES).toEqual([25, 50, 100]);
  });
});

describe("which page numbers are drawn", () => {
  it("draws them all when there are few", () => {
    expect(windowOf(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses the middle when there are many", () => {
    // A hundred buttons is not navigation.
    expect(windowOf(50, 100)).toEqual([1, "gap", 49, 50, 51, "gap", 100]);
  });

  it("puts no gap where nothing is skipped", () => {
    expect(windowOf(2, 8)).toEqual([1, 2, 3, "gap", 8]);
  });

  it("stays inside the range at both ends", () => {
    expect(windowOf(1, 20)).toEqual([1, 2, "gap", 20]);
    expect(windowOf(20, 20)).toEqual([1, "gap", 19, 20]);
  });
});

describe("reading the rows-per-page from the address", () => {
  it.each([
    ["25", 25],
    ["50", 50],
    ["100", 100],
  ])("accepts %s", (raw, expected) => {
    expect(parsePageSize(raw)).toBe(expected);
  });

  it.each([["5000"], ["0"], ["-1"], ["abc"], [undefined]])(
    "falls back for %s rather than passing it through",
    (raw) => {
      // The API caps at 100, so a request for 5000 would be silently
      // clamped into a page whose number then means something different
      // from what the address says.
      expect(parsePageSize(raw)).toBe(25);
    },
  );

  it("takes the first of a repeated parameter", () => {
    expect(parsePageSize(["50", "100"])).toBe(50);
  });
});

describe("the button says how narrow the list is, without a message path", () => {
  /**
   * WHAT THIS REPRODUCES.
   *
   * The count used to be translated on the SERVER —
   * `toolbar("filtersWithCount")` — for a message carrying a {count} the
   * server does not have. next-intl does not throw on a missing value:
   * it returns the MESSAGE PATH, so the button read
   * `admin.toolbar.filtersWithCount` on screen.
   *
   * The count is a bare number now, beside a fixed word, so there is no
   * placeholder left to leave unfilled. This holds that shut.
   */
  it.each([
    ["ar-SA", "", "بحث"],
    ["ar-SA", "accountType=SUPPLIER", "بحث1"],
    ["ar-SA", "accountType=SUPPLIER&verificationStatus=VERIFIED", "بحث2"],
    ["en-SA", "", "بحث"],
    ["en-SA", "accountType=SUPPLIER&verificationStatus=VERIFIED", "بحث2"],
  ] as const)("%s with %s reads %s", (locale, search, expected) => {
    renderToolbar(search, locale, { open: false });

    const trigger = screen.getByTestId("list-toolbar-open");
    const withoutSpaces = (trigger.textContent ?? "")
      .split(/\s/)
      .join("");
    expect(withoutSpaces).toBe(expected);
    // The fault itself: never a dotted path on screen.
    expect(trigger.textContent).not.toContain("admin.toolbar");
  });
});

describe("reset clears everything the card can narrow by", () => {
  /**
   * THE FAULT THIS PINS, reported from the real console: «شيك البحث في
   * زر المنتجات والمنتجات المعروضة، عند إعادة تعيين لا يقبل ويعلّق».
   *
   * A supplier chooser had been added as a THIRD kind of filter beside
   * the selects and the dates, and reset only ever deleted the two it
   * knew about. So its parameter survived the press: the list stayed
   * narrowed, the button stayed lit, and pressing again did nothing —
   * which reads exactly like a page that has hung.
   *
   * THE CURE WAS TO STOP HAVING A THIRD KIND — every filter on this
   * card is a select now, and reset walks the same list that draws
   * them. This is the guard that says so: whatever the card is given
   * to narrow by, the press must clear ALL of it.
   */
  it("deletes every select's parameter, not only the ones it draws first", () => {
    renderToolbar("?accountType=SUPPLIER&verificationStatus=VERIFIED&search=x&page=3");

    fireEvent.click(screen.getByTestId("list-toolbar-reset"));

    expect(router.push).toHaveBeenCalledTimes(1);
    const [href] = router.push.mock.calls[0];
    const query = new URLSearchParams(String(href).split("?")[1] ?? "");

    for (const select of SELECTS) {
      expect([select.name, query.get(select.name)]).toEqual([select.name, null]);
    }
    expect(query.get("search")).toBeNull();
    // AND THE PAGE, because page four of a list that no longer has one
    // renders empty and reads as a broken screen.
    expect(query.get("page")).toBeNull();
  });

  it("leaves a parameter the card knows nothing about", () => {
    // The tab a register is on lives in the address beside the
    // filters, and clearing the filters must not throw the reader
    // out of the half they were reading.
    renderToolbar("?accountType=SUPPLIER&tab=suppliers");

    fireEvent.click(screen.getByTestId("list-toolbar-reset"));

    const [href] = router.push.mock.calls[0];
    const query = new URLSearchParams(String(href).split("?")[1] ?? "");
    expect(query.get("tab")).toBe("suppliers");
  });
});
