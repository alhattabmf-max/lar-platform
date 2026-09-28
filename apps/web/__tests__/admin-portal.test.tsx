import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTROL_PANEL_PAGES } from "@/components/admin/control-panel-nav";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * Comments and string literals routinely contain the very words these
 * rules forbid — a comment explaining why a page does not use
 * `AppShell` must not fail the rule about using `AppShell`.
 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Every admin page, discovered from disk.
 *
 * Hardcoding this list would mean a page added later silently escapes
 * the rules below — which is exactly how one screen ends up without the
 * guard, without no-store, or with its own cache directive.
 */
function adminPages(
  dir = join(ROOT, "app", "[locale]", "admin"),
  prefix = "admin"
): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return adminPages(join(dir, entry.name), `${prefix}/${entry.name}`);
    return entry.name === "page.tsx" ? [`${prefix}/page.tsx`] : [];
  });
}

const ADMIN_PAGES = adminPages();

function adminComponents(dir = join(ROOT, "components", "admin")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? adminComponents(join(dir, entry.name))
      : entry.name.endsWith(".tsx")
        ? [join("components/admin", entry.name)]
        : []
  );
}

const ADMIN_COMPONENTS = adminComponents();

const LAYOUT = read("app/[locale]/admin/layout.tsx");
const ADMIN_DATA = read("lib/admin-data.ts");
const ADMIN_SESSION = read("lib/admin-session.ts");
const ADMIN_REDIRECTS = read("lib/admin-redirects.ts");

