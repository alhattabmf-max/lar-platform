import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Static properties of the admin HTTP surface.
 *
 * Read from the source rather than from a running app: these are
 * statements about what CANNOT exist, and a runtime test only proves
 * things about the routes it happens to call.
 */

const ADMIN_ROOT = join(__dirname, "..", "..", "admin");

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (entry.endsWith(".controller.ts")) found.push(full);
  }
  return found;
}

const CONTROLLERS = walk(ADMIN_ROOT).map((path) => ({
  path,
  name: path.slice(path.lastIndexOf("admin")),
  source: readFileSync(path, "utf8"),
}));

describe("every admin controller is behind the admin session guard", () => {
  it("finds the controllers at all", () => {
    // A guard against this whole file passing because the walk found
    // nothing — the failure mode that makes a suite look green.
    expect(CONTROLLERS.length).toBeGreaterThan(15);
  });

  it.each(CONTROLLERS.map((c) => [c.name, c.source] as const))(
    "%s declares AdminSessionAuthGuard",
    (_name, source) => {
      expect(source).toContain("AdminSessionAuthGuard");
    }
  );
});

describe("every state-changing admin route is behind the CSRF guard", () => {
  // The admin session rides in a cookie, so a state-changing route
  // without an Origin check is cross-site-forgeable by any page the
  // operator happens to have open.
  const WRITERS = CONTROLLERS.filter(
    (c) => /@(Post|Put|Patch|Delete)\(/.test(c.source)
  );

  it("finds controllers that write", () => {
    expect(WRITERS.length).toBeGreaterThan(10);
  });

  it.each(WRITERS.map((c) => [c.name, c.source] as const))(
    "%s declares CsrfGuard",
    (_name, source) => {
      expect(source).toContain("CsrfGuard");
    }
  );
});

describe("no admin controller re-declares a raw enum vocabulary", () => {
  // A locally declared status list is how the API and the portal drift
  // on what a valid filter is. Every admin query DTO validates against
  // the shared package instead.
  const QUERY_DTOS = (function collect(): { name: string; source: string }[] {
    const out: { name: string; source: string }[] = [];
    function visit(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) visit(full);
        else if (/query\.dto\.ts$/.test(entry)) {
          out.push({ name: entry, source: readFileSync(full, "utf8") });
        }
      }
    }
    visit(ADMIN_ROOT);
    return out;
  })();

  it("finds the query DTOs", () => {
    expect(QUERY_DTOS.length).toBeGreaterThan(3);
  });

  it.each(QUERY_DTOS.map((d) => [d.name, d.source] as const))(
    "%s imports its vocabulary from a shared package",
    (_name, source) => {
      // Every one of these files filters by at least one vocabulary, so
      // each must reach for a shared constant rather than an inline
      // array of string literals.
      if (!/@IsIn\(/.test(source)) return;
      expect(source).toMatch(/from "@platform\/(types|domain)"/);
      // An inline array inside @IsIn is exactly the local copy this
      // forbids.
      expect(source).not.toMatch(/@IsIn\(\s*\[/);
    }
  );
});

describe("the admin surface has no self-registration", () => {
  it("no controller exposes a route that creates an administrator", () => {
    // Accounts are created by the bootstrap command on the server. An
    // HTTP create would make one compromised session enough to mint a
    // second permanent one.
    const adminUsers = CONTROLLERS.find((c) => c.name.includes("admin-users"));
    expect(adminUsers).toBeDefined();

    const source = adminUsers!.source;
    // A bare `@Post()` on the collection is the create route. The
    // lifecycle routes all carry a path segment.
    expect(source).not.toMatch(/@Post\(\s*\)/);
    expect(source).not.toMatch(/@Put\(\s*\)/);
  });

  it("no admin controller exposes a delete", () => {
    // Nothing in this system is hard-deleted through the console:
    // reference data deactivates, banners deactivate, products close,
    // administrators are disabled. The one exception is a banner's
    // image, which is a file rather than a record.
    for (const controller of CONTROLLERS) {
      if (controller.name.includes("banner-image")) continue;
      expect(controller.source).not.toMatch(/@Delete\(/);
    }
  });
});
