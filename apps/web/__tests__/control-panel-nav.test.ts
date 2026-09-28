import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTROL_PANEL_GROUPS,
  CONTROL_PANEL_HOME,
  CONTROL_PANEL_PAGES,
  locateControlPanelPage,
} from "@/components/admin/control-panel-nav";
import arMessages from "../messages/ar-SA.json";
import enMessages from "../messages/en-SA.json";

/**
 * The control panel's map: what is in it, how it is grouped, and how a
 * pathname is turned back into a place.
 *
 * The structure is an approved decision rather than a convenience, so it
 * is asserted literally. A rename or a reshuffle should fail here and be
 * argued, not land quietly because the sidebar still renders something.
 */

const APPROVED_ORDER = [
  // «إدارة التصنيفات» sits beside the products it classifies, not
  // among the reference tables: a category is the shape of the
  // catalogue, while a region and a sales unit are lookups.
  ["market", ["companies", "products", "taxonomy", "opportunities"]],
  ["orders", ["orders", "disputes", "refunds"]],
  ["finance", ["settlements", "invoicing"]],
  // Policies sit beside site content, not under settings: the terms and
  // the privacy policy are pages a visitor reads, not configuration.
  ["content", ["banners", "content", "policies", "branding"]],
  ["system", ["settings", "catalogue", "outbox"]],
  ["security", ["adminUsers", "audit"]],
] as const;

describe("the approved structure, exactly", () => {
  it("has home standing alone above the groups", () => {
    // Not a group of one: a disclosure control that opens to reveal a
    // single link costs a press and gives nothing back.
    expect(CONTROL_PANEL_HOME.key).toBe("dashboard");
    expect(CONTROL_PANEL_HOME.segment).toBe("");
    expect(
      CONTROL_PANEL_GROUPS.map((group) => String(group.key)),
    ).not.toContain("dashboard");
  });

  it("carries the six groups in the approved order", () => {
    expect(CONTROL_PANEL_GROUPS.map((group) => group.key)).toEqual(
      APPROVED_ORDER.map(([key]) => key),
    );
  });

  it.each(APPROVED_ORDER)(
    "puts exactly the right pages under %s",
    (key, pages) => {
      const group = CONTROL_PANEL_GROUPS.find((entry) => entry.key === key);
      expect(group).toBeDefined();
      expect(group!.pages.map((page) => page.key)).toEqual([...pages]);
    },
  );

  it("holds nineteen destinations and no duplicates", () => {
    // Nineteen until the legal documents became writable. The number is
    // pinned rather than derived so that adding a destination is a
    // deliberate edit to this line and not a silent one.
    const keys = CONTROL_PANEL_PAGES.map((page) => page.key);
    // NINETEEN, NOT TWENTY. «أبغى ألغي صفحة الحسابات البنكية، ما
    //  أحتاجها، لأن كل حساب يخصّ مورّدًا فبالضرورة أدخل للمورّد
    //  وتفاصيله» — the account is on the supplier's own record now,
    //  beside the button that decides it.
    expect(keys).toHaveLength(19);
    expect(new Set(keys).size).toBe(19);
  });

  it("keeps every existing route segment untouched", () => {
    // A VISIBLE NAME IS NOT A ROUTE. «اللافتات» became «البنرات
    // الإعلانية» and the branding screen gained «والشعار», and neither
    // moved: an operator's bookmark, an audit entry and a link in an
    // email all point at the path.
    const bySegment = Object.fromEntries(
      CONTROL_PANEL_PAGES.map((page) => [page.key, page.segment]),
    );

    expect(bySegment).toEqual({
      dashboard: "",
      companies: "companies",
      products: "products",
      taxonomy: "taxonomy",
      opportunities: "opportunities",
      orders: "orders",
      disputes: "disputes",
      refunds: "refunds",
      settlements: "settlements",
      invoicing: "invoicing",
      banners: "banners",
      content: "content",
      policies: "policies",
      branding: "branding",
      settings: "settings",
      catalogue: "catalogue",
      outbox: "outbox",
      adminUsers: "admin-users",
      audit: "audit",
    });
  });

  it("points every destination at a route that exists", () => {
    // A sidebar entry that 404s is worse than one that is missing.
    const root = join(process.cwd(), "app", "[locale]", "admin");
    for (const page of CONTROL_PANEL_PAGES) {
      const file = page.segment
        ? join(root, page.segment, "page.tsx")
        : join(root, "page.tsx");
      expect([page.key, readFileSync(file, "utf8").length > 0]).toEqual([
        page.key,
        true,
      ]);
    }
  });
});

