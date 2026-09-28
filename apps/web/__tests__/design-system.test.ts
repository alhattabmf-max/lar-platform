import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SOFT ELEVATION, HELD SHUT.
 *
 * The system is only a system while nothing goes round it. Everything
 * here is a rule a page could break by accident and never notice — a
 * `px-3 py-2` typed into a div, a raw `<input>`, a shadow chosen by how
 * dark it looks. Each one, once, would be nothing; each one repeated is
 * how a platform ends up with four button heights.
 *
 * WHAT THIS DOES NOT DO is check how anything LOOKS. It checks that the
 * decision was taken centrally. The appearance is the tokens' business.
 */
const ROOT = join(__dirname, "..");
const GLOBALS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
const TAILWIND = readFileSync(join(ROOT, "tailwind.config.ts"), "utf8");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if ([".next", "node_modules"].includes(entry)) return [];
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx$/.test(full) ? [full] : [];
  });
}

const SOURCE = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];
const name = (file: string) => relative(ROOT, file).split("\\").join("/");
const read = (file: string) => readFileSync(file, "utf8");

/**
 * Every opening tag of one element, whole.
 *
 * `/<button[^>]*>/` LOOKS right and is not: `onClick={() => x}` carries
 * a `>` of its own, so the match ends at the arrow and everything after
 * it — usually the className — is never seen. That silently turned real
 * buttons into "no className" and would have had me dressing controls
 * that were already dressed. Braces and quotes are tracked so the tag
 * ends where it actually ends.
 */
function tags(code: string, element: string): string[] {
  const found: string[] = [];

  for (const start of code.matchAll(new RegExp(`<${element}\\b`, "g"))) {
    let depth = 0;
    let quote = "";

    for (let i = start.index!; i < code.length; i += 1) {
      const ch = code[i];

      if (quote) {
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) {
        found.push(code.slice(start.index!, i + 1));
        break;
      }
    }
  }

  return found;
}

/** Where a raw control is the component the system is built FROM. */
const OWNS_THE_PRIMITIVE = [
  "components/ui/field.tsx",
  "components/ui/select.tsx",
  "components/ui/searchable-select.tsx",
];

