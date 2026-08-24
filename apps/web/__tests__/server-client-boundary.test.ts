import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No Server Component may hand a FUNCTION to a Client Component.
 *
 * Why this exists
 * ---------------
 * `/ar-SA/admin/banners` rendered as
 * "Application error: a server-side exception has occurred"
 * (digest `1046837119`). The page is a Server Component and built its
 * labels like this:
 *
 *     moveUp: (title: string) => t("moveUp", { title }),
 *
 * React has to serialize every prop crossing into a Client Component,
 * and a function cannot be serialized:
 *
 *     Error: Functions cannot be passed directly to Client Components
 *     unless you explicitly expose it by marking it with "use server".
 *
 * The whole route 500s — not the one label. Three admin pages carried
 * the same mistake (banners, branding, content: seven props between
 * them), so this is a pattern to forbid, not three bugs to swat.
 *
 * The fix in every case: the receiving component is already a Client
 * Component holding a `useTranslations()` translator, so it resolves the
 * parameterised message itself and the prop disappears.
 *
 * What this checks
 * ----------------
 * Every `page.tsx` under `app/` — those are Server Components unless
 * they declare "use client" — for an object property whose value is an
 * arrow function. That is exactly the shape that broke, and it is
 * cheap and unambiguous to detect in source.
 *
 * A genuinely server-side helper taking a callback is NOT this: it is a
 * function ARGUMENT, not an object property in a prop literal. The
 * pattern below only matches `name: (args) => …` inside an object,
 * which is how a label bag is written.
 */

const APP_DIR = join(__dirname, "..", "app");

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === "page.tsx" || entry.name === "layout.tsx" ? [full] : [];
  });
}

/**
 * Blanks comments while PRESERVING every newline, so a reported line
 * number still points at the real line in the file. Replacing them with
 * nothing would shift every offset after the first comment and send a
 * developer to the wrong place.
 */
function withoutComments(source: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/.*$/gm, (_m, lead: string) => lead);
}

/**
 * `someLabel: (arg) => <expression>` written as an object property.
 *
 * The trailing `(?=...)` is what separates a function VALUE from a
 * function TYPE. `labelFor: (code: string) => string` is a parameter's
 * type annotation — perfectly fine on the server — and its arrow is
 * followed by a bare type name. A real label function's arrow is
 * followed by a CALL, a template literal, or an object/paren, possibly
 * after a line break. Matching on that keeps type positions out without
 * needing a TypeScript parser.
 */
const FUNCTION_VALUED_PROP =
  /^[ \t]*(\w+):\s*(?:async\s*)?\([^)]*\)\s*=>\s*(?=[\s\S]{0,4}?(?:\w+\s*\(|[`'"{[]))/gm;

const WEB_ROOT = join(__dirname, "..");

/** `import { A, B } from "@/components/x"` -> { A: <path>, B: <path> }. */
function importedComponents(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /import\s+(?:(\w+)|\{([^}]*)\})\s+from\s+["'](@\/[^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const target = join(WEB_ROOT, match[3].replace(/^@\//, ""));
    const names = match[1]
      ? [match[1]]
      : match[2].split(",").map((n) => n.replace(/\s+as\s+\w+/, "").trim());
    for (const name of names) {
      if (/^[A-Z]/.test(name)) map.set(name, target);
    }
  }
  return map;
}

function isClientComponent(pathWithoutExt: string): boolean {
  for (const ext of [".tsx", ".ts"]) {
    try {
      return /^\s*["']use client["']/m.test(readFileSync(pathWithoutExt + ext, "utf8"));
    } catch {
      // try the next extension
    }
  }
  // Unresolvable: treat as a client component so an unknown target is
  // reported rather than silently skipped.
  return true;
}

/** The nearest `<ComponentName` opening tag before `index`. */
function enclosingComponent(source: string, index: number): string | null {
  const before = source.slice(0, index);
  const matches = [...before.matchAll(/<([A-Z]\w*)/g)];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

interface Offence {
  file: string;
  line: number;
  prop: string;
  component: string;
  text: string;
}

function findOffences(): Offence[] {
  const offences: Offence[] = [];

  for (const file of pageFiles(APP_DIR)) {
    const raw = readFileSync(file, "utf8");
    // A page that opts into the client can pass functions freely.
    if (/^\s*["']use client["']/m.test(raw)) continue;

    const source = withoutComments(raw);
    const lines = source.split("\n");
    const imports = importedComponents(source);

    let match: RegExpExecArray | null;
    FUNCTION_VALUED_PROP.lastIndex = 0;
    while ((match = FUNCTION_VALUED_PROP.exec(source)) !== null) {
      const component = enclosingComponent(source, match.index);
      // A function handed to another SERVER component never crosses the
      // boundary and never has to be serialized — that is ordinary code,
      // not a defect. Only a Client Component receiver is a problem.
      if (!component) continue;
      const target = imports.get(component);
      if (!target || !isClientComponent(target)) continue;

      const line = source.slice(0, match.index).split("\n").length;
      offences.push({
        file: file.replace(APP_DIR, "app"),
        line,
        prop: match[1],
        component,
        text: (lines[line - 1] ?? "").trim(),
      });
    }
  }
  return offences;
}

describe("server/client boundary", () => {
  it("scans a meaningful number of pages — otherwise this test proves nothing", () => {
    expect(pageFiles(APP_DIR).length).toBeGreaterThan(30);
  });

  it("no Server Component page passes a function-valued prop", () => {
    const offences = findOffences();

    // Named so a failure says WHICH prop on WHICH line, rather than just
    // "expected 1 to be 0".
    expect(
      offences.map((o) => `${o.file}:${o.line}  <${o.component}> ${o.prop}  ->  ${o.text}`)
    ).toEqual([]);
  });

  it("the detector actually matches the shape that broke production", () => {
    // Guards against the regex silently ceasing to match, which would
    // make the assertion above vacuously green forever.
    const samples = [
      `    moveUp: (title: string) => t("moveUp", { title }),`,
      `    stateLabel: (state: string) => vocab(\`bannerState.\${state}\`),`,
      `          fieldLabel: (field: SiteContentField) => t(\`fields.\${field}\`),`,
      // The body may sit on the following line — this is exactly how
      // branding wrote it, and the detector must still see it.
      `                  issueContrast: (key, ratio, required) =>\n` +
        `                    t("issueContrast", { key, ratio, required }),`,
    ];
    for (const sample of samples) {
      FUNCTION_VALUED_PROP.lastIndex = 0;
      expect(FUNCTION_VALUED_PROP.test(sample)).toBe(true);
    }
  });

  it("does not flag ordinary serializable props, or a function TYPE", () => {
    const safe = [
      `    saveOrder: t("saveOrder"),`,
      `    placement: placement,`,
      `    banners: result.data,`,
      `    count: 3,`,
      `    onDone: undefined,`,
      // A parameter's type annotation on a server-only helper. The
      // arrow is followed by a bare type, not by a call.
      `  labelFor: (code: string) => string`,
      `  render: (value: number) => ReactNode;`,
    ];
    for (const sample of safe) {
      FUNCTION_VALUED_PROP.lastIndex = 0;
      expect(FUNCTION_VALUED_PROP.test(sample)).toBe(false);
    }
  });
});