describe("every group and page has a name in both languages", () => {
  const namesIn = (messages: typeof arMessages) => ({
    groups: messages.admin.nav.group as Record<string, string>,
    pages: messages.admin.nav as unknown as Record<string, string>,
  });

  it.each(["ar-SA", "en-SA"])("%s names every group", (locale) => {
    const { groups } = namesIn(
      locale === "ar-SA" ? arMessages : (enMessages as typeof arMessages),
    );
    for (const group of CONTROL_PANEL_GROUPS) {
      expect([group.key, groups[group.key]?.length ?? 0]).toEqual([
        group.key,
        expect.any(Number),
      ]);
      expect(groups[group.key]).toBeTruthy();
    }
  });

  it.each(["ar-SA", "en-SA"])("%s names every page", (locale) => {
    const { pages } = namesIn(
      locale === "ar-SA" ? arMessages : (enMessages as typeof arMessages),
    );
    for (const page of CONTROL_PANEL_PAGES) {
      expect([page.key, Boolean(pages[page.key])]).toEqual([page.key, true]);
    }
  });

  it("uses the approved product name in both languages", () => {
    expect(arMessages.admin.nav.portalName).toBe("لوحة التحكم");
    expect(enMessages.admin.nav.portalName).toBe("Control Panel");
    // The name it replaced must be gone, not merely unused.
    expect(JSON.stringify(arMessages.admin.nav)).not.toContain("لوحة الإدارة");
  });

  it("renames the banner screen without touching its route", () => {
    expect(arMessages.admin.nav.banners).toBe("البنرات الإعلانية");
    expect(arMessages.admin.nav.branding).toBe("الهوية والألوان والشعار");
    expect(
      CONTROL_PANEL_PAGES.find((page) => page.key === "banners")?.segment,
    ).toBe("banners");
  });

  it("translates the two names rather than repeating the Arabic", () => {
    expect(enMessages.admin.nav.banners).not.toBe(arMessages.admin.nav.banners);
    expect(enMessages.admin.nav.branding).not.toBe(
      arMessages.admin.nav.branding,
    );
  });
});

describe("turning a pathname back into a place", () => {
  it("finds the page and the group holding it", () => {
    const found = locateControlPanelPage("/ar-SA/admin/companies");

    expect(found?.page.key).toBe("companies");
    expect(found?.group?.key).toBe("market");
  });

  it("keeps a DETAIL screen inside the section it was opened from", () => {
    // `/admin/orders/abc` is still the orders page. Its breadcrumb and
    // its highlighted sidebar entry have to say so.
    expect(
      locateControlPanelPage("/en-SA/admin/orders/9f1c2e40")?.page.key,
    ).toBe("orders");
    expect(
      locateControlPanelPage("/en-SA/admin/disputes/abc")?.group?.key,
    ).toBe("orders");
  });

  it("prefers the LONGEST matching segment", () => {
    // `products` and `products/reports` both begin the same way.
    expect(
      locateControlPanelPage("/ar-SA/admin/products/reports")?.page.key,
    ).toBe("products");
  });

  it("matches the portal root only exactly", () => {
    expect(locateControlPanelPage("/ar-SA/admin")?.page.key).toBe("dashboard");
    expect(locateControlPanelPage("/ar-SA/admin/")?.page.key).toBe("dashboard");
    // Otherwise every path under the portal would be "home".
    expect(locateControlPanelPage("/ar-SA/admin/audit")?.page.key).toBe(
      "audit",
    );
  });

  it("does not mistake a longer segment for a shorter one", () => {
    // `orders` must not claim `order-allocations` were such a route to
    // appear: the check is on a whole segment, not a prefix.
    expect(locateControlPanelPage("/ar-SA/admin/ordersomething")).toBeNull();
  });

  it("returns nothing for a path outside the portal", () => {
    expect(locateControlPanelPage("/ar-SA/opportunities")).toBeNull();
  });

  it("works the same in both locales", () => {
    expect(locateControlPanelPage("/en-SA/admin/settlements")?.page.key).toBe(
      "settlements",
    );
    expect(locateControlPanelPage("/ar-SA/admin/settlements")?.page.key).toBe(
      "settlements",
    );
  });

  it("finds nothing where the bank accounts screen used to be", () => {
    // The segment is not merely unlisted: it resolves to no page at
    // all, so a bookmarked address falls through rather than
    // lighting a section that no longer holds it.
    expect(locateControlPanelPage("/ar-SA/admin/bank-accounts")).toBeNull();
  });
});

describe("the icons are the approved ones", () => {
  const SOURCE = readFileSync(
    join(process.cwd(), "components", "admin", "control-panel-nav.ts"),
    "utf8",
  );

  it.each([
    ["dashboard", "LayoutDashboard"],
    ["companies", "Building2"],
    ["products", "Package"],
    ["taxonomy", "FolderTree"],
    ["opportunities", "Lightbulb"],
    ["orders", "ClipboardList"],
    ["disputes", "Scale"],
    ["refunds", "Undo2"],
    ["settlements", "HandCoins"],
    ["invoicing", "ReceiptText"],
    ["banners", "Images"],
    ["content", "FileText"],
    ["policies", "Scale"],
    ["branding", "Palette"],
    ["settings", "Settings"],
    ["catalogue", "Database"],
    ["outbox", "BellRing"],
    ["adminUsers", "UsersRound"],
    ["audit", "ScrollText"],
  ])("gives %s the %s icon", (key, icon) => {
    expect(SOURCE).toMatch(new RegExp(`key: "${key}"[^}]*icon: ${icon}\\b`));
  });

  it.each([
    ["market", "Store"],
    ["orders", "Headphones"],
    ["finance", "WalletCards"],
    ["content", "PencilRuler"],
    ["system", "Puzzle"],
    ["security", "ShieldCheck"],
  ])("gives the %s group the %s icon", (key, icon) => {
    expect(SOURCE).toMatch(
      new RegExp(`key: "${key}",\\s*\\n\\s*icon: ${icon},`),
    );
  });

  it("draws them from ONE set, not several", () => {
    // Mixing icon families is how a row of glyphs ends up at different
    // weights and optical sizes.
    expect(SOURCE).toContain('from "lucide-react"');
    expect(SOURCE).not.toMatch(/from "@\/components\/ui\/icons"/);
  });
});
