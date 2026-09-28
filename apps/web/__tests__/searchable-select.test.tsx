import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchableSelect } from "@/components/ui/searchable-select";

/**
 * A LONG LIST, PICKED BY TYPING.
 *
 * The branch form offered a `<select>` because there was one city in
 * it. With every governorate in the Kingdom on the list, a native
 * select is a scroll through a hundred and fifty rows for a word the
 * reader already knows.
 *
 * What is pinned here is the matching, because that is where a picker
 * fails quietly: it looks like it works, and then somebody types the
 * name they actually say and finds nothing.
 */
const CITIES = [
  { id: "1", name: "الرياض", group: "منطقة الرياض", alternateName: "Riyadh" },
  { id: "2", name: "الطائف", group: "منطقة مكة المكرمة", alternateName: "Taif" },
  { id: "3", name: "أبها", group: "منطقة عسير", alternateName: "Abha" },
  { id: "4", name: "الأحساء", group: "المنطقة الشرقية", alternateName: "Al Ahsa" },
  { id: "5", name: "جدة", group: "منطقة مكة المكرمة", alternateName: "Jeddah" },
];

function mount(onChange = vi.fn(), value = "") {
  render(
    <SearchableSelect
      value={value}
      options={CITIES}
      placeholder="ابحث عن مدينة"
      searchLabel="المدينة"
      emptyLabel="لا توجد مدينة بهذا الاسم"
      onChange={onChange}
      testId="picker"
    />
  );
  return onChange;
}

describe("picking from a long list", () => {
  it("shows every option before anything is typed", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByTestId("picker"));
    expect(screen.getAllByRole("option")).toHaveLength(CITIES.length);
  });

  it("narrows to what was typed", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByTestId("picker"));
    await user.type(screen.getByTestId("picker"), "جدة");

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("جدة");
  });

  it("finds a name typed without «ال»", async () => {
    // Everybody says «طائف» and writes «الطائف». A picker that only
    // matched from the first character would find nothing.
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByTestId("picker"));
    await user.type(screen.getByTestId("picker"), "طائف");

    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("treats the alef forms as one letter", async () => {
    // أ إ آ ا are typed interchangeably, and «الاحساء» must find
    // «الأحساء».
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByTestId("picker"));
    await user.type(screen.getByTestId("picker"), "احساء");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getAllByRole("option")[0].textContent).toContain("الأحساء");
  });

  it("finds an Arabic row by its English name", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByTestId("picker"));
    await user.type(screen.getByTestId("picker"), "Abha");

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getAllByRole("option")[0].textContent).toContain("أبها");
  });

  it("finds every city in a region by the region's name", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByTestId("picker"));
    await user.type(screen.getByTestId("picker"), "مكة");

    // Taif and Jeddah both sit in Makkah Region.
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("says so when nothing matches, rather than showing an empty box", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByTestId("picker"));
    await user.type(screen.getByTestId("picker"), "مدينة لا وجود لها");

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("لا توجد مدينة بهذا الاسم")).toBeTruthy();
  });

  it("reports the id, not the text", async () => {
    // The value is always one of the options or nothing at all — a
    // reader cannot leave half a name in the field and have the form
    // believe it.
    const user = userEvent.setup();
    const onChange = mount();

    await user.click(screen.getByTestId("picker"));
    await user.type(screen.getByTestId("picker"), "أبها");
    await user.click(screen.getByRole("option", { name: /أبها/ }));

    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("shows the chosen name once the list closes", () => {
    mount(vi.fn(), "2");

    expect(screen.getByTestId("picker")).toHaveValue("الطائف");
  });

  it("can be driven from the keyboard alone", async () => {
    const user = userEvent.setup();
    const onChange = mount();

    await user.click(screen.getByTestId("picker"));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    // Opened on the first row, moved to the third.
    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("shows the region under each name, so two alike are told apart", async () => {
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByTestId("picker"));
    expect(screen.getByText("منطقة عسير")).toBeTruthy();
  });
});