// =====================================================================
// The tokens exist, and say what they mean
// =====================================================================
describe("the tokens", () => {
  const REQUIRED = [
    "--control-height-button",
    "--control-height-field",
    "--control-pad-y-button",
    "--control-pad-x",
    "--control-icon",
    "--control-icon-gap",
    "--control-radius",
    "--control-font-size",
    "--control-line-height",
    "--control-font-weight",
    "--card-pad-y",
    "--card-pad-y-sectioned",
    "--card-pad-x",
    "--card-gap",
    "--elevation-inset",
    "--elevation-raised",
    "--elevation-soft",
    "--elevation-card",
    "--elevation-overlay",
    "--elevation-divide",
    "--elevation-pressed",
    "--nav-item-height",
    "--color-field-fill",
    "--state-hover-opacity",
    "--state-disabled-opacity",
  ];

  it.each(REQUIRED)("defines %s", (token) => {
    expect(GLOBALS).toContain(`${token}:`);
  });

  it("carries the approved measurements", () => {
    // 32px button, 36px field, 8/12/8 card, 8px radius, 16px icon.
    expect(GLOBALS).toMatch(/--control-height-button:\s*2rem/);
    expect(GLOBALS).toMatch(/--control-height-field:\s*2\.25rem/);
    expect(GLOBALS).toMatch(/--control-pad-y-button:\s*0\.375rem/);
    expect(GLOBALS).toMatch(/--control-pad-x:\s*0\.75rem/);
    expect(GLOBALS).toMatch(/--control-icon:\s*1rem/);
    expect(GLOBALS).toMatch(/--control-icon-gap:\s*0\.5rem/);
    expect(GLOBALS).toMatch(/--control-font-size:\s*0\.875rem/);
    expect(GLOBALS).toMatch(/--control-line-height:\s*1\.25rem/);
    expect(GLOBALS).toMatch(/--card-pad-y:\s*0\.5rem/);
    expect(GLOBALS).toMatch(/--card-pad-x:\s*0\.75rem/);
    expect(GLOBALS).toMatch(/--card-gap:\s*0\.5rem/);
    expect(GLOBALS).toMatch(/--card-pad-y-sectioned:\s*0\.75rem/);
  });

  it("reaches Tailwind, so a component can use them by name", () => {
    for (const utility of [
      "control:",
      "raised:",
      "inset:",
      "soft:",
      "card:",
      "overlay:",
      "pressed:",
      '"control-x"',
      '"card-x"',
      '"card-y"',
    ]) {
      expect(TAILWIND).toContain(utility);
    }
  });

  it("keeps every indicator that survived the outline coming off", () => {
    // THE ONE PLACE THE REFERENCE AND THE RULES DISAGREE, and the
    // owner decided it: form controls carry no outline at rest, which
    // is what the reference draws. WCAG 1.4.11 asks 3:1 of a resting
    // boundary and no light fill reaches it — #EEF2F7 on white is
    // 1.12:1 — so that is a known, accepted cost, not an oversight.
    //
    // WHAT THIS HOLDS IS EVERYTHING ELSE. A reader who cannot pick the
    // box out at rest must still see where they are, what went wrong,
    // and what they typed. Those three cannot quietly erode too.
    const luminance = (hex: string) => {
      const parts = hex.replace("#", "").match(/../g)!;
      const channels = parts
        .map((pair) => parseInt(pair, 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const ratio = (a: string, b: string) => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (light + 0.05) / (dark + 0.05);
    };

    const hex = (token: string) => {
      const found = GLOBALS.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`));
      expect([token, found !== null]).toEqual([token, true]);
      return found![1];
    };

    const fill = hex("--color-field-fill");
    const focus = hex("--color-focus-ring");
    const danger = hex("--color-danger");
    const text = hex("--color-text");
    const surface = hex("--color-surface");

    // WHERE YOU ARE: the focus ring, against the field it rings.
    expect(ratio(focus, fill)).toBeGreaterThanOrEqual(3);

    // WHAT WENT WRONG: the error border, against the card behind it.
    expect(ratio(danger, surface)).toBeGreaterThanOrEqual(3);

    // WHAT YOU TYPED: the text, at full AA rather than the 3:1 a
    // boundary needs.
    expect(ratio(text, fill)).toBeGreaterThanOrEqual(4.5);

    // AND THE FILL IS STILL A FILL. It has to differ from the card at
    // all — a field the same colour as its surface is not a well, it
    // is nothing.
    expect(ratio(fill, surface)).toBeGreaterThan(1);
  });

  it("draws lines a reader can see, on both grounds", () => {
    // «التباين هنا ضعيف جدًا، ممكن تحسّنه أفضل في كامل المنصة».
    //
    // THE PLATFORM HAS TWO GROUNDS and a line has to survive both: a
    // card is white, the page behind it is #F8FAFC, and the same rule
    // is drawn on each. Measuring only against white is how a hairline
    // ends up invisible exactly where the reader is looking.
    const luminance = (hex: string) => {
      const parts = hex.replace("#", "").match(/../g)!;
      const channels = parts
        .map((pair) => parseInt(pair, 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const ratio = (a: string, b: string) => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (light + 0.05) / (dark + 0.05);
    };
    const hex = (token: string) =>
      GLOBALS.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`))![1];

    const surface = hex("--color-surface");
    const page = hex("--color-background");
    const line = hex("--color-border");
    const boundary = hex("--color-border-control");
    const muted = hex("--color-text-muted");

    // THE DECORATIVE TIER. It cannot reach 3:1 and is not asked to —
    // a rule at 3:1 across a forty-row table is a grid drawn over the
    // data. What it must not be again is 1.23:1, which is a line only
    // the stylesheet knew about.
    for (const ground of [surface, page]) {
      expect(ratio(line, ground)).toBeGreaterThanOrEqual(1.7);
      // And still a hairline rather than a stroke.
      expect(ratio(line, ground)).toBeLessThan(2.5);
    }

    // THE TIER THAT CARRIES MEANING: the outline that is a region's
    // only boundary — an empty state, a dashed placeholder, a drop
    // zone. WCAG 1.4.11 asks 3:1 of it, on both grounds.
    for (const ground of [surface, page]) {
      expect(ratio(boundary, ground)).toBeGreaterThanOrEqual(3);
    }

    // AND SECONDARY TEXT IS NOT SECONDARY CONTRAST. The description
    // under an empty state's title is the sentence that explains it.
    for (const ground of [surface, page, hex("--color-field-fill")]) {
      expect(ratio(muted, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives a card an edge, and lets nothing inside it draw a second one", () => {
    // «لون البطاقة قريب جدًا، ما هو واضح إنها بطاقة إلا إذا دقّقت
    // النظر جدًا» — a white card on #F8FAFC is 1.05:1, so a shadow was
    // being asked to be the entire boundary and could not.
    const card = readFileSync(join(ROOT, "components", "ui", "card.tsx"), "utf8");
    const surface = card.match(/CARD_SURFACE = "([^"]+)"/)![1];

    // THE LINE SAYS WHERE THE EDGE IS, at the 3:1 a boundary that
    // carries meaning is owed.
    expect(surface).toContain("border border-line-control");
    // THE SHADOW SAYS IT IS ABOVE THE PAGE. Two questions, not one.
    expect(surface).toContain("shadow-card");

    // AND NOTHING INSIDE WEARS THE SAME LINE — «ما هو تسوي لي داخل
    // البطاقة إطار». An empty state carrying the card's own boundary
    // reads as the card's edge while the real edge stays invisible.
    const states = readFileSync(join(ROOT, "components", "ui", "states.tsx"), "utf8");
    expect(states).not.toContain("border-dashed border-line-control");
    expect(states).toContain("bg-field-fill");
  });

  it("keeps a card lifted less than the button standing on it", () => {
    // The card's shadow was deepened because white on #F8FAFC is
    // 1.05:1 and the shadow is the ONLY thing parting the two. The
    // deepening had one ceiling: a card that lifts higher than its own
    // button reads as the thing to press.
    const alphas = (token: string) =>
      [...GLOBALS.match(new RegExp(`${token}:[^;]+;`))![0].matchAll(/\/\s*(0\.\d+)\)/g)].map(
        (m) => Number(m[1])
      );
    const card = alphas("--elevation-card");
    const raised = alphas("--elevation-raised");
    expect(card).toHaveLength(raised.length);
    for (let i = 0; i < card.length; i += 1) expect(card[i]).toBeLessThan(raised[i]);

    // AND IT IS NO LONGER A SHADOW ONLY A STYLESHEET KNEW ABOUT.
    expect(Math.max(...card)).toBeGreaterThanOrEqual(0.12);
  });

  it("pairs no inner shadow with an outer one on the same surface", () => {
    // That pairing is neumorphism, which this deliberately is not.
    const elevations = GLOBALS.match(/--elevation-[a-z]+:[^;]+;/g) ?? [];
    for (const rule of elevations) {
      // A box-shadow is a comma-separated list of LAYERS, and the rule
      // is about mixing them: every layer inset, or none. One rule
      // carrying both is a surface somehow pressed and raised at once.
      const layers = rule.slice(rule.indexOf(":") + 1).split(/,(?![^(]*\))/);
      const inset = layers.filter((layer) => layer.includes("inset")).length;
      const consistent = inset === 0 || inset === layers.length;
      expect([rule.slice(0, 24), consistent]).toEqual([rule.slice(0, 24), true]);
    }

    // AND THE FOCUS HALO IS NOT AN ELEVATION, which is why it is named
    // `--ring-focus`. A focused field is a well WITH a halo; calling
    // that halo an elevation would have made the rule above false at
    // the moment it was written.
    expect(GLOBALS).toContain("--ring-focus:");
    expect(GLOBALS).not.toContain("--elevation-focus");
  });

  it("never reshapes what the focus ring rings", () => {
    // `:focus-visible { border-radius: ... }` is universal, so it lands
    // on the ELEMENT: an 8px control snapped to 6px and a 16px card
    // snapped to 6px the moment either was focused. An outline has
    // followed its element's own radius in every modern engine since
    // 2021, so there was nothing to gain and a shape to lose.
    const focusRule = GLOBALS.slice(GLOBALS.indexOf(":focus-visible {"));
    const body = focusRule.slice(0, focusRule.indexOf("}"));

    expect(body).toContain("outline:");
    expect(body).not.toContain("border-radius");
  });

  it("keeps the focus treatment ON, wherever it is written", () => {
    // The one rule with no exception in the system: focus is never
    // removed. `outline: none` and `outline: 0` are how it goes.
    const offenders: string[] = [];
    for (const file of [...SOURCE, join(ROOT, "app", "globals.css")]) {
      const code = read(file);
      for (const found of code.matchAll(/outline-none|outline:\s*(none|0)\b/g)) {
        offenders.push(`${name(file)} :: ${found[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// =====================================================================
// One height, one radius, one set of paddings
// =====================================================================
describe("the shared components own the measurements", () => {
  const BUTTON = read(join(ROOT, "components", "ui", "button.tsx"));
  const FIELD = read(join(ROOT, "components", "ui", "field.tsx"));
  const SELECT = read(join(ROOT, "components", "ui", "select.tsx"));
  const CARD = read(join(ROOT, "components", "ui", "card.tsx"));

  it("gives Button one size, whatever the caller asks for", () => {
    // Three heights — 32, 36 and 42 — depended on who wrote the screen.
    expect(BUTTON).toContain("min-h-control");
    expect(BUTTON).not.toMatch(/px-4 py-2/);
    expect(BUTTON).not.toMatch(/px-5 py-2\.5/);
  });

  it("raises a Button and sinks it on the press", () => {
    expect(BUTTON).toContain("shadow-raised");
    expect(BUTTON).toContain("active:shadow-pressed");
  });

  it("sinks a field and never raises one", () => {
    // Scoped to the FIELD skin itself. The same file also defines the
    // CHOOSER skin — a date input opens a calendar, so it lifts — and
    // reading the whole file would call that a contradiction when it
    // is the distinction the system is built on.
    const skin = FIELD.slice(
      FIELD.indexOf("export const FIELD_CLASSES"),
      FIELD.indexOf("export const CHOOSER_CLASSES")
    );

    expect(skin).toContain("shadow-inset");
    expect(skin).not.toMatch(/shadow-(raised|soft|card)/);

    const chooser = FIELD.slice(
      FIELD.indexOf("export const CHOOSER_CLASSES"),
      FIELD.indexOf("export const FIELD_ONE_LINE")
    );
    expect(chooser).toContain("shadow-soft");
    expect(chooser).not.toContain("shadow-raised");
  });

  it("raises a Select less than a Button", () => {
    expect(SELECT).toContain("shadow-soft");
    expect(SELECT).not.toContain("shadow-raised");
  });

  it("raises a Card less than a Button", () => {
    expect(CARD).toContain("shadow-card");
    expect(CARD).not.toContain("shadow-raised");
  });

  it("gives a Card 8 down, 12 across, 8 between — and never 16", () => {
    expect(CARD).toContain("px-card-x");
    expect(CARD).toContain("py-card-y");
    expect(CARD).toContain("mt-card-gap");
    expect(CARD).not.toMatch(/p[xy]-4/);
  });

  it("keeps the roomier vertical measure opt-in", () => {
    expect(CARD).toContain("card-y-sectioned");
    expect(CARD).toContain("sectioned");
  });

  it("gives every button the control height, however it was written", () => {
    // THE GAP THE OTHER RULES LEFT. A guard on bad classes cannot see a
    // button that never went near the system: a pagination arrow, a
    // copy control, a fold chevron — each a bare <button> with a
    // hand-drawn square, each a different height from the one beside
    // it. This asks the opposite question — does it carry the height at
    // all? — which is the question a new button will fail.
    // THE ONE EXEMPTION, and it is not a button in any sense the eye
    // recognises: a point on a plotted line and the invisible column
    // over a bar. Their size IS the data — a dot forced to 32px would
    // cover the curve it marks — and they are `<button>` only because
    // a thing you can press and tab to has to be one.
    const PLOTTED = "components/admin/dashboard-charts.tsx";
    // AND ONE MORE, for the opposite reason: the carousel's keyboard
    // path is `sr-only`. It paints nothing at all, so it has no height
    // to give and a 32px box would be 32px of nothing.
    const UNPAINTED = "components/banners/banner-carousel.tsx";

    const offenders: string[] = [];

    for (const file of SOURCE) {
      if (name(file) === PLOTTED || name(file) === UNPAINTED) continue;

      const code = read(file)
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");

      for (const opening of tags(code, "button")) {
        // A className built from a variable or `cn()` IS resolved
        // elsewhere and cannot be read here. NO className at all is a
        // different thing entirely — it is a button that went through
        // nothing — and skipping it was the hole that let the category
        // strip render at 20px.
        const literal = (opening.match(/className="([^"]*)"/) ?? [])[1];
        const computed = /className=\{/.test(opening);
        if (literal === undefined && computed) continue;
        const cls = literal ?? "";
        if (/min-h-control|min-h-nav/.test(cls)) continue;
        offenders.push(`${name(file)} :: ${cls.slice(0, 44) || "بلا className"}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

// =====================================================================
// Nothing goes round it
// =====================================================================
describe("no page dresses its own control", () => {
  it("leaves no 44px override anywhere", () => {
    // The height is 32, decided centrally and tested by touch. A rail's
    // destination is not a control and uses `min-h-nav` instead.
    const offenders = SOURCE.filter((file) => read(file).includes("min-h-11")).map(name);
    expect(offenders).toEqual([]);
  });

  it("dresses the OPEN list too, and does it from one place", () => {
    // The open list of a native <select> is drawn by the operating
    // system: square corners, a Windows-blue row, no elevation, and no
    // stylesheet could reach it. `appearance: base-select` makes it an
    // ordinary part of the page instead — the element stays a real
    // <select>, so keyboard, type-ahead, form semantics and the
    // phone's picker are all untouched.
    //
    // THE PANEL MUST MATCH THE OTHER CHOOSER. A reader should not be
    // able to tell which of the two kinds they opened.
    const SELECT = read(join(ROOT, "components", "ui", "select.tsx"));
    const SEARCHABLE = read(join(ROOT, "components", "ui", "searchable-select.tsx"));

    // The hook is on the component, so every <Select> gets it and no
    // page has to know it exists.
    expect(SELECT).toContain("chooser-native");

    // The panel and the searchable list agree on shape and lift.
    // `lastIndexOf`: the FIRST `::picker(select)` is the opt-in that
    // turns the OS panel into a page element. The one being checked
    // here is what dresses it afterwards.
    const picker = GLOBALS.slice(GLOBALS.lastIndexOf("::picker(select) {"));
    const panel = picker.slice(0, picker.indexOf("}"));
    expect(panel).toContain("var(--radius-card)");
    expect(panel).toContain("var(--elevation-overlay)");
    expect(SEARCHABLE).toContain("rounded-card");
    expect(SEARCHABLE).toContain("shadow-overlay");

    // An option is measured by the control tokens, not by hand.
    expect(GLOBALS).toContain("padding-inline: var(--control-pad-x)");
    expect(GLOBALS).toContain("font-size: var(--control-font-size)");

    // AND IT IS AN ENHANCEMENT, NEVER A DEPENDENCY. A browser without
    // the picker keeps the native panel and everything still works, so
    // the whole block is behind a capability test — and one that asks
    // for the PICKER rather than for a property value, because
    // autoprefixer turns the property form into an `or` across three
    // prefixes that a non-supporting engine could match.
    expect(GLOBALS).toContain("@supports selector(select::picker(select))");
  });

  it("reads the hover value rather than repeating it", () => {
    // `hover:opacity-90` was written 79 times and IS the token's value
    // today. That is the danger, not the defence: change the token and
    // 79 places quietly keep the old number, and the platform hovers
    // two ways.
    //
    // TWO EXCEPTIONS, both deliberate and both asserted elsewhere: the
    // bare language glyph dims further because it has no box to dim,
    // and one image returns to full opacity on hover.
    const ALLOWED = /hover:opacity-(70|100|\[var\(--state-hover-opacity\)\])/;

    const offenders: string[] = [];
    for (const file of SOURCE) {
      for (const found of read(file).matchAll(/hover:opacity-[^\s"'`]+/g)) {
        if (ALLOWED.test(found[0])) continue;
        offenders.push(`${name(file)} :: ${found[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("gives a NAVIGATION destination the height reserved for one", () => {
    // The category strip and the footer measured 20px live — the line
    // box and nothing else, below both the 32px control and the 44px
    // this system already reserves for a destination. A guard on bad
    // classes could not see it: there was no class to be wrong.
    for (const file of ["components/shell/footer.tsx"]) {
      const code = read(join(ROOT, ...file.split("/")));
      const links = tags(code, "Link").concat(tags(code, "a"));
      const dressed = links.filter((tag) => /min-h-nav/.test(tag));
      expect([file, dressed.length > 0]).toEqual([file, true]);
    }

    // THE CATEGORY NAV IS THE EXCEPTION, AND IT IS ARGUED RATHER THAN
    // WAIVED — «حاول تقلّل الحشو أكبر قدر ممكن بين الأسماء في الإطار
    // المنبثق، لأني أشوف مسافة كبيرة».
    //
    // Its destinations stand at the platform's CONTROL height, 32px,
    // and they do so consistently: the strip's own category links have
    // been `min-h-control` since they moved into the tab strip, so a
    // panel opening from a 32px row at 44px per line was taller per
    // entry than the bar that opened it.
    //
    // THE COST IS REAL AND NOT HIDDEN: 32 is below the 44 this system
    // reserves for a destination, so these are a smaller target than
    // the console's own panel offers. That is the owner's decision,
    // recorded here rather than left for someone to discover.
    //
    // WHAT IS STILL GUARDED is that they are TARGETS and not bare text:
    // the 20px line box this test was written against — no height at
    // all — must never come back.
    const categories = read(join(ROOT, "components", "shell", "category-nav.tsx"));
    const rows = tags(categories, "Link");
    expect(rows.length > 0).toBe(true);
    for (const row of rows) {
      expect([row.slice(0, 40), /min-h-(nav|control)|PANEL_ROW|{entry}|entry +/.test(row)]).toEqual([
        row.slice(0, 40),
        true,
      ]);
    }
  });

  it("writes no button metrics by hand", () => {
    // `px-3 py-1.5` IS the button — written anywhere else it is a
    // second button that will not follow the first.
    const offenders = SOURCE.filter(
      (file) =>
        !file.endsWith("button.tsx") && /px-3 py-1\.5/.test(read(file))
    ).map(name);
    expect(offenders).toEqual([]);
  });

  it("uses no raw TEXT control outside the components that define them", () => {
    // A `<input type="text">` typed into a page gets none of this: no
    // height, no inset, no error state, no disabled treatment.
    //
    // A checkbox, a radio, a file picker and a colour swatch are NOT
    // fields — none of them holds text, none takes the 36px height,
    // and dressing them as one would be worse than leaving them.
    const TEXTUAL = /<input\b(?![^>]*type="(checkbox|radio|file|color|hidden|range)")/;

    const offenders = SOURCE.filter((file) => {
      if (OWNS_THE_PRIMITIVE.some((owner) => name(file) === owner)) return false;
      const code = read(file)
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      return (
        TEXTUAL.test(code) || /<textarea\b/.test(code) || /<select\b/.test(code)
      );
    }).map(name);

    expect(offenders).toEqual([]);
  });

  it("puts no outline back on a field", () => {
    // OPTION (ج) HELD SHUT. The outline came off the whole platform on
    // purpose; one component adding it back is how a screen starts
    // looking like a different product.
    const FIELD = read(join(ROOT, "components", "ui", "field.tsx"));
    const SELECT = read(join(ROOT, "components", "ui", "select.tsx"));

    for (const source of [FIELD, SELECT]) {
      expect(source).toContain("border-transparent");
      expect(source).not.toMatch(/border-line-strong|"border border-line"/);
    }

    // And no page dresses one itself.
    const offenders = SOURCE.filter((file) => {
      const code = read(file);
      return /<(Input|Select|Textarea)[^>]*className="[^"]*border-/.test(code);
    }).map(name);

    expect(offenders).toEqual([]);
  });

  it("writes no card padding by hand", () => {
    // A surface with the card border, the card background and sixteen
    // pixels on every side IS a card — one that inherits none of the
    // decisions the real one carries.
    const offenders = SOURCE.filter((file) =>
      /bg-surface p-4/.test(read(file))
    ).map(name);

    expect(offenders).toEqual([]);
  });

  it("chooses a shadow by what the surface is, not by how dark it looks", () => {
    // `shadow-sm/md/lg` say nothing about whether a thing is pressed,
    // written into, or merely a surface.
    const offenders = SOURCE.filter((file) =>
      /shadow-(sm|md|lg)\b/.test(read(file))
    ).map(name);

    expect(offenders).toEqual([]);
  });
});
