import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WHAT A SERVER COMPONENT MAY IMPORT FROM A CLIENT MODULE.
 *
 * A module marked `"use client"` does not export functions to the
 * server. It exports CLIENT REFERENCES — placeholders React swaps for
 * the real thing in the browser — and calling one during a server
 * render throws at request time:
 *
 *     Attempted to call parsePageSize() from the server but
 *     parsePageSize is on the client.
 *
 * NOTHING ELSE CATCHES THIS. TypeScript sees an ordinary import and is
 * satisfied. `next build` compiles it. Every component test passes,
 * because a test renders the module directly with no boundary between
 * them. It took ten control panel pages returning a digest on a real
 * request — after 2178 green tests — to find one moved helper.
 *
 * So the rule is checked HERE, statically, over every page in the app:
 * a Server Component may RENDER a client component, and may import its
 * types, but may not import a value it will call. Values shared across
 * the boundary belong in a module that takes no side — see
 * `lib/admin-list-query.ts`.
 */

const WEB = process.cwd();
const APP = join(WEB, "app");

function walk(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, match);
    return match(entry.name) ? [full] : [];
  });
}

/** Every route file React renders on the server. */
const ROUTE_FILES = walk(APP, (name) =>
  [
    "page.tsx",
    "layout.tsx",
    "template.tsx",
    "error.tsx",
    "not-found.tsx",
  ].includes(name),
).filter((file) => !isClientModule(file));

function isClientModule(file: string): boolean {
  try {
    return readFileSync(file, "utf8").trimStart().startsWith('"use client"');
  } catch {
    return false;
  }
}

/** Resolves a `@/...` specifier to the file it means, or null. */
function resolve(specifier: string): string | null {
  if (!specifier.startsWith("@/")) return null;
  const base = join(WEB, specifier.slice(2));
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, "index.ts"),
  ]) {
    try {
      readFileSync(candidate, "utf8");
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

interface Imported {
  file: string;
  from: string;
  names: string[];
}

/** Every `import { a, b } from "@/x"` in a server file, types dropped. */
function valueImports(file: string): Imported[] {
  const source = readFileSync(file, "utf8");
  const out: Imported[] = [];

  const pattern = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const [, wholeIsType, body, from] = match;
    if (wholeIsType) continue;

    const names = body
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      // `import { type Foo }` crosses no boundary — a type is erased.
      .filter((entry) => !entry.startsWith("type "))
      .map((entry) => entry.split(/\s+as\s+/)[0].trim())
      .filter(Boolean);

    if (names.length > 0) out.push({ file, from, names });
  }

  return out;
}

/**
 * A component, by the only convention React itself uses.
 *
 * JSX treats a lowercase tag as an HTML element, so a client export a
 * server file may render is necessarily capitalised. Anything else it
 * imported, it imported in order to CALL.
 */
const looksLikeComponent = (name: string) => /^[A-Z]/.test(name);

/**
 * Every module that ends up rendering ON THE SERVER.
 *
 * THE ROUTE FILES ARE NOT THE WHOLE SET, and believing they were is
 * what let a real crash through. A component under `components/` with
 * no directive is a SERVER component when a page renders it — so it
 * runs on the server, and calling a client export from it throws at
 * request time exactly as a page would.
 *
 * That is the shape of the bug this guard grew to catch:
 * `company-management.tsx` imported `exportLabelQuery` from a
 * `"use client"` module and every visit to the management tab died
 * with «Attempted to call exportLabelQuery() from the server». The
 * route file itself was clean, so checking only route files saw
 * nothing — and neither did `tsc`, `next build`, or a component test
 * that renders the component inside a client-side test environment.
 *
 * So the walk follows imports from each route file through every
 * directive-free module it reaches, transitively.
 */
function serverReachableModules(): string[] {
  const seen = new Set<string>();
  const queue = [...ROUTE_FILES];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const imported of valueImports(file)) {
      const target = resolve(imported.from);
      // A client module is a BOUNDARY: what it imports runs on the
      // client, so the walk stops there.
      if (!target || isClientModule(target)) continue;
      if (!seen.has(target)) queue.push(target);
    }
  }

  return [...seen];
}

const SERVER_FILES = serverReachableModules();

