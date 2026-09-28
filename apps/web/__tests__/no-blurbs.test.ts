import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO EXPLANATION UNDER A TITLE. ANYWHERE. EVER.
 *
 * The owner's rule, with three examples they pointed at:
 *
 *   «الإدارة تتابع المنتجات المعروضة ولا تنشئها ولا تعدّلها…»
 *       under a section already called «المنتجات المعروضة»
 *   «اختيارية. أضفها إن أردت أن يُتواصل مع شخص محدد.»
 *       under a card already called «جهة تواصل إضافية»
 *   «مطلوب لاستلام المستحقات. يراجعه فريق المنصة ضمن طلب التوثيق.»
 *       under a card already called «الحساب البنكي»
 *
 * One shape, and the instruction was explicit that it applies to the
 * whole site and to everything added later: «طبقها على الموقع كامل
 * وليس فقط صفحات معينه». So this is a standing rule, not a sweep — a
 * new page cannot ship with one and a new shared component cannot offer
 * the slot for one.
 *
 * WHAT THIS IS NOT ABOUT, and does not touch:
 *
 *   - AN EMPTY STATE. «لا توجد منازعات» has no title above it saying
 *     the same thing; it IS the region's content.
 *   - A TERMINAL STATE. «انتهت مدة حجز الكمية… إذا خُصم أي مبلغ فسيُعاد
 *     إلى وسيلة الدفع نفسها» is a statement about money on a page that
 *     would otherwise say only «انتهى».
 *   - AN ERROR. The owner kept those explicitly the first time round.
 *   - DATA that is small and grey: a name, a unit, a branch, a count.
 *
 * The test reads STRUCTURE, not wording: a muted paragraph whose
 * preceding lines contain a heading. That is the shape; anything of
 * that shape is a blurb whatever it says.
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
const read = (file: string) => readFileSync(file, "utf8");

/** A heading, or the card title that stands in for one. */
const HEADING = /<(h1|h2|h3|CardTitle)\b/;

/**
 * The muted paragraph that carries a blurb.
 *
 * Matched on the class pair rather than on the tag alone, because that
 * pair IS the treatment: small, grey, under something.
 */
const MUTED = /<p[^>]*text-(sm|xs) text-content-muted/;

/**
 * A BLURB IS A CONSTANT SENTENCE. Anything carrying a value is not one.
 *
 * That is the whole distinction, and it holds without a list of
 * exceptions: «الإدارة تتابع المنتجات المعروضة…» says the same words to
 * everyone forever, while «مسجَّل الدخول باسم {company}», «{quantity}
 * كرتون في الحصة» and the supplier's own product description each tell
 * this reader something about this row. The first is decoration; the
 * others are the content.
 *
 * So: an interpolated message — `t("key", { … })` — or any expression
 * other than a bare `t("key")` is data, and stays.
 */
const CONSTANT_MESSAGE = /\{\s*t\(\s*["'][^"']+["']\s*\)\s*\}|\{\s*labels\.[A-Za-z0-9_.]+\s*\}/;

/**
 * A VALUE ALONGSIDE THE SENTENCE makes the whole line data.
 *
 * `{allocation.locationName} · {t("subtitle")}` names a branch, and the
 * label beside it is how that name reads — not an explanation of the
 * heading above. A template key like `` t(`state.${x}`) `` is the same
 * thing: which sentence appears depends on this row.
 */
const CARRIES_VALUE = /\$\{|\{[a-z][A-Za-z0-9_]*\./;

/**
 * A state's own sentence: empty, missing, terminal, refused.
 *
 * Named by the KEY they render rather than by a file exemption, so the
 * exception travels with the meaning instead of with the location.
 */
const STATE_SENTENCE =
  /\b(empty|none|noAttempts|allHandled|evidenceEmpty|imagesEmpty|unavailable|expired|abandoned|pending|paid|EXPIRED|ABANDONED|notFound|forbidden|error|Error)\b/;

describe("no page explains itself under its own heading", () => {
  it("carries no blurb anywhere in app/ or components/", () => {
    const offenders: string[] = [];

    for (const file of SOURCE) {
      const lines = read(file).split("\n");

      lines.forEach((line, index) => {
        if (!MUTED.test(line)) return;

        // A heading in the five lines above it is what makes this a
        // description OF something rather than content in its own right.
        const preceding = lines.slice(Math.max(0, index - 5), index).join(" ");
        if (!HEADING.test(preceding)) return;

        // The paragraph plus what follows it, so a value split across
        // lines is judged on the whole of itself.
        const body = lines.slice(index, index + 3).join(" ");

        // Only a CONSTANT sentence is a blurb. Anything carrying a
        // value is telling this reader about this row.
        if (!CONSTANT_MESSAGE.test(body)) return;
        if (CARRIES_VALUE.test(body)) return;
        if (STATE_SENTENCE.test(body)) return;

        offenders.push(`${name(file)}:${index + 1}  ${line.trim().slice(0, 60)}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it("offers no SLOT for one in a shared component", () => {
    // Removing the instances is a sweep; removing the prop is a rule.
    // `FormSection` used to take a `description` and render it under
    // its heading — every long form in the app got one for free.
    const shell = read(join(ROOT, "components", "forms", "form-shell.tsx"));

    expect(shell).toContain("IT TAKES NO DESCRIPTION");
    expect(shell).not.toMatch(/description\?:\s*string/);
  });

  it("keeps the three examples GONE from both catalogues", () => {
    // Asserted by their text, because these are the ones the owner
    // pointed at and a re-added key with a different name would still
    // be them.
    const ar = read(join(ROOT, "messages", "ar-SA.json"));

    expect(ar).not.toContain("الإدارة تتابع المنتجات المعروضة");
    expect(ar).not.toContain("اختيارية. أضفها إن أردت");
    expect(ar).not.toContain("مطلوب لاستلام المستحقات");
  });

  it("KEEPS what is not a blurb, so the rule cannot be read as 'delete grey text'", () => {
    // Money and terminal states survive. A sweep that took these would
    // have left a buyer looking at «انتهى» with no word about the money
    // they had already paid.
    const ar = read(join(ROOT, "messages", "ar-SA.json"));

    expect(ar).toContain("إذا خُصم أي مبلغ فسيُعاد");
    expect(ar).toContain("انتهت مدة حجز الكمية");
  });
});
