import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Money } from "@/components/ui/money";
import { Riyal, RIYAL_ASPECT } from "@/components/ui/riyal";
import { formatMoney, formatMoneyParts } from "@/lib/money";

/**
 * THE OFFICIAL SAUDI RIYAL SYMBOL, EVERYWHERE AN AMOUNT APPEARS.
 *
 * «ر.س» is an abbreviation and "SAR" is an ISO code; neither is the
 * mark. The 2025 symbol has no Unicode code point — U+FDFC ﷼ is the
 * OLD sign and a different shape — so it cannot be a character in a
 * formatted string and has to be drawn.
 *
 * WHAT DID NOT CHANGE, and these cases exist to keep it that way: the
 * amounts, the arithmetic (there is none), and the `SAR` code on the
 * wire and in every payload. This is display, and only display.
 */
const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(full) ? [full] : [];
  });
}

const SOURCE = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];
const name = (file: string) => relative(ROOT, file).split("\\").join("/");

describe("the symbol itself", () => {
  const SVG = read("components/ui/riyal.tsx");

  it("carries the official artwork, unaltered", () => {
    // The two paths from the supplied file, and the viewBox they were
    // drawn in. A redrawn or re-exported mark is a different mark.
    expect(SVG).toContain('viewBox="0 0 1124.14 1256.39"');
    expect(SVG).toContain("M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37");
    expect(SVG).toContain("M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37");
    expect(RIYAL_ASPECT).toBeCloseTo(1124.14 / 1256.39, 6);
  });

  it("wears the identity colour, as a TOKEN and never a hex", () => {
    // #0F766E is the owner's choice and is exactly `--color-secondary`.
    // Writing the hex here would be a second source of truth for a
    // colour a re-themed brand has to be able to move.
    expect(SVG).toContain('"text-secondary"');
    // Comments stripped first, the way the platform's own hex guard
    // does it: the prose above names both #0F766E and the fill the
    // file shipped with, which is the record of the decision.
    const code = SVG.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /(^|[^:])\/\/.*$/gm,
      "$1",
    );
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(SVG).toContain('fill="currentColor"');
  });

  it("is sized in em, so it belongs to the type around it", () => {
    render(<Riyal />);
    const svg = document.querySelector("svg")!;
    expect(svg.getAttribute("style")).toMatch(/height:\s*0\.82em/);
    expect(svg.getAttribute("style")).toMatch(/width:\s*[\d.]+em/);
  });

  it("is decorative — the words are what a screen reader hears", () => {
    render(<Riyal />);
    expect(document.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("an amount", () => {
  it("puts the symbol on the LEFT in both languages", () => {
    // `Intl` puts the currency before the number in English and after
    // it in Arabic. The owner chose one side for the whole platform.
    for (const locale of ["ar-SA", "en-SA"] as const) {
      render(<Money amount="1234.50" currency="SAR" locale={locale} />);
      const box = screen.getAllByTestId("money").at(-1)!;
      const svg = box.querySelector("svg")!;
      // The drawing comes before the digits in document order, and the
      // pair is isolated so bidi cannot reorder them.
      expect([locale, box.getAttribute("dir")]).toEqual([locale, "ltr"]);
      expect([
        locale,
        svg.compareDocumentPosition(box.lastChild!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ]).toEqual([locale, Node.DOCUMENT_POSITION_FOLLOWING]);
      expect([locale, box.textContent]).toEqual([
        locale,
        expect.stringContaining("1,234.50"),
      ]);
    }
  });

  it("separates the mark from the digits with a thin space", () => {
    render(<Money amount="10.00" currency="SAR" locale="ar-SA" />);
    expect(screen.getByTestId("money").textContent).toContain("\u2009");
  });

  it("still announces the currency in words", () => {
    render(<Money amount="10.00" currency="SAR" locale="en-SA" />);
    // What a reader heard before the mark was drawn, unchanged.
    expect(screen.getByTestId("money").textContent).toContain("SAR");
  });

  it("changes no figure — the digits are `formatMoney`'s own", () => {
    for (const locale of ["ar-SA", "en-SA"] as const) {
      const parts = formatMoneyParts("1234.50", "SAR", locale)!;
      const whole = formatMoney("1234.50", "SAR", locale)!;
      expect([locale, whole.includes(parts.number)]).toEqual([locale, true]);
      expect([locale, parts.number]).toEqual([locale, "1,234.50"]);
    }
  });

  it("renders a malformed amount as its fallback, never as a zero", () => {
    render(
      <Money amount="not-a-number" currency="SAR" locale="ar-SA" fallback="—" />,
    );
    expect(screen.queryByTestId("money")).toBeNull();
    expect(document.body.textContent).toBe("—");
  });

  it("leaves a currency that is NOT the riyal as text", () => {
    // A second currency arriving later must print its own code rather
    // than borrow this symbol.
    render(<Money amount="10.00" currency="USD" locale="en-SA" />);
    expect(document.querySelector("svg")).toBeNull();
    expect(document.body.textContent).toContain("$");
  });
});

describe("nothing prints the abbreviation any more", () => {
  it("leaves no «ر.س» or bare SAR beside an amount in the components", () => {
    const offenders: string[] = [];

    for (const file of SOURCE) {
      // The money component itself names the code, to decide on it.
      if (name(file) === "components/ui/money.tsx") continue;
      const code = read(name(file))
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");

      // A rendered «ر.س» — as opposed to `const SAR = "SAR"`, which is
      // the code the API speaks and stays.
      for (const found of code.matchAll(/>[^<>{]*ر\.س/g)) {
        offenders.push(`${name(file)} :: ${found[0].trim().slice(0, 40)}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps `SAR` as the CODE, which nothing about this touched", () => {
    // It is what `Intl` is asked for and what every payload carries.
    expect(read("components/supplier/dashboard-cards.tsx")).toContain(
      'const SAR = "SAR"',
    );
    expect(read("components/ui/money.tsx")).toContain('const SAR = "SAR"');
  });
});
