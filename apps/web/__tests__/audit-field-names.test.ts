import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_VISIBLE_FIELD_NAMES } from "@platform/types";

/**
 * The audit table's «ما تغيّر» column.
 *
 * The server decides what may be shown; this side decides what it is
 * CALLED. The two lists have to match exactly, in both directions:
 *
 *   · an approved field with no name renders as its identifier, which
 *     is the state the action column was in before its codes were
 *     named;
 *   · a name for a field that is not approved is a key nothing will
 *     ever read, and it reads as though that field is on the screen
 *     when it is not.
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const AR = JSON.parse(read("messages/ar-SA.json"));
const EN = JSON.parse(read("messages/en-SA.json"));

describe("every allow-listed audit field has a name, in both languages", () => {
  it.each(["ar-SA", "en-SA"])("%s names exactly the approved fields", (locale) => {
    const messages = locale === "ar-SA" ? AR : EN;
    expect(Object.keys(messages.admin.auditFields).sort()).toEqual(
      [...AUDIT_VISIBLE_FIELD_NAMES].sort(),
    );
  });

  it.each(["ar-SA", "en-SA"])("%s leaves no name empty", (locale) => {
    const messages = locale === "ar-SA" ? AR : EN;
    for (const [field, name] of Object.entries<string>(
      messages.admin.auditFields,
    )) {
      expect([field, name.trim().length > 0]).toEqual([field, true]);
    }
  });
});

describe("the page cannot widen what the server allowed", () => {
  // Comments are stripped first: the page's own note EXPLAINS that
  // `beforeData` and `afterData` are not served, and a comment saying
  // why a thing is absent must not trip the guard against it.
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const PAGE = strip(read("app/[locale]/admin/audit/page.tsx"));

  it("reads only `before` and `after`, never a raw payload", () => {
    expect(PAGE).not.toContain("beforeData");
    expect(PAGE).not.toContain("afterData");
  });

  it("renders no markup from a value", () => {
    // Every value is a text node. A stored-content surface that renders
    // markup is a stored XSS waiting for one careless paste, and this
    // one shows values copied out of database rows.
    expect(PAGE).not.toContain("dangerouslySetInnerHTML");
  });
});
