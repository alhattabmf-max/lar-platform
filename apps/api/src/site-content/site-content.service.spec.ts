import {
  HEADER_NAV_MAX_ITEMS,
  HEADER_NAV_SETTING_KEY,
  SITE_CONTENT_FIELDS,
  SITE_CONTENT_LIMITS,
  SITE_CONTENT_SETTING_KEY,
} from "@platform/types";
import { SiteContentService } from "./site-content.service";
import type { PrismaService } from "../database/prisma.service";

/**
 * Saving content, then reading it back the way a visitor would.
 *
 * The settings rows are stubbed rather than written to a database —
 * there is no PostgreSQL in this environment — but the values passed in
 * are exactly the JSON the registry's validator accepts, and the
 * assertions are about what the read produces from them.
 *
 * The point of every case: an operator's mistake must degrade to the
 * shipped copy, never to a broken page.
 */

const NODE_A = "11111111-1111-4111-8111-111111111111";
const NODE_B = "22222222-2222-4222-8222-222222222222";
const NODE_RETIRED = "33333333-3333-4333-8333-333333333333";

function serviceWith(options: {
  content?: unknown;
  nav?: unknown;
  /** Only ACTIVE nodes — the query filters on `isActive` itself. */
  activeNodes?: { id: string; nameAr: string; nameEn: string }[];
}) {
  const rows = new Map<string, { value: unknown }>();
  if (options.content !== undefined) {
    rows.set(SITE_CONTENT_SETTING_KEY, { value: options.content });
  }
  if (options.nav !== undefined) {
    rows.set(HEADER_NAV_SETTING_KEY, { value: options.nav });
  }

  const active = options.activeNodes ?? [];

  const prisma = {
    systemSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        rows.get(where.key) ?? null,
    },
    taxonomyNode: {
      findMany: async ({
        where,
      }: {
        where: { id: { in: string[] }; isActive: boolean };
      }) => {
        expect(where.isActive).toBe(true);
        return active.filter((node) => where.id.in.includes(node.id));
      },
    },
  } as unknown as PrismaService;

  return new SiteContentService(prisma);
}

const text = (value: string) => ({ ar: value, en: `${value} EN` });

describe("saved content comes back", () => {
  it("returns every field an operator saved", async () => {
    const saved = Object.fromEntries(
      SITE_CONTENT_FIELDS.map((field) => [field, text(field)]),
    );

    const content = await serviceWith({ content: saved }).get();

    for (const field of SITE_CONTENT_FIELDS) {
      expect(content[field].ar).toBe(field);
      expect(content[field].en).toBe(`${field} EN`);
    }
  });

  it("returns one language when only one was saved", async () => {
    const content = await serviceWith({
      content: { heroTitle: { ar: "عنوان", en: null } },
    }).get();

    expect(content.heroTitle.ar).toBe("عنوان");
    // Null means "use the shipped copy for English" — not an empty
    // heading on the English site.
    expect(content.heroTitle.en).toBeNull();
  });
});

describe("nothing saved means nothing customised", () => {
  it("returns every field null when the setting is absent", async () => {
    const content = await serviceWith({}).get();

    for (const field of SITE_CONTENT_FIELDS) {
      expect(content[field]).toEqual({ ar: null, en: null });
    }
    expect(content.headerNav).toEqual([]);
  });
});

describe("a corrupt setting degrades field by field", () => {
  it("drops a malformed field and keeps the sound ones", async () => {
    // One operator error must not cost the whole block.
    const content = await serviceWith({
      content: {
        heroTitle: "not a language pair",
        heroDescription: { ar: "وصف", en: "Description" },
      },
    }).get();

    expect(content.heroTitle).toEqual({ ar: null, en: null });
    expect(content.heroDescription.ar).toBe("وصف");
  });

  it("DROPS an over-length value rather than truncating it", async () => {
    // A half-sentence on a homepage is worse than the default sentence.
    const tooLong = "x".repeat(SITE_CONTENT_LIMITS.heroTitle + 1);

    const content = await serviceWith({
      content: { heroTitle: { ar: tooLong, en: "fine" } },
    }).get();

    expect(content.heroTitle.ar).toBeNull();
    expect(content.heroTitle.en).toBe("fine");
  });

  it("keeps a value exactly at the limit", async () => {
    const exact = "x".repeat(SITE_CONTENT_LIMITS.heroTitle);

    const content = await serviceWith({
      content: { heroTitle: { ar: exact, en: null } },
    }).get();

    expect(content.heroTitle.ar).toBe(exact);
  });

  it.each([
    ["a string", "text"],
    ["an array", []],
    ["a number", 42],
    ["null", null],
  ])(
    "returns the empty shape when the whole setting is %s",
    async (_label, value) => {
      const content = await serviceWith({ content: value }).get();

      for (const field of SITE_CONTENT_FIELDS) {
        expect(content[field]).toEqual({ ar: null, en: null });
      }
    },
  );

  it("ignores a field name that is not on the contract", async () => {
    const content = await serviceWith({
      content: { heroTitle: text("hero"), somethingElse: text("x") },
    }).get();

    // The shape is the text fields plus the two lists the service also
    // assembles: the header categories and the FAQ questions.
    expect(Object.keys(content).sort()).toEqual(
      [...SITE_CONTENT_FIELDS, "headerNav", "faqItems"].sort(),
    );
  });
});