describe("no server file calls into a client module", () => {
  it("finds the route files to check", () => {
    // A guard against this whole suite passing because the walk found
    // nothing — the failure mode that makes a test file look green.
    expect(ROUTE_FILES.length).toBeGreaterThan(30);
  });

  it("follows imports past the route files into server components", () => {
    // The set must be BIGGER than the routes, or the walk is not
    // walking and the regression below could return unnoticed.
    expect(SERVER_FILES.length).toBeGreaterThan(ROUTE_FILES.length);
    expect(SERVER_FILES.some((file) => file.includes("components"))).toBe(true);
  });

  const violations: { file: string; from: string; name: string }[] = [];
  for (const file of SERVER_FILES) {
    for (const imported of valueImports(file)) {
      const target = resolve(imported.from);
      if (!target || !isClientModule(target)) continue;
      for (const name of imported.names) {
        if (!looksLikeComponent(name)) {
          violations.push({
            file: file.replace(WEB, ""),
            from: imported.from,
            name,
          });
        }
      }
    }
  }

  it("imports no lower-case value from a `use client` module", () => {
    // TWO REGRESSIONS THIS EXISTS FOR.
    //
    // `parsePageSize` was moved into `data-table-pagination.tsx` — a
    // client module — and ten pages went on importing it. Every one
    // threw on its first real request.
    //
    // `exportLabelQuery` lived in `export-to-excel.tsx` and was called
    // by `company-management.tsx`, a server component. The management
    // tab crashed on every visit while the route file looked clean.
    expect(violations).toEqual([]);
  });

  it("still allows rendering a client component from the server", () => {
    // The rule is about CALLING, not about composing. A page that
    // renders `<ListToolbar>` is correct and must stay possible.
    const companies = readFileSync(
      join(APP, "[locale]", "admin", "companies", "page.tsx"),
      "utf8",
    );

    expect(companies).toContain('from "@/components/admin/list-toolbar"');
    expect(companies).toContain("<ListToolbar");
    expect(isClientModule(join(WEB, "components/admin/list-toolbar.tsx"))).toBe(
      true,
    );
  });
});

/**
 * WHAT A SERVER COMPONENT MAY PASS to a client one, which is a
 * different rule from what it may import.
 *
 * A NAV MAP HOLDS ICONS, AND AN ICON IS A FUNCTION. React serialises
 * every prop that crosses the boundary, and it refuses a function:
 *
 *     Functions cannot be passed directly to Client Components unless
 *     you explicitly expose it by marking it with "use server".
 *
 * NOTHING ELSE CATCHES THIS EITHER. TypeScript sees a well-typed prop.
 * `next build` compiles it and prerenders 123 pages without complaint.
 * The component tests pass, because a test renders both halves on one
 * side of a boundary that does not exist there. It took a real request
 * to `/ar-SA/trader` returning a 500 on a fully green suite.
 *
 * The rule: a map is bound to a chrome INSIDE the client bundle — in a
 * `"use client"` file that imports its own portal's map — and the
 * layout above passes strings and elements only.
 */
/**
 * NO CLIENT COMPONENT ASKS THE SERVER FOR A FUNCTION.
 *
 * THE SAME FAULT, THREE TIMES. React serialises every prop that crosses
 * into a Client Component and refuses a function:
 *
 *     Functions cannot be passed directly to Client Components unless
 *     you explicitly expose it by marking it with "use server".
 *
 * It cost three screens before this guard existed — the buyer's portal
 * (a nav map holding Lucide icons), the orders screen
 * (`hours: (value) => …` inside a labels object) and the follow-up
 * centre (`sinceHours`, the same shape). Every one was a 500 on EVERY
 * request, and nothing caught any of them: TypeScript is satisfied,
 * `next build` prerenders happily, and the component tests pass because
 * a test renders both halves on one side of a boundary that is not
 * there.
 *
 * THE GUARD IS ON THE RECEIVING SIDE, because that is where the mistake
 * becomes possible. A client component that declares a formatter prop
 * is an invitation for a server page to pass one; a client component
 * that only declares strings cannot be handed a function at all. So the
 * rule is: a `"use client"` module's prop types carry DATA — the
 * formatting happens on the server, where the message catalogue is.
 *
 * EVENT HANDLERS ARE THE EXCEPTION, and are recognised by their names.
 * `onClick`, `onChange`, `onDrawerClose` are only ever passed from
 * other client components, which is a plain call and not a
 * serialisation.
 */
