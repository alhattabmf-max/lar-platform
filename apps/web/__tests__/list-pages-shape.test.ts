import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import messages from "@/messages/ar-SA.json";

/**
 * EVERY LIST PAGE, ONE SHAPE.
 *
 * They had drifted: some printed the section's name a second time under
 * the sidebar entry that already said it, some stood a row of export
 * buttons above the search card, and all of them left that card open
 * over the rows it was meant to help find. Three rows of chrome before
 * the first record.
 *
 * The shape now: the actions and «بحث» share one row, and the table
 * follows it.
 */
const ROOT = join(__dirname, "..");
const ADMIN = join(ROOT, "app", "[locale]", "admin");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return entry === "page.tsx" ? [full] : [];
  });
}

/** Every admin page that renders the shared toolbar. */
const LIST_PAGES = walk(ADMIN).filter((file) =>
  readFileSync(file, "utf8").includes("<ListToolbar")
);

const source = (file: string) => readFileSync(file, "utf8");
const name = (file: string) => relative(ADMIN, file).split("\\").join("/");

describe("the list pages", () => {
  it("finds them", () => {
    // If this ever reads zero the rest of the file passes vacuously.
    expect(LIST_PAGES.length).toBeGreaterThanOrEqual(10);
  });

  it("prints no section name a second time", () => {
    // The sidebar entry is lit. A heading repeating it is a line of the
    // page spent saying what the reader just clicked.
    const offenders = LIST_PAGES.filter((file) =>
      /<h1 className="text-2xl font-semibold text-content">\{t\("title"\)\}<\/h1>/.test(
        source(file)
      )
    ).map(name);

    // TWO KEEP THEIR HEADING, and neither is a sidebar destination —
    // nothing else on screen names them:
    //
    //   follow-up        «مركز المتابعة», reached from the dashboard
    //   products/reports «بلاغات المنتجات», reached from the products
    //                    screen, whose sidebar entry reads «المنتجات»
    expect(offenders.sort()).toEqual([
      "follow-up/page.tsx",
      "products/reports/page.tsx",
    ]);
  });

  it("keeps a heading for a reader who cannot see the sidebar", () => {
    // Hidden from the screen, not from the document. Somebody using a
    // screen reader cannot see which sidebar entry is highlighted.
    const missing = LIST_PAGES.filter((file) => !/<h1/.test(source(file))).map(
      name
    );

    expect(missing).toEqual([]);
  });

  it("stands no row of action buttons above the toolbar", () => {
    // Export and template now share the toolbar's row, at the other
    // end. A row of their own cost a row of the page for two controls.
    const offenders = LIST_PAGES.filter((file) => {
      const body = source(file);
      const toolbarAt = body.indexOf("<ListToolbar");
      const above = body.slice(0, toolbarAt);
      return (
        /<ExportToExcel/.test(above) || /<CompanyWorkbookActions/.test(above)
      );
    }).map(name);

    expect(offenders).toEqual([]);
  });

  it("hands the toolbar its «بحث» label", () => {
    const missing = LIST_PAGES.filter(
      (file) => !source(file).includes("openLabel:")
    ).map(name);

    expect(missing).toEqual([]);
  });
});

describe("the toolbar itself", () => {
  const toolbar = readFileSync(
    join(ROOT, "components", "admin", "list-toolbar.tsx"),
    "utf8"
  );

  it("starts shut", () => {
    expect(toolbar).toContain("const [open, setOpen] = useState(() => narrowedBy > 0)");
  });

  it("puts the actions and the button at opposite ends of one row", () => {
    // In Arabic the row runs right to left, so `justify-between` leaves
    // «بحث» on the LEFT; in English it leaves it on the right. One
    // rule, and it is the logical one — no direction branch here.
    expect(toolbar).toContain("justify-between");
    expect(toolbar).toContain("{actions}");
  });

  it("names the button with an icon beside it", () => {
    expect(toolbar).toContain("<Search");
    expect(toolbar).toContain("{labels.openLabel}");
    expect(messages.admin.filters.search).toBe("بحث");
  });

  it("has no second disclosure inside the card", () => {
    // A door behind a door. The card is already behind a button.
    expect(toolbar).not.toContain("list-toolbar-filters-toggle");
    expect(toolbar).not.toContain("filtersOpen");
  });
});