describe("the header navigation", () => {
  const nodes = [
    { id: NODE_A, nameAr: "أغذية", nameEn: "Food" },
    { id: NODE_B, nameAr: "مواد بناء", nameEn: "Building" },
  ];

  it("resolves ids to names, in the OPERATOR's order", async () => {
    // Saved B then A. The database has no opinion about order; the
    // operator does.
    const content = await serviceWith({
      nav: [NODE_B, NODE_A],
      activeNodes: nodes,
    }).get();

    expect(content.headerNav.map((item) => item.taxonomyNodeId)).toEqual([
      NODE_B,
      NODE_A,
    ]);
    expect(content.headerNav[0].nameAr).toBe("مواد بناء");
    expect(content.headerNav[1].nameEn).toBe("Food");
  });

  it("DROPS a node that is no longer active, keeping the rest", async () => {
    // The header must not break because a category was retired, and an
    // item that leads nowhere is worse than an item that is gone.
    const content = await serviceWith({
      nav: [NODE_A, NODE_RETIRED, NODE_B],
      activeNodes: nodes,
    }).get();

    expect(content.headerNav.map((item) => item.taxonomyNodeId)).toEqual([
      NODE_A,
      NODE_B,
    ]);
  });

  it("returns nothing when every configured node is gone", async () => {
    const content = await serviceWith({
      nav: [NODE_RETIRED],
      activeNodes: nodes,
    }).get();

    expect(content.headerNav).toEqual([]);
  });

  it("de-duplicates a category listed twice", async () => {
    const content = await serviceWith({
      nav: [NODE_A, NODE_A, NODE_B],
      activeNodes: nodes,
    }).get();

    expect(content.headerNav.map((item) => item.taxonomyNodeId)).toEqual([
      NODE_A,
      NODE_B,
    ]);
  });

  it("caps the list at the shared maximum", async () => {
    const many = Array.from(
      { length: HEADER_NAV_MAX_ITEMS + 5 },
      (_, index) => `4444444${index}-4444-4444-8444-444444444444`,
    );
    const allActive = many.map((id) => ({ id, nameAr: "أ", nameEn: "A" }));

    const content = await serviceWith({
      nav: many,
      activeNodes: allActive,
    }).get();

    expect(content.headerNav).toHaveLength(HEADER_NAV_MAX_ITEMS);
  });

  it.each([
    ["an object", {}],
    ["a string", "id"],
    ["null", null],
    ["a number", 7],
  ])("returns no categories when the setting is %s", async (_label, value) => {
    const content = await serviceWith({ nav: value, activeNodes: nodes }).get();

    expect(content.headerNav).toEqual([]);
  });

  it("ignores non-string entries inside the array", async () => {
    const content = await serviceWith({
      nav: [NODE_A, 42, null, "", NODE_B],
      activeNodes: nodes,
    }).get();

    expect(content.headerNav.map((item) => item.taxonomyNodeId)).toEqual([
      NODE_A,
      NODE_B,
    ]);
  });

  it("carries NO url field of any kind", async () => {
    // The whole point of storing ids: there is no destination anyone
    // typed, so there is nothing to allowlist.
    const content = await serviceWith({
      nav: [NODE_A],
      activeNodes: nodes,
    }).get();

    expect(Object.keys(content.headerNav[0]).sort()).toEqual(
      ["nameAr", "nameEn", "taxonomyNodeId"].sort(),
    );
  });
});