describe("no client component asks the server for a function", () => {
  /**
   * Names allowed to be functions despite not being `on*` handlers.
   *
   * Each is listed with the reason it cannot reach a server component,
   * because a general pattern here would let the next one through
   * without anybody deciding it should.
   */
  const ALLOWED: Record<string, string> = {
    // Next.js hands this to an error boundary itself; no page passes it.
    reset: "app/[locale]/admin/error.tsx — supplied by Next, not by a page",
    // Passed between two components inside ONE "use client" module.
    run: "components/admin/banner-manager.tsx — client-to-client only",
  };

  function clientModules(): string[] {
    const roots = [join(WEB, "app"), join(WEB, "components")];
    return roots
      .flatMap((root) =>
        walk(root, (name) => name.endsWith(".tsx") || name.endsWith(".ts")),
      )
      .filter((file) =>
        /^\s*["']use client["']/m.test(readFileSync(file, "utf8")),
      );
  }

  /** Function-typed FIELDS of a type — a trailing `;`, not a `,`. */
  function functionProps(source: string): { name: string; line: number }[] {
    const found: { name: string; line: number }[] = [];
    source.split("\n").forEach((line, index) => {
      const match = line.match(/^\s*(\w+)\??:\s*\([^)]*\)\s*=>.*;\s*$/);
      if (match) found.push({ name: match[1], line: index + 1 });
    });
    return found;
  }

  it("finds the client modules to check", () => {
    // A guard against this passing because the scan found none.
    expect(clientModules().length).toBeGreaterThan(10);
  });

  it("declares no formatter prop anywhere a server page could fill it", () => {
    const offenders: string[] = [];

    for (const file of clientModules()) {
      for (const prop of functionProps(readFileSync(file, "utf8"))) {
        if (/^on[A-Z]/.test(prop.name)) continue;
        if (ALLOWED[prop.name]) continue;
        offenders.push(`${file.replace(WEB, "")}:${prop.line} — ${prop.name}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the two screens that were broken by it free of formatters", () => {
    // Named directly, so the specific regression cannot return quietly
    // under a prop name the general rule happens not to match.
    const path = readFileSync(
      join(WEB, "components/admin/order-stage-path.tsx"),
      "utf8",
    );
    const table = readFileSync(
      join(WEB, "components/admin/follow-up-table.tsx"),
      "utf8",
    );

    expect(path).not.toMatch(/hours:\s*\(/);
    expect(path).not.toMatch(/days:\s*\(/);
    expect(path).toContain("figures: Record<AdminOrderStage, string>");

    expect(table).not.toMatch(/sinceHours:\s*\(/);
    expect(table).not.toMatch(/sinceDays:\s*\(/);
    expect(table).toContain("ages: Record<string, string>");
  });
});

describe("a nav map never crosses the server boundary", () => {
  /** Every file that hands a `map=` prop to a component. */
  function mapPassers(): string[] {
    const roots = [join(WEB, "app"), join(WEB, "components")];
    return roots
      .flatMap((root) => walk(root, (name) => name.endsWith(".tsx")))
      .filter((file) => /\bmap=\{/.test(readFileSync(file, "utf8")));
  }

  it("finds the files to check", () => {
    // A guard against this passing because the scan found none.
    expect(mapPassers().length).toBeGreaterThan(0);
  });

  it("passes a map only from inside the client bundle", () => {
    for (const file of mapPassers()) {
      const source = readFileSync(file, "utf8");
      const isClient = /^\s*["']use client["']/m.test(source);

      expect([file.replace(WEB, ""), isClient]).toEqual([
        file.replace(WEB, ""),
        true,
      ]);
    }
  });

  it("gives each portal its own client entry, not a shared registry", () => {
    // A registry keyed by portal name would put the console's
    // destinations in the buyer's bundle — the one thing the shared
    // chrome must never do.
    for (const [entry, own, foreign] of [
      [
        "components/trader/trader-chrome.tsx",
        "TRADER_PORTAL_MAP",
        ["SUPPLIER_PORTAL_MAP", "CONTROL_PANEL_MAP"],
      ],
      [
        "components/supplier/supplier-chrome.tsx",
        "SUPPLIER_PORTAL_MAP",
        ["TRADER_PORTAL_MAP", "CONTROL_PANEL_MAP"],
      ],
      [
        "components/admin/control-panel-chrome.tsx",
        "CONTROL_PANEL_MAP",
        ["TRADER_PORTAL_MAP", "SUPPLIER_PORTAL_MAP"],
      ],
    ] as const) {
      const source = readFileSync(join(WEB, entry), "utf8");

      expect([entry, source.includes(own)]).toEqual([entry, true]);
      for (const other of foreign) {
        expect([entry, other, source.includes(other)]).toEqual([
          entry,
          other,
          false,
        ]);
      }
    }
  });
});

describe("the shared list-query helpers take no side", () => {
  const SHARED = join(WEB, "lib", "admin-list-query.ts");

  it("is a plain module, so both sides may use it", () => {
    // The DIRECTIVE, not a mention of it: the comment at the top of that
    // file explains the trap by naming it, and prose takes no side.
    expect(isClientModule(SHARED)).toBe(false);
    expect(
      readFileSync(SHARED, "utf8").trimStart().startsWith('"use server"'),
    ).toBe(false);
  });

  it("is where the page size is decided, for everyone", () => {
    const source = readFileSync(SHARED, "utf8");

    expect(source).toContain("export const PAGE_SIZES");
    expect(source).toContain("export function parsePageSize");
  });

  it("is not re-exported from the client pager, which would restore the trap", () => {
    // Re-exporting it would give a server file a second, broken way to
    // import the same helper.
    const pager = readFileSync(
      join(WEB, "components", "admin", "data-table-pagination.tsx"),
      "utf8",
    );

    expect(pager).not.toMatch(/export\s+(const|function)\s+parsePageSize/);
    expect(pager).not.toMatch(/export\s+const\s+PAGE_SIZES/);
    expect(pager).not.toMatch(/export\s+\{[^}]*parsePageSize/);
  });

  it("is what every control panel list actually imports", () => {
    const pages = walk(
      join(APP, "[locale]", "admin"),
      (name) => name === "page.tsx",
    ).filter((file) => readFileSync(file, "utf8").includes("parsePageSize"));

    // Ten of the eleven lists read a page size; the report screen has no
    // pager of its own.
    expect(pages.length).toBeGreaterThanOrEqual(10);

    for (const file of pages) {
      const source = readFileSync(file, "utf8");
      expect([file.replace(WEB, ""), source]).toEqual([
        file.replace(WEB, ""),
        expect.stringContaining('from "@/lib/admin-list-query"'),
      ]);
    }
  });
});
