import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NO EXPLANATION UNDER A TITLE.
 *
 * Every page and every section carried a sentence under its heading
 * restating what the heading said. Twenty-seven of them across the
 * platform, in front of the work each screen exists to do.
 *
 * WHAT IS NOT COVERED BY THIS. An error message, a refusal and an
 * instruction for a step the reader must carry out are none of them a
 * description of a title — they are the only thing telling somebody
 * what happened or what to do, and the four files listed below keep
 * theirs for exactly that reason.
 *
 * THE RULE IS ADJACENCY, not wording: a muted paragraph whose whole
 * content is one expression, sitting within three lines under a
 * heading. That is the shape a subtitle has, and it is the shape this
 * refuses.
 */
const ROOT = join(__dirname, "..");

/** Where a paragraph under a heading is doing real work. */
const ALLOWED = new Map([
  [join("admin", "error.tsx"), "the paragraph IS the error message"],
  [
    join("dispute", "page.tsx"),
    "three panels explaining why a dispute cannot be opened",
  ],
  ["admin-login-flow.tsx", "instructions for a step the reader carries out"],
  ["trader-terms-notice.tsx", "a legal notice shown before a purchase"],
  [
    join("admin", "branding", "page.tsx"),
    "says that saving a draft does NOT publish — a consequence, not a description",
  ],
  [
    "product-media-manager.tsx",
    "how to reorder the images, and that each move saves at once",
  ],
]);

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (entry === "node_modules" || entry === ".next") return [];
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

const HEADING = /<h[12][\s>]|<CardHeader|<PageHeader/;
const MUTED_PARAGRAPH =
  /^\s*<p className="[^"]*text-content-muted[^"]*">\{[^}]*\}<\/p>\s*$/;
const BLURB =
  /(description|Description|subtitle|Subtitle|blurb|Blurb|intro|Intro|tagline|Hint|hint)/;

describe("a title explains itself", () => {
  it("has no description under a page or section heading", () => {
    const offenders: string[] = [];

    for (const file of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))]) {
      if ([...ALLOWED.keys()].some((tail) => file.endsWith(tail))) continue;

      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!MUTED_PARAGRAPH.test(line) || !BLURB.test(line)) return;
        const above = lines.slice(Math.max(0, index - 3), index).join("\n");
        if (!HEADING.test(above)) return;
        offenders.push(`${relative(ROOT, file)}:${index + 1}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the six that are not subtitles", () => {
    // Named here so removing one is a decision somebody takes on
    // purpose, not a sweep that went one file too far.
    for (const [tail, why] of ALLOWED) {
      expect([tail, typeof why]).toEqual([tail, "string"]);
    }
    expect(ALLOWED.size).toBe(6);
  });
});
