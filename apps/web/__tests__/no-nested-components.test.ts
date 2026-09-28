import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO COMPONENT DECLARED INSIDE ANOTHER COMPONENT.
 *
 * This bug has now cost two screens. In the taxonomy manager a
 * `DraftForm` declared inside its parent made «أدوات» come out as «أ»;
 * in the add-product form a `Group` did the same to every field on it —
 * type one letter, lose focus, click the field again for the second.
 *
 * WHY IT HAPPENS, and why nothing else catches it. To React, a
 * component's TYPE is the function's identity. A function declared
 * inside a render body is rebuilt on every render, so its identity
 * changes every time — and React, correctly, treats a changed type as a
 * different component: it unmounts the old subtree and mounts a new
 * one. The DOM node holding the caret is destroyed and replaced with a
 * fresh one, so focus is gone and the value with it.
 *
 * `tsc` sees nothing wrong. `eslint` sees nothing wrong. Every unit
 * test that renders once and asserts passes. It only appears when
 * somebody types a second character, which is exactly the thing a test
 * rarely does and a person always does.
 *
 * WHAT IS NOT THE BUG: a function declared in a component and then
 * CALLED. `{textField("nameAr")}` returns a `<div>`, whose type is the
 * string "div" — stable however many times the helper is rebuilt. The
 * rule is not "no functions in components"; it is "nothing declared in
 * a component may be used as a TAG".
 */
const ROOT = join(__dirname, "..");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if ([".next", "node_modules", "__tests__"].includes(entry)) return [];
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

const SOURCE = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];
const name = (file: string) => relative(ROOT, file).split("\\").join("/");

/** Comments stripped: prose about the rule must not trip the rule. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * A declaration INDENTED — that is, nested inside something — whose
 * name starts with a capital. Capitalisation is how JSX itself decides
 * whether `<Group>` is a component or an HTML tag, so it is the right
 * signal here too.
 */
const NESTED_DECLARATION =
  /^[ \t]+(?:function\s+([A-Z]\w*)\s*\(|const\s+([A-Z]\w*)\s*[:=][^=]*=>)/gm;

describe("nothing is declared inside a component and then rendered as one", () => {
  it("finds no nested component used as a tag, anywhere", () => {
    const offenders: string[] = [];

    for (const file of SOURCE) {
      const source = code(readFileSync(file, "utf8"));

      for (const match of source.matchAll(NESTED_DECLARATION)) {
        const declared = match[1] ?? match[2];
        if (!declared) continue;

        // Declared nested AND used as a tag in the same file is the
        // bug. Declared nested and only CALLED is fine, and common.
        const usedAsTag = new RegExp(`<${declared}[\\s/>]`).test(source);
        if (!usedAsTag) continue;

        const line = source.slice(0, match.index).split("\n").length;
        offenders.push(`${name(file)}:${line}  <${declared}>`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the two that already cost a screen at module scope", () => {
    // Named, because these are the ones that actually shipped broken.
    const taxonomy = readFileSync(
      join(ROOT, "components", "admin", "taxonomy-manager.tsx"),
      "utf8",
    );
    const listing = readFileSync(
      join(ROOT, "components", "supplier", "listing-form.tsx"),
      "utf8",
    );
    const parts = readFileSync(
      join(ROOT, "components", "forms", "listing-parts.tsx"),
      "utf8",
    );

    // At the left margin: nested declarations are indented.
    //
    // `NameForm` was the one that shipped broken here — a controlled
    // input remounting on every keystroke, so «أدوات» arrived as «أ».
    // It went when the tree became columns; `Column` holds the same
    // inputs and is held to the same rule.
    expect(taxonomy).toMatch(/^function Column\b/m);
    expect(taxonomy).not.toMatch(/^\s+function Column\b/m);
    // `Group` was the one that shipped broken here — it went when the
    // approved reference replaced the banded card with three. What
    // took its place is held to the same rule.
    expect(listing).not.toMatch(/^\s+function (Group|SectionTitle|ParcelMark)\b/m);

    // AND THEY NOW LIVE IN A MODULE OF THEIR OWN, because the
    // console's product page draws the same cards. Still at the left
    // margin, and still not nested inside anything: the reason is the
    // reason, not the file — a component declared inside another is a
    // new function identity every render, and React rebuilds every
    // field under it on every keystroke.
    expect(parts).not.toMatch(/^\s+function (SectionTitle|ParcelMark|FieldRow)\b/m);
    expect(parts).toMatch(/^export function SectionTitle\b/m);
    expect(parts).toMatch(/^export function ParcelMark\b/m);
    expect(parts).toMatch(/^export function FieldRow\b/m);
  });
});
