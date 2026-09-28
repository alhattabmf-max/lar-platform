import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB_ROOT = join(__dirname, "..");
const GLOBALS_CSS = join(WEB_ROOT, "app", "globals.css");

/** The twelve approved colours (docs/PHASE_8_IMPLEMENTATION_PLAN.md §14.1). */
const APPROVED_PALETTE: Record<string, string> = {
  "--color-primary": "#0b1f33",
  "--color-secondary": "#0f766e",
  "--color-accent": "#f59e0b",
  "--color-accent-interactive": "#b45309",
  "--color-background": "#f8fafc",
  "--color-surface": "#ffffff",
  "--color-text": "#0f172a",
  "--color-text-muted": "#475569",
  "--color-border": "#b6c2d1",
  "--color-success": "#15803d",
  "--color-warning": "#d97706",
  "--color-danger": "#dc2626",
};

/** Derived tokens required by the three measured failures (§14.4/§14.5). */
const DERIVED_TOKENS: Record<string, string> = {
  "--color-border-strong": "#64748b",
  "--color-warning-text": "#b45309",
  "--color-warning-surface": "#fffbeb",
  "--color-focus-ring": "#0b1f33",
  "--color-on-accent": "#0f172a",
};

/**
 * Structural scans must inspect CODE, not prose. A comment that says
 * "gold is #F59E0B, never paired with white" is documentation of the
 * rule, not a violation of it — scanning raw text would flag exactly the
 * comments that explain why the rule exists, and the natural fix would
 * be to delete the explanation. Comments are therefore stripped first.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const css = readFileSync(GLOBALS_CSS, "utf8");

describe("design tokens", () => {
  it.each(Object.entries(APPROVED_PALETTE))("defines %s as %s", (token, hex) => {
    expect(css).toContain(`${token}: ${hex}`);
  });

  it.each(Object.entries(DERIVED_TOKENS))("defines derived %s as %s", (token, hex) => {
    expect(css).toContain(`${token}: ${hex}`);
  });

  it("declares no dark-mode block — dark mode is out of Phase 8", () => {
    const code = stripComments(css);
    expect(code).not.toContain("prefers-color-scheme");
    expect(code).not.toContain('[data-theme="dark"]');
  });
});

describe("components never restate a colour", () => {
  const componentFiles = [
    ...walk(join(WEB_ROOT, "components"), [".tsx", ".ts"]),
    ...walk(join(WEB_ROOT, "app"), [".tsx", ".ts"]),
    ...walk(join(WEB_ROOT, "lib"), [".ts", ".tsx"]),
  ];

  it("finds component files to scan", () => {
    expect(componentFiles.length).toBeGreaterThan(5);
  });

  it.each(componentFiles.map((f) => [f.replace(WEB_ROOT, "apps/web"), f]))(
    "%s contains no hex colour literal",
    (_label, file) => {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    }
  );
});

describe("logical properties", () => {
  const styledFiles = [
    ...walk(join(WEB_ROOT, "components"), [".tsx"]),
    ...walk(join(WEB_ROOT, "app"), [".tsx"]),
  ];

  // Physical direction utilities that have a logical equivalent and are
  // therefore banned (§14.2). `ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`
  // are the replacements.
  const BANNED = [
    /\bml-\d/,
    /\bmr-\d/,
    /\bpl-\d/,
    /\bpr-\d/,
    /\bleft-\d/,
    /\bright-\d/,
    /\bborder-l\b/,
    /\bborder-r\b/,
    /\btext-left\b/,
    /\btext-right\b/,
  ];

  it.each(styledFiles.map((f) => [f.replace(WEB_ROOT, "apps/web"), f]))(
    "%s uses logical properties only",
    (_label, file) => {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const pattern of BANNED) {
        expect(pattern.test(code)).toBe(false);
      }
    }
  );
});

describe("no unsafe HTML injection", () => {
  const allFiles = [
    ...walk(join(WEB_ROOT, "components"), [".tsx", ".ts"]),
    ...walk(join(WEB_ROOT, "app"), [".tsx", ".ts"]),
    ...walk(join(WEB_ROOT, "lib"), [".ts", ".tsx"]),
  ];

  it("no file uses dangerouslySetInnerHTML", () => {
    for (const file of allFiles) {
      expect(stripComments(readFileSync(file, "utf8"))).not.toContain("dangerouslySetInnerHTML");
    }
  });

  it("the comment stripper does not hide a real violation", () => {
    // Guards the guard, the same way the @platform/types Prisma guard
    // does: prose about a banned construct must pass, real use must not.
    expect(stripComments('// never use dangerouslySetInnerHTML\nconst a = 1;')).not.toContain(
      "dangerouslySetInnerHTML"
    );
    expect(stripComments('<div dangerouslySetInnerHTML={{ __html: x }} />')).toContain(
      "dangerouslySetInnerHTML"
    );
    expect(stripComments("/* gold is #F59E0B */\nconst a = 1;")).not.toContain("#F59E0B");
    expect(stripComments('const c = "#F59E0B";')).toContain("#F59E0B");
  });
});
