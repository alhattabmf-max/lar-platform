import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import InheritsPage from "./fixtures/inherits-page";

/**
 * A NEW PAGE INHERITS THE WHOLE IDENTITY, WITH NO CSS OF ITS OWN.
 *
 * The fixture beside this test is written the way somebody adding a
 * screen next year would write one: shared components, and layout. It
 * names no height, no padding, no radius, no colour and no shadow.
 *
 * What follows measures what it got anyway. If any of it fails, the
 * system is not in the components — it is in the pages, which is the
 * thing this was built to end.
 */
const ROOT = join(__dirname, "..");
const FIXTURE = readFileSync(
  join(ROOT, "__tests__", "fixtures", "inherits-page.tsx"),
  "utf8"
);

describe("the fixture asks for nothing", () => {
  it("writes no measurement, colour, radius or shadow", () => {
    // Layout is allowed — where things sit is the page's business.
    // How they LOOK is the system's.
    // The prose above the fixture says the words «shadow» and
    // «measurement» to explain what it does not do; only the code is
    // the claim.
    const code = FIXTURE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /(^|[^:])\/\/.*$/gm,
      "$1"
    );

    const layoutOnly = code.replace(/className="[^"]*"/g, (whole) =>
      /^className="(flex|grid)[a-z0-9- ]*"$/.test(whole) ? "" : whole
    );

    expect(layoutOnly).not.toMatch(/className=/);
    expect(code).not.toMatch(/px-|py-|min-h-|rounded|shadow|bg-|text-\[/);
  });
});

describe("and gets the identity anyway", () => {
  it("gives every button the one height and the raised surface", () => {
    render(<InheritsPage />);

    for (const button of screen.getAllByRole("button")) {
      // 32px, from `--control-height-button`.
      expect(button.className).toContain("min-h-control");
      expect(button.className).toContain("px-control-x");
      expect(button.className).toContain("py-control-y");
      expect(button.className).toContain("rounded-control");
      expect(button.className).toContain("gap-control-gap");
      // Raised, and sinking on the press.
      expect(button.className).toMatch(/shadow-raised|shadow-none/);
    }
  });

  it("gives the pressed state to every button that can be pressed", () => {
    render(<InheritsPage />);

    const pressable = screen
      .getAllByRole("button")
      .filter((button) => !(button as HTMLButtonElement).disabled);

    for (const button of pressable) {
      expect(button.className).toContain("active:shadow-pressed");
    }
  });

  it("sinks the text fields and never raises one", () => {
    render(<InheritsPage />);

    const text = screen.getByLabelText("حقل نصّي");
    expect(text.className).toContain("shadow-inset");
    expect(text.className).not.toMatch(/shadow-(raised|soft|card)/);
    expect(text.className).toContain("h-field");
    expect(text.className).toContain("px-control-x");
  });

  it("gives the textarea the same skin without the fixed height", () => {
    render(<InheritsPage />);

    const area = screen.getByLabelText("نصّ طويل");
    expect(area.className).toContain("shadow-inset");
    // 36px is what makes a single-line field a single line.
    expect(area.className).not.toContain("h-field");
  });

  it("lifts the choosers, and less than a button", () => {
    render(<InheritsPage />);

    for (const label of ["تاريخ", "اختيار"]) {
      const chooser = screen.getByLabelText(label);
      expect(chooser.className).toContain("shadow-soft");
      expect(chooser.className).not.toContain("shadow-raised");
      expect(chooser.className).toContain("h-field");
    }
  });

  it("carries the error state as a border, not a second shadow", () => {
    render(<InheritsPage />);

    const bad = screen.getByLabelText("حقل بخطأ");
    expect(bad.getAttribute("aria-invalid")).toBe("true");
    expect(bad.className).toContain("aria-[invalid=true]:border-danger");
  });

  it("carries the disabled state on the control that has it", () => {
    render(<InheritsPage />);

    const off = screen.getByRole("button", { name: "معطّل" });
    expect((off as HTMLButtonElement).disabled).toBe(true);
    expect(off.className).toContain("disabled:opacity-[var(--state-disabled-opacity)]");
    // A raised rectangle that refuses to be pressed is a lie.
    expect(off.className).toContain("disabled:shadow-none");
  });

  it("carries the loading state, announced as well as drawn", () => {
    render(<InheritsPage />);

    const busy = screen.getByRole("button", { name: "قيد التنفيذ" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((busy as HTMLButtonElement).disabled).toBe(true);
  });

  it("gives the card 8 down, 12 across, and lifts it less than a button", () => {
    const { container } = render(<InheritsPage />);

    const card = container.querySelector("section");
    expect(card?.className).toContain("shadow-card");
    expect(card?.className).not.toContain("shadow-raised");

    const body = card?.querySelector("div:last-child");
    expect(body?.className).toContain("px-card-x");
    expect(body?.className).toContain("py-card-y");
    // Never sixteen.
    expect(body?.className).not.toMatch(/p[xy]-4/);
  });

  it("spaces what is inside the card by the card's own gap", () => {
    const { container } = render(<InheritsPage />);
    const body = container.querySelector("section > div:last-child");
    expect(body?.className).toContain("mt-card-gap");
  });
});
