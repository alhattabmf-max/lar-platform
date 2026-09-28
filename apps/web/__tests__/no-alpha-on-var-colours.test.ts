import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A COLOUR THAT PAINTS NOTHING.
 *
 * Tailwind's slash modifier — `bg-primary/10`, `text-primary-foreground/85`
 * — builds a colour by substituting an alpha into the token behind the
 * utility. That only works when the token carries an `<alpha-value>`
 * placeholder. Every colour in this platform's config is a plain
 * `var(--color-…)` resolving to a plain hex, so the modifier builds
 * NOTHING and Tailwind drops the declaration entirely.
 *
 * IT FAILS SILENTLY, AND THAT IS WHY THIS FILE EXISTS. Nothing errors:
 * not `tsc`, not the build, not a render test that only checks class
 * names. What ships is an element painted the colour it inherited.
 *
 * IT HAS ALREADY COST THREE THINGS, all found by eye rather than by a
 * test:
 *
 *   · the portal navigation, whose inactive destinations fell back to
 *     near-black on the navy band — measured at 1.07:1, invisible;
 *   · the billing card's tinted icon discs, which did not paint at all;
 *   · the dialog scrim, a backdrop that was not there.
 *
 * THE FIX IS `color-mix`, which takes the tenant's own identity colour
 * and mixes it into a surface — so a re-themed brand still follows,
 * exactly as an opacity would have.
 *
 * WHAT IS ALLOWED is the modifier on a LITERAL colour — `bg-white/50`,
 * `bg-black/40` — where there is a real value to take an alpha from.
 */

const ROOT = join(__dirname, "..");

/** Every source file the browser actually renders from. */
function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry.name) && !full.includes("__tests__")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = [
  ...sources(join(ROOT, "components")),
  ...sources(join(ROOT, "app")),
];

/** Comments explaining the rule must not trip it. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The colour names this config backs with a bare `var()`.
 *
 * Read from the config rather than typed out, so a token added later is
 * covered without anybody remembering to add it here.
 */
const CONFIG = readFileSync(join(ROOT, "tailwind.config.ts"), "utf8");
const VAR_BACKED = [
  ...new Set(
    [...CONFIG.matchAll(/^\s*"?([a-z-]+)"?:\s*"var\(--color-[a-z-]+\)"/gm)].map(
      (m) => m[1],
    ),
  ),
];

describe("no opacity modifier on a colour this config backs with var()", () => {
  it("finds the tokens to check, so the sweep cannot pass on nothing", () => {
    expect(VAR_BACKED.length).toBeGreaterThan(5);
    expect(VAR_BACKED).toContain("surface");
  });

  it("finds the files to check", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it("uses none anywhere the browser renders", () => {
    // `bg-primary/5`, `text-accent-foreground/70`, `border-line/40` …
    const pattern = new RegExp(
      String.raw`\b(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|shadow|decoration|placeholder|caret|accent)-(?:${[
        ...VAR_BACKED,
        // The composed names the config nests under a colour.
        "primary-foreground",
        "accent-foreground",
        "accent-interactive",
        "content-muted",
      ].join("|")})\/\d`,
      "g",
    );

    const offenders: string[] = [];
    for (const file of FILES) {
      for (const hit of strip(readFileSync(file, "utf8")).matchAll(pattern)) {
        offenders.push(`${file.replace(ROOT, "")}: ${hit[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("the three that were caught by eye now mix instead", () => {
    // Named individually so a regression in any one of them reads as
    // itself rather than as a line in a sweep.
    for (const [file, needle] of [
      ["components/portal/portal-top-nav.tsx", "color-mix(in_srgb,var(--color-primary)"],
      ["components/company/billing-identity-card.tsx", "color-mix(in_srgb,var(--color-secondary)"],
      ["components/ui/dialog.tsx", "color-mix(in_srgb,var(--color-primary)"],
    ] as const) {
      expect([file, readFileSync(join(ROOT, file), "utf8").includes(needle)]).toEqual([
        file,
        true,
      ]);
    }
  });
});
