import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PORTAL_STRIP_SLOT } from "@/components/portal/portal-page-bar";

/**
 * THE DASHBOARD'S ROW ENDS UP IN THE STRIP, and this renders it to
 * prove it rather than grepping for `createPortal`.
 *
 * «احذف الصف اللي أنا مصوّره وانقله للشريط حق اللسان في الرئيسية» —
 * the last-updated time, the refresh and the period chooser used to
 * stand in a row above the cards. A portal is the only mechanism that
 * moves them without moving their DATA: both controls need what only
 * the page has — the instant its figures were read, and the period the
 * reader chose — and a copy of either in the chrome would be a second
 * source of truth.
 *
 * WHAT A SOURCE CHECK CANNOT SEE is whether the portal finds its slot.
 * That depends on the node existing by the time an effect runs, which
 * is a fact about mounting, not about the text of the file.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ar-SA/supplier",
  useSearchParams: () => new URLSearchParams(),
}));

const { DashboardHeader } = await import("@/components/supplier/dashboard-header");

const LABELS = {
  title: "لوحة التحكم",
  lastUpdated: "آخر تحديث",
  refresh: "تحديث",
  periodLabel: "المدة",
  periods: { "7d": "آخر 7 أيام", "30d": "آخر 30 يومًا", "90d": "آخر 90 يومًا" },
} as never;

/** The strip, as the layout draws it: a slot, and a page beneath it. */
function draw() {
  return render(
    <div>
      <div data-testid="strip">
        <div id={PORTAL_STRIP_SLOT} />
      </div>
      <main data-testid="page">
        <DashboardHeader period="30d" generatedAtLabel="7:02 ص" labels={LABELS} />
      </main>
    </div>,
  );
}

describe("the dashboard's row", () => {
  it("lands inside the strip, not in the page it is written in", () => {
    const { getByTestId } = draw();

    const strip = getByTestId("strip");
    const page = getByTestId("page");

    for (const testid of ["last-updated", "dashboard-refresh", "dashboard-period"]) {
      const control = screen.getByTestId(testid);
      expect([testid, strip.contains(control)]).toEqual([testid, true]);
      expect([testid, page.contains(control)]).toEqual([testid, false]);
    }
  });

  it("stands the period chooser at the height of the button beside it", () => {
    // «الزر حق آخر 90 يومًا عريض، خلّه 32 بكسل ارتفاعه ووازنه مع الزر
    // اللي جنبه». A chooser is 36px in a form column because text sits
    // in it and it lines up with the fields around it. In a TOOLBAR it
    // lines up with a button instead, and 36 beside 32 is two shapes
    // that nearly agree — which reads worse than either on its own.
    draw();

    const period = screen.getByTestId("dashboard-period");
    const refresh = screen.getByTestId("dashboard-refresh");

    // THE BUTTON'S TOKEN, not a pixel typed here: the pairing survives
    // the day somebody changes what a button measures.
    expect(period.className).toContain("h-control");
    expect(period.className).not.toContain("h-field");
    expect(refresh.className).toContain("min-h-control");
  });

  it("leaves the page's own heading in the page", () => {
    // The tab above carries the name on screen; the heading stays for
    // the document outline, and it belongs where a reader walking the
    // document expects it — not in the chrome.
    const { getByTestId } = draw();

    const heading = screen.getByRole("heading", { level: 1 });
    expect(getByTestId("page").contains(heading)).toBe(true);
    expect(getByTestId("strip").contains(heading)).toBe(false);
  });

  it("carries the page's own data with it", () => {
    // The time was read on the server and the period came from the
    // address. Neither is re-derived in the chrome, which is the whole
    // reason the row moves rather than being rebuilt there.
    draw();

    expect(screen.getByTestId("last-updated").textContent).toContain("7:02 ص");
    expect((screen.getByTestId("dashboard-period") as HTMLSelectElement).value).toBe(
      "30d",
    );
  });
});