describe("the admin segment is discovered, not assumed", () => {
  it("finds a real portal", () => {
    // Without this the whole file passes on an empty list.
    expect(ADMIN_PAGES.length).toBeGreaterThan(14);
    expect(ADMIN_COMPONENTS.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------- guard

describe("the guard runs on the server, once, for the whole segment", () => {
  it("the layout resolves the session before rendering anything", () => {
    expect(LAYOUT).toContain("getAdminSession");
    // Declared on the LAYOUT so the whole segment inherits it. A page
    // added later cannot forget it.
    expect(LAYOUT).toContain('export const dynamic = "force-dynamic"');
  });

  it("an unauthenticated visitor gets the login screen, never the chrome", () => {
    const body = strip(LAYOUT);
    // The shell is rendered only after the session check succeeds.
    const gateIndex = body.indexOf("AdminLoginGate");
    const shellIndex = body.indexOf("<ControlPanelShell");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(shellIndex).toBeGreaterThan(gateIndex);
  });

  it("there is exactly ONE outcome for a failed check — no /unauthorized branch", () => {
    // Anyone who is not an administrator has no business learning
    // whether an admin area exists, so "not signed in" and "not an
    // administrator" produce the same screen.
    expect(strip(ADMIN_REDIRECTS)).not.toContain("/unauthorized");
    expect(strip(LAYOUT)).not.toContain("/unauthorized");
  });

  it("every page calls the server-side guard for itself", () => {
    // The layout guard already ran, but a page that reads admin data
    // without asserting a session is one refactor away from being
    // rendered outside this layout.
    for (const page of ADMIN_PAGES) {
      expect(strip(read(`app/[locale]/${page}`))).toContain("requireAdminOrRedirect");
    }
  });

  it("no page performs a client-side role check", () => {
    for (const page of ADMIN_PAGES) {
      expect(strip(read(`app/[locale]/${page}`))).not.toContain('"use client"');
    }
  });
});

// ------------------------------------------------------------- sessions

describe("the admin session is separate from the company session", () => {
  it("it is read through its own endpoint, not through /me", () => {
    expect(ADMIN_SESSION).toContain("/admin/auth/me");
    // An administrator has no company, so `MeResponse` cannot describe
    // one; folding the two behind a flag is how an admin ends up
    // requesting the trader's `/me` and reading as logged out.
    expect(strip(ADMIN_SESSION)).not.toContain('get<MeResponse>');
  });

  it("the cookie is forwarded, never read or parsed", () => {
    // Server Components have no cookie jar, so the header is assembled
    // and handed to the client. Nothing here inspects a value.
    expect(ADMIN_SESSION).toContain("cookieHeader");
    expect(strip(ADMIN_SESSION)).not.toMatch(/\.get\(\s*"asid"/);
    expect(strip(ADMIN_DATA)).not.toMatch(/\.get\(\s*"asid"/);
  });

  it("only a 401 becomes 'no session' — every other failure rethrows", () => {
    // Swallowing a 500 would render a signed-out admin screen during an
    // outage and hide the outage.
    expect(ADMIN_SESSION).toContain('error.kind === "unauthorized"');
    expect(ADMIN_SESSION).toContain("throw error");
  });
});

// ------------------------------------------------------------------ data

describe("every admin read is uncached", () => {
  it("the data module sets no-store and forwards the cookie in one place", () => {
    const body = strip(ADMIN_DATA);
    expect(body).toContain('cache: "no-store"');
    // Exactly one `apiClient.get` — every loader goes through the same
    // `load()`, which is what makes the guarantee provable here rather
    // than per call site.
    expect(body.match(/apiClient\.get/g) ?? []).toHaveLength(1);
  });

  it("no admin read opts into revalidation", () => {
    // These are the platform's operational records. A shared-cache copy
    // of them is a disclosure of the whole platform.
    expect(strip(ADMIN_DATA)).not.toContain("revalidate");
  });

  it("no page calls apiClient directly", () => {
    // A direct call would bypass the no-store and cookie-forwarding
    // guarantees this module exists to hold.
    for (const page of ADMIN_PAGES) {
      expect(strip(read(`app/[locale]/${page}`))).not.toContain("apiClient");
    }
  });
});

// ----------------------------------------------------------------- money

describe("no admin screen does arithmetic on money", () => {
  const MONEY_FIELDS = [
    "totalAmount",
    "supplierPayableAmount",
    "netAmount",
    "amount",
    "unitPriceAmount",
    "productRefundAmountInclTax",
    "shippingRefundAmount",
  ];

  it("no page adds, multiplies or reduces a money field", () => {
    for (const page of ADMIN_PAGES) {
      const body = strip(read(`app/[locale]/${page}`));
      for (const field of MONEY_FIELDS) {
        // Every total is server-authoritative. A recomputed one is a
        // second source of truth that eventually disagrees with what
        // was actually charged or paid.
        expect(body).not.toMatch(new RegExp(`${field}\\s*[+*/-]`));
        expect(body).not.toMatch(new RegExp(`Number\\(\\s*\\w+\\.${field}`));
        expect(body).not.toMatch(new RegExp(`parseFloat\\(\\s*\\w+\\.${field}`));
      }
    }
  });

  it("no admin component parses a money string into a number", () => {
    for (const component of ADMIN_COMPONENTS) {
      const body = strip(read(component));
      expect(body).not.toContain("parseFloat");
    }
  });
});

// --------------------------------------------------------------- secrets

describe("no admin screen renders a secret or a storage key", () => {
  const FORBIDDEN = [
    "passwordHash",
    "twoFactorSecretEncrypted",
    "ibanCiphertext",
    "ibanFingerprint",
    "objectKey",
    "thumbnailObjectKey",
    "storageObjectKey",
    "beforeData",
    "afterData",
    "snapshotData",
    "idempotencyKey",
    "headerFooterConfig",
  ];

  it.each(FORBIDDEN)("no page reads %s", (field) => {
    for (const page of ADMIN_PAGES) {
      expect(strip(read(`app/[locale]/${page}`))).not.toContain(field);
    }
  });

  it("no admin screen uses dangerouslySetInnerHTML", () => {
    // Operator-written text and counterparty free text both appear on
    // these screens. A markup path is a stored cross-site-scripting
    // hole waiting for one careless paste; the way to not have one is
    // to never have the code path.
    for (const file of [
      ...ADMIN_PAGES.map((page) => `app/[locale]/${page}`),
      ...ADMIN_COMPONENTS,
    ]) {
      // Stripped, because the components that most deserve this rule
      // are the ones whose comments explain why they do not use it.
      expect(strip(read(file))).not.toContain("dangerouslySetInnerHTML");
    }
  });
});

// ------------------------------------------------------------------- nav

describe("the navigation covers what exists and nothing more", () => {
  it("every destination has a real page", () => {
    const segments = new Set(
      ADMIN_PAGES.map((page) =>
        page.replace(/^admin\/?/, "").replace(/\/?page\.tsx$/, "")
      )
    );

    for (const destination of CONTROL_PANEL_PAGES) {
      // A menu entry that 404s is worse than one that is absent.
      expect(segments.has(destination.segment)).toBe(true);
    }
  });

  it("has no duplicate destination", () => {
    const keys = CONTROL_PANEL_PAGES.map((destination) => destination.key);
    expect(new Set(keys).size).toBe(keys.length);

    const segments = CONTROL_PANEL_PAGES.map((destination) => destination.segment);
    expect(new Set(segments).size).toBe(segments.length);
  });

  it("starts at the dashboard", () => {
    // The map puts `home` first and it carries an icon, so the shape is
    // checked rather than the whole object.
    expect(CONTROL_PANEL_PAGES[0].key).toBe("dashboard");
    expect(CONTROL_PANEL_PAGES[0].segment).toBe("");
  });
});

// ------------------------------------------------------------ interaction

describe("interaction rules", () => {
  it("reordering is keyboard-operable, never drag-only", () => {
    // A drag handle is unreachable by keyboard and hostile on a touch
    // screen. Both reorderable surfaces use buttons.
    for (const component of ["components/admin/banner-manager.tsx", "components/admin/site-content-editor.tsx"]) {
      const body = read(component);
      expect(body).toContain("aria-label");
      expect(body).toMatch(/moveUp|navMoveUp/);
      expect(body).toMatch(/moveDown|navMoveDown/);
      expect(strip(body)).not.toContain("draggable");
      expect(strip(body)).not.toContain("onDragStart");
    }
  });

  it("no admin component uses a native browser dialog", () => {
    // A native dialog cannot be translated, ignores the page direction,
    // and is suppressible by the browser — so the confirmation could
    // simply not appear.
    for (const component of ADMIN_COMPONENTS) {
      const body = strip(read(component));
      expect(body).not.toContain("window.confirm");
      expect(body).not.toContain("window.alert");
      expect(body).not.toContain("window.prompt");
    }
  });

  it("every idempotent write mints its key once, outside the retry path", () => {
    // A key minted per click defeats the mechanism entirely: a retry
    // after a timeout would look like a brand-new instruction and could
    // execute a second refund.
    for (const component of ADMIN_COMPONENTS) {
      const body = strip(read(component));
      if (!body.includes("newIdempotencyKey")) continue;
      // It is held in state, not called inline in the request.
      expect(body).toMatch(/useState<IdempotencyKey/);
      expect(body).not.toMatch(/idempotencyKey:\s*newIdempotencyKey\(\)/);
    }
  });

  it("every write component guards against a double submit", () => {
    for (const component of ADMIN_COMPONENTS) {
      const body = strip(read(component));
      if (!/apiClient\.(post|put|patch|delete)/.test(body)) continue;
      expect(body).toContain("setBusy");
      expect(body).toMatch(/if \(busy/);
    }
  });
});

// -------------------------------------------------------------- honesty

describe("nothing on these screens is invented", () => {
  it("no page hardcodes a currency literal", () => {
    // `MasterOrder` has no currency column; the platform's currency
    // comes from the message catalogue, and every other amount carries
    // its own.
    for (const page of ADMIN_PAGES) {
      expect(strip(read(`app/[locale]/${page}`))).not.toMatch(/"SAR"/);
    }
  });

  it("the dashboard counts nothing itself", () => {
    const body = strip(read("app/[locale]/admin/page.tsx"));

    // THE ORIGINAL FAULT: `items.length` of a first page read "25" for
    // any backlog larger than a page — wrong in the direction that
    // matters. The screen no longer counts at all: every figure is an
    // aggregate the API computed over the whole window, so there is no
    // array here whose length could stand in for a total.
    expect(body).not.toContain("items.length");
    expect(body).toContain("loadDashboardOverview");
  });

  it("the dashboard asks for ONE read, not a list per card", () => {
    const body = strip(read("app/[locale]/admin/page.tsx"));

    // Six list endpoints counted by hand is what this replaced.
    const loads = body.match(/\bload[A-Z][A-Za-z]*\(/g) ?? [];
    expect(loads).toHaveLength(1);
    expect(loads[0]).toBe("loadDashboardOverview(");
  });

  it("shows an em dash where a comparison cannot be made", () => {
    const chrome = strip(read("components/admin/dashboard-chrome.tsx"));

    // "0%" would claim nothing moved when in truth nothing was known.
    expect(chrome).toContain("value === null");
    expect(chrome).toContain("—");
  });

  it("the outbox screen states the provider mode and what PUBLISHED means", () => {
    const body = read("app/[locale]/admin/outbox/page.tsx");
    expect(body).toContain("providerMode");
    expect(body).toContain("publishedMeaning");
  });

  it("EXPLAINS ITSELF NOWHERE, on either screen", () => {
    // Both used to carry a boxed sentence under the heading — «الإدارة
    // تتابع المنتجات المعروضة ولا تنشئها ولا تعدّلها…» and the same
    // shape over the administrators list. The owner named the first one
    // as an example and banned the shape platform-wide: «القسم واضح ما
    // يحتاج شرح له».
    //
    // WHAT ENFORCED THE RULE STILL DOES. Neither screen renders a
    // create or edit control, and `no-blurbs.test.ts` holds the shape
    // shut everywhere. A sentence saying so was belt over braces.
    for (const page of [
      "app/[locale]/admin/opportunities/page.tsx",
      "app/[locale]/admin/admin-users/page.tsx",
    ]) {
      const source = read(page);
      expect(source).not.toContain("monitorOnlyNotice");
      expect(source).not.toContain("creationNotice");
    }
  });
});

describe("every admin destination is a route that exists", () => {
  const ADMIN_COMPONENTS = join(ROOT, "components", "admin");

  /** Every `/{locale}/…` path this portal navigates to, read from source. */
  function internalPaths(): { file: string; path: string }[] {
    const files = [
      ...readdirSync(ADMIN_COMPONENTS)
        .filter((name) => name.endsWith(".tsx"))
        .map((name) => join(ADMIN_COMPONENTS, name)),
      join(ROOT, "lib", "admin-redirects.ts"),
    ];

    const found: { file: string; path: string }[] = [];
    for (const file of files) {
      const source = strip(readFileSync(file, "utf8"));
      // `/${locale}/admin/...` and `/${appLocale}/admin/...`
      for (const match of source.matchAll(
        /`\/\$\{(?:app)?[Ll]ocale\}(\/admin[^`$]*)`/g,
      )) {
        found.push({ file: file.replace(ROOT, ""), path: match[1] });
      }
    }
    return found;
  }

  /** Whether the app router can actually produce this path. */
  function routeExists(path: string): boolean {
    const segments = path
      .split("?")[0]
      .split("#")[0]
      .split("/")
      .filter(Boolean);
    let dir = join(ROOT, "app", "[locale]");

    for (const segment of segments) {
      const literal = join(dir, segment);
      if (existsSync(literal)) {
        dir = literal;
        continue;
      }
      // A dynamic segment matches anything: `[id]`, `[...slug]`.
      const dynamic = readdirSync(dir, { withFileTypes: true }).find(
        (entry) => entry.isDirectory() && entry.name.startsWith("["),
      );
      if (!dynamic) return false;
      dir = join(dir, dynamic.name);
    }

    return existsSync(join(dir, "page.tsx"));
  }

  it("finds the paths to check", () => {
    // A guard against this whole block passing because the scan found
    // nothing — the failure mode that makes a test look green.
    //
    // IT WAS FOUR, then three, and it is two.
    //
    // Four included `admin-shell.tsx` — a shell no layout rendered,
    // holding a second copy of the console's destination list. Three
    // included `admin-pagination.tsx`, a pager nothing imported and
    // whose own exports were named nowhere in the repository. Each time
    // the number fell because a file stopped existing, not because the
    // scan stopped working: what this case guards is that it finds
    // SOMETHING, and two is what the console's live files contain.
    expect(internalPaths().length).toBeGreaterThanOrEqual(2);
  });

  it("navigates to no page that does not exist", () => {
    // THE FAULT THIS CATCHES: sign-out sent the administrator to
    // `/{locale}/admin/login`, and the redirect guard sent every
    // unauthenticated visitor to the same place — a route that has
    // never existed. Both landed on a raw 404 with no way back. The
    // layout gate masked it on ordinary visits, which is how it
    // survived; neither TypeScript nor the build sees a dead href.
    const dead = internalPaths().filter((entry) => !routeExists(entry.path));

    expect(dead).toEqual([]);
  });

  it("shows the sign-in form at the segment root, which is where they are sent", () => {
    const layout = read("app/[locale]/admin/layout.tsx");
    const redirects = read("lib/admin-redirects.ts");

    expect(layout).toContain("AdminLoginGate");
    expect(redirects).toContain("`/${locale}/admin`");
  });
});
