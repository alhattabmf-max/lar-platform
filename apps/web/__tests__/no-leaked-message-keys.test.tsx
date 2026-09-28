import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import arMessages from "../messages/ar-SA.json";
import enMessages from "../messages/en-SA.json";

/**
 * NO MESSAGE PATH EVER REACHES A READER.
 *
 * next-intl does not throw when a message needs a value it was not
 * given. It reports through `onError` and returns the message PATH, so
 * the screen renders `admin.toolbar.filtersWithCount` where a label
 * should be — which is what shipped, and what nothing caught.
 *
 * Two halves, because the failure has two halves:
 *
 *   1. A message carrying a placeholder must not be resolved anywhere
 *      that cannot supply it. `t("x")` with no second argument on a
 *      message containing `{...}` is the bug, statically visible.
 *
 *   2. Nothing rendered may look like a message path. Checked against
 *      the real catalogue, in both languages.
 */

const WEB = process.cwd();

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, match);
    return match(entry.name) ? [full] : [];
  });
}

const SOURCES = [
  ...walk(join(WEB, "app"), (name) => name.endsWith(".tsx")),
  ...walk(join(WEB, "components"), (name) => name.endsWith(".tsx")),
];

/** Every message that interpolates something, as a dotted path. */
function placeholderMessages(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return /\{[a-zA-Z]/.test(node) ? [prefix] : [];
  if (!node || typeof node !== "object") return [];
  return Object.entries(node as Record<string, unknown>).flatMap(
    ([key, value]) =>
      placeholderMessages(value, prefix ? `${prefix}.${key}` : key),
  );
}

const NEEDS_VALUES = new Set(placeholderMessages(arMessages));

describe("the catalogue and the code agree about placeholders", () => {
  it("finds messages that interpolate", () => {
    // A guard against this passing because the walk found nothing.
    expect(NEEDS_VALUES.size).toBeGreaterThan(10);
  });

  it("says the same thing in both languages", () => {
    // A placeholder present in one language and absent in the other is
    // a message that renders its path in exactly one of them.
    expect([...placeholderMessages(enMessages)].sort()).toEqual(
      [...NEEDS_VALUES].sort(),
    );
  });

  /**
   * Every `t("key")` in the app, with the namespace it was taken from.
   *
   * Read statically rather than by rendering: the failure is a call
   * shape, and a render test only reaches the screens it happens to
   * mount.
   */
  const calls: { file: string; path: string; hasValues: boolean }[] = [];

  for (const file of SOURCES) {
    const source = readFileSync(file, "utf8");

    // `const t = await getTranslations({ ..., namespace: "admin.x" })`
    // and `useTranslations("admin.x")`, keyed by the local name.
    //
    // A NAME BOUND TWICE IN ONE FILE IS SKIPPED. A page often has
    // several functions, each with its own `const t = ...` on a
    // different namespace — one file here binds `t` to `trader.orders`
    // four times and to `trader.documents` once. Reading the file
    // rather than its scopes cannot tell which call belongs to which,
    // and guessing would report keys that resolve perfectly at runtime.
    // Where the binding is ambiguous this says nothing rather than
    // something false.
    const bindings = new Map<string, Set<string>>();
    const remember = (local: string, namespace: string) => {
      const seen = bindings.get(local) ?? new Set<string>();
      seen.add(namespace);
      bindings.set(local, seen);
    };

    for (const m of source.matchAll(
      /const\s+(\w+)\s*=\s*await\s+getTranslations\(\{[^}]*namespace:\s*"([^"]+)"/g,
    )) {
      remember(m[1], m[2]);
    }
    for (const m of source.matchAll(
      /const\s+(\w+)\s*=\s*useTranslations\("([^"]+)"\)/g,
    )) {
      remember(m[1], m[2]);
    }
    for (const m of source.matchAll(
      /const\s+(\w+)\s*=\s*useTranslations\(\)/g,
    )) {
      remember(m[1], "");
    }

    const namespaces = new Map<string, string>();
    for (const [local, seen] of bindings) {
      if (seen.size === 1) namespaces.set(local, [...seen][0]);
    }

    for (const [local, namespace] of namespaces) {
      const pattern = new RegExp(`\\b${local}\\(\\s*"([^"]+)"\\s*(,)?`, "g");
      for (const m of source.matchAll(pattern)) {
        calls.push({
          file: file.replace(WEB, ""),
          path: namespace ? `${namespace}.${m[1]}` : m[1],
          hasValues: Boolean(m[2]),
        });
      }
    }
  }

  it("finds the translation calls to check", () => {
    expect(calls.length).toBeGreaterThan(200);
  });

  it("passes values to every message that needs them", () => {
    // THE REGRESSION: `toolbar("filtersWithCount")` resolved a message
    // reading «تصفية ({count})» with nothing to put in it, and the
    // button rendered `admin.toolbar.filtersWithCount` on screen.
    const unfilled = calls
      .filter((call) => NEEDS_VALUES.has(call.path) && !call.hasValues)
      .map((call) => `${call.file}: ${call.path}`);

    expect(unfilled).toEqual([]);
  });

  it("resolves every key it asks for", () => {
    // A path with no message renders as the path too.
    const lookup = (path: string) =>
      path
        .split(".")
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          arMessages,
        );

    const missing = calls
      // A key built at runtime — `t(\`x.${value}\`)` — cannot be looked
      // up here; those carry their own vocabulary tests.
      .filter((call) => !call.path.includes("$") && !call.path.includes("{"))
      .filter((call) => typeof lookup(call.path) !== "string")
      .map((call) => `${call.file}: ${call.path}`);

    expect(missing).toEqual([]);
  });
});
